"""Idempotency tests for :class:`UsdtPaymentService.create_order`.

Scenario under test:
    The user clicks "Buy → choose network → Continue to pay", then closes
    the payment modal (or the browser tab) before completing the transfer.
    A few minutes later they re-open the page and click "Buy" again with
    the same plan + chain. The expected behaviour is: **return the
    existing pending order**, not create a second one.

Why this matters:
    Without idempotency, every modal re-open writes another row into
    ``qd_usdt_orders``. They'd never collide on the unique index because
    each one has a different amount suffix, so the DB happily grows N
    rows for the same intent. The watcher would then need to track N
    expected amounts for the same user/plan, the UI would show a fresh
    QR (different amount) every time, and an actual on-chain payment
    of the *first* amount would match only the *first* row — confusing
    everyone.

The DB layer is mocked through ``get_db_connection`` so these tests run
without a Postgres instance.
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional
from unittest.mock import patch

import pytest

from app.services.usdt_payment.service import UsdtPaymentService


# ---------------------------------------------------------------------------
# Tiny in-memory DB stand-in
# ---------------------------------------------------------------------------


class _MemRow(dict):
    """dict subclass that also supports attribute-style access if needed."""


class _MemCursor:
    def __init__(self, db: "_MemDb") -> None:
        self.db = db
        self._last_result: List[Dict[str, Any]] = []

    # The service driver uses '?' placeholders consistently; we just pull
    # them off the SQL one by one in argument order. This is enough for
    # the small set of statements ``create_order`` issues.

    def execute(self, sql: str, params=()) -> None:
        sql_norm = " ".join(sql.split()).upper()
        params = tuple(params or ())
        if sql_norm.startswith("CREATE TABLE") or sql_norm.startswith("CREATE INDEX") or sql_norm.startswith("CREATE UNIQUE INDEX"):
            self._last_result = []
            return
        if "FROM QD_USDT_ORDERS" in sql_norm and "WHERE USER_ID" in sql_norm and "STATUS = 'PENDING'" in sql_norm:
            # idempotency probe: (user_id, plan, chain, currency, now)
            user_id, plan, chain, currency, now = params
            matches = [
                r for r in self.db.rows
                if r.get("user_id") == user_id
                and r.get("plan") == plan
                and r.get("chain") == chain
                and r.get("currency") == currency
                and r.get("status") == "pending"
                and (r.get("expires_at") is None or r.get("expires_at") > now)
            ]
            matches.sort(key=lambda r: r.get("created_at") or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
            self._last_result = matches[:1]
            return
        if sql_norm.startswith("INSERT INTO QD_USDT_ORDERS"):
            (
                user_id, plan, chain, currency, final_amount, suffix, address, expires_at
            ) = params
            row = _MemRow(
                id=self.db._next_id(),
                user_id=user_id,
                plan=plan,
                chain=chain,
                currency=currency,
                amount_usdt=final_amount,
                amount_suffix=suffix,
                address=address,
                payment_uri="",
                matched_via="amount_suffix",
                status="pending",
                tx_hash="",
                paid_at=None,
                confirmed_at=None,
                expires_at=expires_at,
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
            self.db.rows.append(row)
            self._last_result = [{"id": row["id"]}]
            return
        if sql_norm.startswith("UPDATE QD_USDT_ORDERS SET PAYMENT_URI"):
            uri, order_id = params
            for r in self.db.rows:
                if r.get("id") == order_id:
                    r["payment_uri"] = uri
            self._last_result = []
            return
        self._last_result = []

    def fetchone(self) -> Optional[Dict[str, Any]]:
        return self._last_result[0] if self._last_result else None

    def fetchall(self) -> List[Dict[str, Any]]:
        return list(self._last_result)

    def close(self) -> None:  # pragma: no cover
        pass


class _MemDb:
    def __init__(self) -> None:
        self.rows: List[Dict[str, Any]] = []
        self._seq = 0

    def _next_id(self) -> int:
        self._seq += 1
        return self._seq

    def cursor(self) -> _MemCursor:
        return _MemCursor(self)

    def commit(self) -> None:  # pragma: no cover
        pass

    def rollback(self) -> None:  # pragma: no cover
        pass


# Shared mem-db across the patched ``get_db_connection`` callsites in the
# service; each test instantiates its own.

@pytest.fixture
def mem_db():
    db = _MemDb()

    @contextmanager
    def _ctx():
        yield db

    return db, _ctx


@pytest.fixture
def isolate_chain_env(monkeypatch):
    """Same as test_usdt_payment_chains: clear chain env so each test
    declares its own world."""
    from app.services.usdt_payment.chains import CHAIN_SPECS as _SPECS
    for code, spec in _SPECS.items():
        monkeypatch.delenv(spec.address_env, raising=False)
        monkeypatch.delenv(f"USDC_{code}_ADDRESS", raising=False)
    monkeypatch.delenv("USDT_PAY_ENABLED_CHAINS", raising=False)
    monkeypatch.delenv("USDC_PAY_ENABLED_CHAINS", raising=False)
    yield monkeypatch


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def _patch_db(ctx):
    return patch(
        "app.services.usdt_payment.service.get_db_connection",
        new=lambda *a, **kw: ctx(),
    )


def _patch_billing_plans():
    return patch(
        "app.services.usdt_payment.service.get_billing_service",
        new=lambda: _FakeBilling(),
    )


class _FakeBilling:
    def get_membership_plans(self) -> Dict[str, Dict[str, Any]]:
        return {
            "monthly": {"price_usd": 19.9, "credits_once": 500},
            "yearly": {"price_usd": 199, "credits_once": 8000},
            "lifetime": {"price_usd": 499, "credits_monthly": 800},
        }

    def purchase_membership(self, *args, **kwargs):  # pragma: no cover
        return True, "ok", {}


def test_second_create_reuses_pending_order(monkeypatch, mem_db, isolate_chain_env):
    """The user clicks Buy → Continue → closes modal → clicks Buy again.
    The second create_order call must return the same order_id and the
    same amount as the first."""
    isolate_chain_env.setenv("USDT_PAY_ENABLED", "true")
    isolate_chain_env.setenv("USDT_PAY_ENABLED_CHAINS", "BEP20")
    isolate_chain_env.setenv("USDT_BEP20_ADDRESS", "0xMainWallet")
    isolate_chain_env.setenv("USDT_AMOUNT_SUFFIX_DECIMALS", "6")

    db, ctx = mem_db
    with _patch_db(ctx), _patch_billing_plans():
        svc = UsdtPaymentService()
        ok1, msg1, out1 = svc.create_order(user_id=42, plan="monthly", chain="BEP20")
        ok2, msg2, out2 = svc.create_order(user_id=42, plan="monthly", chain="BEP20")

    assert ok1 and ok2, f"both calls should succeed (msg1={msg1}, msg2={msg2})"
    assert out1["reused"] is False, "first call must be a fresh order"
    assert out2["reused"] is True, "second call must reuse the open order"
    assert out2["order_id"] == out1["order_id"], "same order_id must be returned"
    assert out2["amount_usdt"] == out1["amount_usdt"], "amount must not change on reuse"
    assert msg2 == "success_reused"
    assert len([r for r in db.rows if r["status"] == "pending"]) == 1, (
        "no duplicate row should be inserted on reuse"
    )


def test_different_chain_creates_new_order(monkeypatch, mem_db, isolate_chain_env):
    """Switching the chain selector between attempts must NOT reuse the
    previous order. The user is asking for a different payment network,
    that's a fresh order."""
    isolate_chain_env.setenv("USDT_PAY_ENABLED", "true")
    isolate_chain_env.setenv("USDT_PAY_ENABLED_CHAINS", "BEP20,TRC20")
    isolate_chain_env.setenv("USDT_BEP20_ADDRESS", "0xMainWallet")
    isolate_chain_env.setenv("USDT_TRC20_ADDRESS", "TxxxMainWallet")
    isolate_chain_env.setenv("USDT_AMOUNT_SUFFIX_DECIMALS", "6")

    db, ctx = mem_db
    with _patch_db(ctx), _patch_billing_plans():
        svc = UsdtPaymentService()
        ok1, _, out1 = svc.create_order(user_id=42, plan="monthly", chain="BEP20")
        ok2, _, out2 = svc.create_order(user_id=42, plan="monthly", chain="TRC20")

    assert ok1 and ok2
    assert out2["order_id"] != out1["order_id"], "different chains must yield different orders"
    assert out2["chain"] == "TRC20"
    assert out2["reused"] is False


