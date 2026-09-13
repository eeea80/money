"""Stripe Checkout integration for membership plans.

The server owns plan prices. An optional Stripe Price ID can be used, otherwise
Checkout receives inline price data from the saved plan. The browser receives
only a short-lived Checkout URL; membership is granted exclusively by a
verified, idempotent webhook.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import time
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Dict, Tuple

import requests

from app.services.billing_service import get_billing_service
from app.utils.db import get_db_connection
from app.utils.logger import get_logger

logger = get_logger(__name__)


class StripePaymentService:
    DEFAULT_TAX_CODE = "txcd_10103000"
    CHECKOUT_SESSION_TTL_SECONDS = 60 * 60

    def __init__(self) -> None:
        self.billing = get_billing_service()

    @staticmethod
    def enabled() -> bool:
        return (
            str(os.getenv("STRIPE_PAY_ENABLED", "False")).lower() in ("1", "true", "yes")
            and bool((os.getenv("STRIPE_SECRET_KEY", "") or "").strip())
        )

    @staticmethod
    def _frontend_url(client: str = "pc") -> str:
        urls = [item.strip().rstrip("/") for item in (os.getenv("FRONTEND_URL", "http://localhost:8080") or "").split(",") if item.strip()]
        if not urls:
            return "http://localhost:8080"
        return urls[1] if client == "mobile" and len(urls) > 1 else urls[0]

    def _ensure_schema(self, cur) -> None:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS qd_stripe_orders (
              id SERIAL PRIMARY KEY,
              user_id INTEGER NOT NULL,
              plan VARCHAR(64) NOT NULL,
              stripe_session_id VARCHAR(255) UNIQUE,
              amount_usd DECIMAL(12,2) NOT NULL DEFAULT 0,
              currency VARCHAR(10) NOT NULL DEFAULT 'usd',
              status VARCHAR(20) NOT NULL DEFAULT 'pending',
              paid_at TIMESTAMP,
              expires_at TIMESTAMP,
              created_at TIMESTAMP DEFAULT NOW(),
              updated_at TIMESTAMP DEFAULT NOW()
            )
            """
        )
        cur.execute("ALTER TABLE qd_stripe_orders ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP")

    @staticmethod
    def _checkout_line_item(plan: Dict[str, Any], plan_code: str) -> Dict[str, str]:
        """Build one Stripe Checkout line item without trusting browser prices."""
        price_id = str(plan.get("stripe_price_id") or "").strip()
        if price_id:
            return {
                "line_items[0][price]": price_id,
                "line_items[0][quantity]": "1",
            }

        try:
            amount = Decimal(str(plan.get("price_usd") or "0"))
            cents = int((amount * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        except (InvalidOperation, TypeError, ValueError):
            cents = 0
        if cents <= 0:
            raise ValueError("invalid_plan_price")

        name = str(plan.get("name") or plan_code or "QuantDinger membership").strip()
        tax_code = str(os.getenv("STRIPE_PRODUCT_TAX_CODE") or StripePaymentService.DEFAULT_TAX_CODE).strip()
        if not re.fullmatch(r"txcd_\d{8}", tax_code):
            tax_code = StripePaymentService.DEFAULT_TAX_CODE
        return {
            "line_items[0][price_data][currency]": "usd",
            "line_items[0][price_data][unit_amount]": str(cents),
            "line_items[0][price_data][product_data][name]": name[:127],
            "line_items[0][price_data][product_data][tax_code]": tax_code,
            "line_items[0][quantity]": "1",
        }

    def create_checkout(self, user_id: int, plan_code: str, client: str = "pc") -> Tuple[bool, str, Dict[str, Any]]:
        if not self.enabled():
            return False, "stripe_pay_disabled", {}
        plan_code = (plan_code or "").strip().lower()
        plan = self.billing.get_membership_plans().get(plan_code)
        if not plan:
            return False, "invalid_plan", {}
        try:
            line_item = self._checkout_line_item(plan, plan_code)
        except ValueError as exc:
            return False, str(exc), {}

        checkout_expires_at = int(time.time()) + self.CHECKOUT_SESSION_TTL_SECONDS
        expires_at = datetime.fromtimestamp(checkout_expires_at, tz=timezone.utc).replace(tzinfo=None)
        with get_db_connection() as db:
            cur = db.cursor()
            self._ensure_schema(cur)
            cur.execute(
                """
                INSERT INTO qd_stripe_orders
                    (user_id, plan, amount_usd, status, expires_at, created_at, updated_at)
                VALUES (?, ?, ?, 'pending', ?, NOW(), NOW()) RETURNING id
                """,
                (user_id, plan_code, float(plan.get("price_usd") or 0), expires_at),
            )
            order_id = (cur.fetchone() or {}).get("id")
            db.commit()
            cur.close()

        client = "mobile" if str(client).strip().lower() == "mobile" else "pc"
        base = self._frontend_url(client)
        return_path = "/profile/credits" if client == "mobile" else "/billing"
        success_url = (os.getenv("STRIPE_SUCCESS_URL", "") or "").strip() or f"{base}{return_path}?payment=stripe_success&session_id={{CHECKOUT_SESSION_ID}}"
        cancel_url = (os.getenv("STRIPE_CANCEL_URL", "") or "").strip() or f"{base}{return_path}?payment=stripe_cancelled"
        payload = {
            "mode": "payment",
            "expires_at": str(checkout_expires_at),
            "success_url": success_url,
            "cancel_url": cancel_url,
            "client_reference_id": str(order_id),
            "metadata[order_id]": str(order_id),
            "metadata[user_id]": str(user_id),
            "metadata[plan]": plan_code,
            "payment_intent_data[metadata][order_id]": str(order_id),
            "payment_intent_data[metadata][user_id]": str(user_id),
            "payment_intent_data[metadata][plan]": plan_code,
        }
        payload.update(line_item)
        secret = (os.getenv("STRIPE_SECRET_KEY", "") or "").strip()
        try:
            resp = requests.post(
                "https://api.stripe.com/v1/checkout/sessions",
                data=payload,
                auth=(secret, ""),
                timeout=20,
            )
            body = resp.json() if resp.content else {}
            if resp.status_code >= 400:
                raise RuntimeError(((body.get("error") or {}).get("message")) or f"stripe_http_{resp.status_code}")
            session_id = body.get("id") or ""
            checkout_url = body.get("url") or ""
            if not session_id or not checkout_url:
                raise RuntimeError("stripe_checkout_missing_url")
            with get_db_connection() as db:
                cur = db.cursor()
                cur.execute(
                    "UPDATE qd_stripe_orders SET stripe_session_id=?, updated_at=NOW() WHERE id=?",
                    (session_id, order_id),
                )
                db.commit()
                cur.close()
            return True, "success", {"order_id": order_id, "session_id": session_id, "checkout_url": checkout_url}
        except Exception as exc:
            logger.error("Stripe Checkout creation failed: %s", exc, exc_info=True)
            with get_db_connection() as db:
                cur = db.cursor()
                cur.execute("UPDATE qd_stripe_orders SET status='failed', updated_at=NOW() WHERE id=?", (order_id,))
                db.commit()
                cur.close()
            return False, f"error:{exc}", {}

    @staticmethod
    def verify_webhook(payload: bytes, signature: str) -> bool:
        secret = (os.getenv("STRIPE_WEBHOOK_SECRET", "") or "").strip()
        if not secret or not signature:
            return False
        values: Dict[str, list] = {}
        for part in signature.split(","):
            if "=" in part:
                key, value = part.split("=", 1)
                values.setdefault(key.strip(), []).append(value.strip())
        try:
            timestamp = int((values.get("t") or [""])[0])
        except ValueError:
            return False
        if abs(int(time.time()) - timestamp) > 300:
            return False
        signed = f"{timestamp}.".encode("utf-8") + payload
        expected = hmac.new(secret.encode("utf-8"), signed, hashlib.sha256).hexdigest()
        return any(hmac.compare_digest(expected, candidate) for candidate in values.get("v1", []))

    def handle_webhook(self, payload: bytes, signature: str) -> Tuple[bool, str]:
        if not self.verify_webhook(payload, signature):
            return False, "invalid_signature"
        try:
            event = json.loads(payload.decode("utf-8"))
        except Exception:
            return False, "invalid_payload"
        event_type = event.get("type")
        if event_type not in ("checkout.session.completed", "checkout.session.expired"):
            return True, "ignored"
        session = ((event.get("data") or {}).get("object") or {})
        metadata = session.get("metadata") or {}
        try:
            order_id = int(metadata.get("order_id") or session.get("client_reference_id") or 0)
        except (TypeError, ValueError):
            return False, "invalid_order"
        if not order_id:
            return False, "invalid_order"

        if event_type == "checkout.session.expired":
            with get_db_connection() as db:
                cur = db.cursor()
                self._ensure_schema(cur)
                cur.execute(
                    """
                    UPDATE qd_stripe_orders
                    SET status='expired', updated_at=NOW(), stripe_session_id=?
                    WHERE id=? AND status='pending'
                    """,
                    (session.get("id") or "", order_id),
                )
                db.commit()
                cur.close()
            return True, "expired"

        if session.get("payment_status") not in ("paid", "no_payment_required"):
            return True, "not_paid"
        with get_db_connection() as db:
            cur = db.cursor()
            self._ensure_schema(cur)
            cur.execute("SELECT id, user_id, plan, status FROM qd_stripe_orders WHERE id=?", (order_id,))
            order = cur.fetchone() or {}
            cur.close()
        if not order:
            return False, "order_not_found"
        if order.get("status") == "paid":
            return True, "already_paid"
        ok, msg, _ = self.billing.purchase_membership(
            int(order["user_id"]), str(order["plan"]), record_membership_order=False,
            fulfillment_ref=f"stripe_session:{session.get('id') or order_id}",
        )
        if not ok:
            return False, msg
        with get_db_connection() as db:
            cur = db.cursor()
            cur.execute(
                "UPDATE qd_stripe_orders SET status='paid', paid_at=NOW(), updated_at=NOW(), stripe_session_id=? WHERE id=?",
                (session.get("id") or "", order_id),
            )
            db.commit()
            cur.close()
        return True, "success"


_service = StripePaymentService()


def get_stripe_payment_service() -> StripePaymentService:
    return _service
