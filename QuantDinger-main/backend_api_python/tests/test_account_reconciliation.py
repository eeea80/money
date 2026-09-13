"""Tests for L1/L3 reconciliation helpers."""

from app.services.live_trading.account_positions import (
    filter_position_rows_by_symbols,
    reconcile_strategy_vs_account,
)


def test_reconcile_ok_when_both_flat():
    out = reconcile_strategy_vs_account([], [])
    assert out["status"] == "ok"
    assert out["notes"] == []


def test_reconcile_strategy_only_ghost():
    local = [{"symbol": "ETH/USDT", "side": "long", "size": 0.096}]
    out = reconcile_strategy_vs_account(local, [])
    assert out["status"] == "strategy_only"
    assert any("strategy_only" in n for n in out["notes"])


def test_reconcile_account_only_external():
    account = [{"symbol": "ETH/USDT", "side": "short", "size": 0.05}]
    out = reconcile_strategy_vs_account([], account)
    assert out["status"] == "ok"
    assert out["notes"] == []


def test_reconcile_account_surplus_is_user_owned():
    local = [{"symbol": "ETH/USDT", "side": "long", "size": 1.0}]
    account = [{"symbol": "ETH/USDT", "side": "long", "size": 5.0}]
    out = reconcile_strategy_vs_account(local, account)
    assert out["status"] == "ok"
    assert out["notes"] == []


def test_reconcile_ok_when_sizes_match():
    local = [{"symbol": "ETHUSDT", "side": "long", "size": 1.0}]
    account = [{"symbol": "ETH/USDT", "side": "long", "size": 1.0}]
    out = reconcile_strategy_vs_account(local, account)
    assert out["status"] == "ok"


def test_reconcile_size_mismatch():
    local = [{"symbol": "BTC/USDT", "side": "long", "size": 1.0}]
    account = [{"symbol": "BTC/USDT", "side": "long", "size": 0.5}]
    out = reconcile_strategy_vs_account(local, account)
    assert out["status"] == "mismatch"
    assert any("size_mismatch" in n for n in out["notes"])


def test_reconcile_stock_shortfall_has_no_percentage_allowance():
    local = [{"symbol": "NVDA", "side": "long", "size": 1000.0, "current_price": 220.0}]
    account = [{"symbol": "NVDA", "side": "long", "size": 999.0, "mark_price": 220.0}]
    out = reconcile_strategy_vs_account(local, account)
    assert out["status"] == "mismatch"
    assert any("size_mismatch:NVDA:long" in note for note in out["notes"])


def test_reconciliation_filters_other_symbols_from_account_ownership():
    rows = [
        {"symbol_canonical": "BTC/USDT", "side": "long", "manual_reserved_qty": 0.0006},
        {"symbol_canonical": "SOL/USDT", "side": "long", "manual_reserved_qty": 1.5},
    ]

    filtered = filter_position_rows_by_symbols(rows, ["SOL/USDT"])

    assert [row["symbol_canonical"] for row in filtered] == ["SOL/USDT"]