def test_expired_pending_does_not_block_new_create(monkeypatch, mem_db, isolate_chain_env):
    """If the previous pending order has passed ``expires_at`` the user
    must be able to start fresh. Otherwise users who left the tab open
    overnight could never check out again."""
    isolate_chain_env.setenv("USDT_PAY_ENABLED", "true")
    isolate_chain_env.setenv("USDT_PAY_ENABLED_CHAINS", "BEP20")
    isolate_chain_env.setenv("USDT_BEP20_ADDRESS", "0xMainWallet")
    isolate_chain_env.setenv("USDT_AMOUNT_SUFFIX_DECIMALS", "6")
    # Force a 1-minute window so the next monkey-patched "now" is past it.
    isolate_chain_env.setenv("USDT_PAY_EXPIRE_MINUTES", "1")

    db, ctx = mem_db
    with _patch_db(ctx), _patch_billing_plans():
        svc = UsdtPaymentService()
        ok1, _, out1 = svc.create_order(user_id=42, plan="monthly", chain="BEP20")
        assert ok1

        # Force-expire the first order
        for row in db.rows:
            if row["id"] == out1["order_id"]:
                row["expires_at"] = datetime.now(timezone.utc) - timedelta(minutes=5)

        ok2, _, out2 = svc.create_order(user_id=42, plan="monthly", chain="BEP20")

    assert ok2
    assert out2["order_id"] != out1["order_id"], (
        "an expired pending order must NOT block creation of a new one"
    )
    assert out2["reused"] is False


def test_pending_order_for_other_user_not_reused(monkeypatch, mem_db, isolate_chain_env):
    """Idempotency must be scoped to (user_id, plan, chain). User A's
    pending order must never be handed back to user B."""
    isolate_chain_env.setenv("USDT_PAY_ENABLED", "true")
    isolate_chain_env.setenv("USDT_PAY_ENABLED_CHAINS", "BEP20")
    isolate_chain_env.setenv("USDT_BEP20_ADDRESS", "0xMainWallet")

    db, ctx = mem_db
    with _patch_db(ctx), _patch_billing_plans():
        svc = UsdtPaymentService()
        ok1, _, out1 = svc.create_order(user_id=1, plan="monthly", chain="BEP20")
        ok2, _, out2 = svc.create_order(user_id=2, plan="monthly", chain="BEP20")

    assert ok1 and ok2
    assert out2["order_id"] != out1["order_id"]
    assert out2["reused"] is False
