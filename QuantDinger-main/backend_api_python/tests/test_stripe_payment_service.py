from __future__ import annotations

import hashlib
import hmac
import json
import time

import app.services.stripe_payment_service as stripe_module
from app.services.stripe_payment_service import StripePaymentService


class _FakeCursor:
    def __init__(self, row=None):
        self.row = row or {}
        self.executed = []

    def execute(self, sql, params=None):
        self.executed.append((sql, params))

    def fetchone(self):
        return self.row

    def close(self):
        pass


class _FakeDb:
    def __init__(self, row=None):
        self.cursor_instance = _FakeCursor(row)

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        pass

    def cursor(self):
        return self.cursor_instance

    def commit(self):
        pass


def _signature(payload: bytes, secret: str, timestamp: int) -> str:
    signed = f"{timestamp}.".encode("utf-8") + payload
    digest = hmac.new(secret.encode("utf-8"), signed, hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={digest}"


def test_verify_webhook_accepts_current_valid_signature(monkeypatch):
    payload = b'{"type":"checkout.session.completed"}'
    secret = "whsec_test"
    now = int(time.time())
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", secret)
    assert StripePaymentService.verify_webhook(payload, _signature(payload, secret, now))


def test_verify_webhook_rejects_tampering_and_old_events(monkeypatch):
    payload = b'{"type":"checkout.session.completed"}'
    secret = "whsec_test"
    now = int(time.time())
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", secret)
    signature = _signature(payload, secret, now)
    assert not StripePaymentService.verify_webhook(payload + b" ", signature)
    assert not StripePaymentService.verify_webhook(payload, _signature(payload, secret, now - 301))
    assert not StripePaymentService.verify_webhook(payload, "")


def test_stripe_is_enabled_only_with_switch_and_secret(monkeypatch):
    monkeypatch.setenv("STRIPE_PAY_ENABLED", "false")
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_x")
    assert not StripePaymentService.enabled()
    monkeypatch.setenv("STRIPE_PAY_ENABLED", "true")
    assert StripePaymentService.enabled()
    monkeypatch.delenv("STRIPE_SECRET_KEY")
    assert not StripePaymentService.enabled()


def test_checkout_line_item_prefers_configured_price_id():
    item = StripePaymentService._checkout_line_item(
        {"stripe_price_id": "price_live_123", "price_usd": 19.9},
        "monthly",
    )
    assert item == {
        "line_items[0][price]": "price_live_123",
        "line_items[0][quantity]": "1",
    }


def test_checkout_line_item_falls_back_to_server_side_plan_price(monkeypatch):
    monkeypatch.delenv("STRIPE_PRODUCT_TAX_CODE", raising=False)
    item = StripePaymentService._checkout_line_item(
        {"name": "Monthly membership", "stripe_price_id": "", "price_usd": 19.9},
        "monthly",
    )
    assert item["line_items[0][price_data][currency]"] == "usd"
    assert item["line_items[0][price_data][unit_amount]"] == "1990"
    assert item["line_items[0][price_data][product_data][name]"] == "Monthly membership"
    assert item["line_items[0][price_data][product_data][tax_code]"] == "txcd_10103000"
    assert item["line_items[0][quantity]"] == "1"


def test_checkout_line_item_uses_configured_tax_code(monkeypatch):
    monkeypatch.setenv("STRIPE_PRODUCT_TAX_CODE", "txcd_10103001")
    item = StripePaymentService._checkout_line_item(
        {"stripe_price_id": "", "price_usd": 99},
        "business",
    )
    assert item["line_items[0][price_data][product_data][tax_code]"] == "txcd_10103001"


def test_checkout_line_item_falls_back_from_invalid_tax_code(monkeypatch):
    monkeypatch.setenv("STRIPE_PRODUCT_TAX_CODE", "not-a-stripe-tax-code")
    item = StripePaymentService._checkout_line_item(
        {"stripe_price_id": "", "price_usd": 19.9},
        "monthly",
    )
    assert item["line_items[0][price_data][product_data][tax_code]"] == "txcd_10103000"


def test_checkout_line_item_rejects_zero_price():
    try:
        StripePaymentService._checkout_line_item({"price_usd": 0}, "free")
    except ValueError as exc:
        assert str(exc) == "invalid_plan_price"
    else:
        raise AssertionError("zero-priced plans must not create Stripe Checkout sessions")


def test_checkout_session_ttl_is_one_hour():
    assert StripePaymentService.CHECKOUT_SESSION_TTL_SECONDS == 3600


def test_create_checkout_sends_one_hour_expiry(monkeypatch):
    databases = [_FakeDb({"id": 7}), _FakeDb()]
    captured = {}

    class _Response:
        status_code = 200
        content = b"{}"

        @staticmethod
        def json():
            return {"id": "cs_test_7", "url": "https://checkout.stripe.test/7"}

    service = StripePaymentService()
    service.billing = type(
        "Billing",
        (),
        {"get_membership_plans": lambda _self: {"monthly": {"price_usd": 19.9, "name": "Monthly"}}},
    )()
    monkeypatch.setattr(service, "enabled", lambda: True)
    monkeypatch.setattr(stripe_module, "get_db_connection", lambda: databases.pop(0))
    monkeypatch.setattr(stripe_module.time, "time", lambda: 1000)
    monkeypatch.setattr(
        stripe_module.requests,
        "post",
        lambda *args, **kwargs: captured.update(kwargs) or _Response(),
    )
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_x")

    ok, _, _ = service.create_checkout(3, "monthly")

    assert ok
    assert captured["data"]["expires_at"] == "4600"


def test_expired_webhook_marks_pending_order_expired(monkeypatch):
    database = _FakeDb()
    service = StripePaymentService()
    monkeypatch.setattr(service, "verify_webhook", lambda *_args: True)
    monkeypatch.setattr(stripe_module, "get_db_connection", lambda: database)
    payload = json.dumps({
        "type": "checkout.session.expired",
        "data": {"object": {
            "id": "cs_expired_9",
            "client_reference_id": "9",
            "metadata": {"order_id": "9"},
        }},
    }).encode()

    ok, message = service.handle_webhook(payload, "valid")

    assert ok
    assert message == "expired"
    assert any("SET status='expired'" in sql for sql, _ in database.cursor_instance.executed)
