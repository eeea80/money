"""Protected manual inventory and ownership-drift calculations."""

import pytest

from app.services.pending_orders import entry_position_guard
from app.services.live_trading import records
from app.services.live_trading.account_positions import reconcile_strategy_vs_account
from app.services.live_trading.position_ownership import (
    ADVANCED_MODE,
    STATUS_BLOCKED,
    STATUS_OK,
    calculate_position_ownership,
    is_position_leg_blocked,
    repair_position_ownership,
    supports_position_coexistence,
)


def test_strategy_symbol_normalization_strips_only_a_settlement_suffix():
    assert records.normalize_strategy_symbol("BTC/USDT:USDT") == "BTC/USDT"
    assert (
        records.normalize_strategy_symbol("Crypto:BTC/USDT@okx:swap")
        == "CRYPTO:BTC/USDT@OKX:SWAP"
    )


def test_advanced_manual_baseline_allows_matching_account_position():
    snapshot = calculate_position_ownership(
        symbol="BTC/USDT",
        side="long",
        account_qty=0.025,
        strategy_qty=0.015,
        protected_qty=0.01,
        coexistence_mode=ADVANCED_MODE,
    )
    assert snapshot.status == STATUS_OK
    assert snapshot.allowed is True
    assert snapshot.protected_qty == pytest.approx(0.01)
    assert snapshot.unknown_qty == pytest.approx(0.01)


@pytest.mark.parametrize("market_type", ["spot", "swap", "future", "perpetual"])
def test_crypto_spot_and_derivative_markets_support_position_coexistence(market_type):
    assert supports_position_coexistence(market_type, "binance") is True


def test_non_crypto_market_rejects_advanced_position_coexistence():
    assert supports_position_coexistence("USStock") is False
    assert supports_position_coexistence("spot", "ibkr") is False
    with pytest.raises(ValueError, match="positionOwnership.coexistenceMarketUnsupported"):
        repair_position_ownership(
            user_id=1,
            credential_id=2,
            exchange_id="ibkr",
            market_type="USStock",
            symbol="AAPL",
            side="long",
            account_qty=1,
            strategy_qty=0,
            action="protect_manual",
        )


def test_account_surplus_is_automatically_user_owned():
    first = calculate_position_ownership(
        symbol="BTC/USDT",
        side="long",
        account_qty=0.01,
        strategy_qty=0.0,
    )
    duplicate = calculate_position_ownership(
        symbol="BTC/USDT",
        side="long",
        account_qty=0.01,
        strategy_qty=0.0,
        previous_status=first.status,
        previous_reason=first.reason,
    )
    assert first.status == STATUS_OK
    assert first.allowed is True
    assert first.protected_qty == pytest.approx(0.01)
    assert first.should_log is False
    assert duplicate.should_log is False


@pytest.mark.parametrize(
    "reason,blocked",
    [
        ("unallocated_account_position", False),
        ("account_below_strategy_allocation", True),
        ("account_below_protected_allocation", True),
    ],
)
def test_fast_guard_ignores_legacy_surplus_blocks(monkeypatch, reason, blocked):
    monkeypatch.setattr(
        "app.services.live_trading.position_ownership._fetch_reservation",
        lambda **_kwargs: {"status": STATUS_BLOCKED, "drift_reason": reason},
    )
    assert is_position_leg_blocked(
        user_id=1,
        credential_id=2,
        market_type="spot",
        symbol="BTC/USDT",
        side="long",
    ) is blocked


def test_exchange_dust_tolerance_does_not_block_entries():
    snapshot = calculate_position_ownership(
        symbol="BTC/USDT",
        side="long",
        account_qty=0.00045188,
        strategy_qty=0.00045,
        absolute_tolerance=1.0 / 63_000.0,
    )
    assert snapshot.status == STATUS_OK
    assert snapshot.allowed is True


def test_material_account_surplus_never_blocks_entries():
    snapshot = calculate_position_ownership(
        symbol="BTC/USDT",
        side="long",
        account_qty=0.009499333,
        strategy_qty=0.007926070,
        absolute_tolerance=1.0 / 63_000.0,
    )
    assert snapshot.status == STATUS_OK
    assert snapshot.allowed is True
    assert snapshot.protected_qty == pytest.approx(0.001573263)


def test_strict_mode_allows_small_fee_and_rounding_shortfall():
    snapshot = calculate_position_ownership(
        symbol="BTC/USDT",
        side="long",
        account_qty=0.9955,
        strategy_qty=1.0,
    )
    assert snapshot.status == STATUS_OK
    assert snapshot.allowed is True
    assert snapshot.tolerance == pytest.approx(0.005)


def test_strict_mode_still_blocks_material_shortfall():
    snapshot = calculate_position_ownership(
        symbol="BTC/USDT",
        side="long",
        account_qty=0.994,
        strategy_qty=1.0,
    )
    assert snapshot.status == STATUS_BLOCKED
    assert snapshot.reason == "account_below_strategy_allocation"


def test_stock_shortfall_does_not_use_crypto_relative_tolerance():
    snapshot = calculate_position_ownership(
        symbol="NVDA",
        side="long",
        account_qty=999.0,
        strategy_qty=1000.0,
        reference_price=220.0,
    )
    assert snapshot.status == STATUS_BLOCKED
    assert snapshot.reason == "account_below_strategy_allocation"
    assert snapshot.tolerance == pytest.approx(1e-8)


def test_strict_mode_allows_extra_inventory_without_tolerance_limit():
    snapshot = calculate_position_ownership(
        symbol="BTC/USDT",
        side="long",
        account_qty=1.004,
        strategy_qty=1.0,
    )
    assert snapshot.status == STATUS_OK
    assert snapshot.protected_qty == pytest.approx(0.004)


def test_stale_manual_baseline_does_not_create_a_false_shortfall():
    snapshot = calculate_position_ownership(
        symbol="BTC/USDT",
        side="long",
        account_qty=0.015,
        strategy_qty=0.015,
        protected_qty=0.01,
        coexistence_mode=ADVANCED_MODE,
    )
    assert snapshot.status == STATUS_OK
    assert snapshot.protected_qty == 0
    assert snapshot.unknown_qty == 0


def test_account_reconciliation_derives_user_inventory_from_surplus():
    result = reconcile_strategy_vs_account(
        local_rows=[{"symbol": "BTC/USDT", "side": "long", "size": 0.015}],
        account_rows=[{"symbol": "BTC/USDT", "side": "long", "size": 0.025}],
        allocated_rows=[{"symbol": "BTC/USDT", "side": "long", "size": 0.015}],
        protected_rows=[{
            "symbol_canonical": "BTC/USDT",
            "side": "long",
            "coexistence_mode": "advanced",
            "manual_reserved_qty": 0.01,
        }],
    )
    assert result["status"] == "ok"
    assert result["strategy_allocations"][0]["protected_size"] == pytest.approx(0.01)


def test_entry_guard_allows_account_surplus_then_checks_strategy_leg(monkeypatch):
    snapshot = calculate_position_ownership(
        symbol="BTC/USDT",
        side="long",
        account_qty=0.025,
        strategy_qty=0.015,
    )
    monkeypatch.setattr(entry_position_guard, "fetch_allocated_position_size", lambda **_kwargs: 0.015)
    monkeypatch.setattr(entry_position_guard, "evaluate_and_record_ownership", lambda **_kwargs: snapshot)
    monkeypatch.setattr(entry_position_guard, "fetch_position_size_for_side", lambda *_args, **_kwargs: 0.0)
    monkeypatch.setattr(entry_position_guard, "query_exchange_position_size", lambda **_kwargs: 0.0)

    result = entry_position_guard.evaluate_entry_position_guard(
        client=object(),
        strategy_id=1,
        user_id=2,
        credential_id=3,
        exchange_id="binance",
        market_type="swap",
        symbol="BTC/USDT",
        side="long",
        strategy_config={},
        exchange_config={},
        account_qty=0.025,
    )

    assert result.error == ""
    assert result.log_level == ""
    assert result.ownership["status"] == STATUS_OK
    assert result.ownership["protected_qty"] == pytest.approx(0.01)


def test_entry_guard_blocks_manual_opposite_inventory_in_one_way_mode(monkeypatch):
    snapshot = calculate_position_ownership(
        symbol="BTC/USDT",
        side="long",
        account_qty=0.0,
        strategy_qty=0.0,
    )
    monkeypatch.setattr(entry_position_guard, "fetch_allocated_position_size", lambda **_kwargs: 0.0)
    monkeypatch.setattr(entry_position_guard, "evaluate_and_record_ownership", lambda **_kwargs: snapshot)
    monkeypatch.setattr(entry_position_guard, "fetch_position_size_for_side", lambda *_args, **_kwargs: 0.0)
    monkeypatch.setattr(entry_position_guard, "query_exchange_position_size", lambda **_kwargs: 0.25)
    monkeypatch.setattr(
        entry_position_guard,
        "detect_hedge_position_mode",
        lambda *_args, **_kwargs: (False, "binance_one_way_mode"),
    )

    result = entry_position_guard.evaluate_entry_position_guard(
        client=object(),
        strategy_id=1,
        user_id=2,
        credential_id=3,
        exchange_id="binance",
        market_type="swap",
        symbol="BTC/USDT",
        side="long",
        strategy_config={"direction_mode": "long_only"},
        exchange_config={"exchange_id": "binance"},
        account_qty=0.0,
    )

    assert result.error.startswith("opposite_account_inventory_would_be_netted:")
    assert result.log_level == "warning"


def test_entry_guard_allows_manual_opposite_inventory_in_hedge_mode(monkeypatch):
    snapshot = calculate_position_ownership(
        symbol="BTC/USDT",
        side="long",
        account_qty=0.0,
        strategy_qty=0.0,
    )
    monkeypatch.setattr(entry_position_guard, "fetch_allocated_position_size", lambda **_kwargs: 0.0)
    monkeypatch.setattr(entry_position_guard, "evaluate_and_record_ownership", lambda **_kwargs: snapshot)
    monkeypatch.setattr(entry_position_guard, "fetch_position_size_for_side", lambda *_args, **_kwargs: 0.0)
    monkeypatch.setattr(entry_position_guard, "query_exchange_position_size", lambda **_kwargs: 0.25)
    monkeypatch.setattr(
        entry_position_guard,
        "detect_hedge_position_mode",
        lambda *_args, **_kwargs: (True, "binance_hedge_mode"),
    )

    result = entry_position_guard.evaluate_entry_position_guard(
        client=object(),
        strategy_id=1,
        user_id=2,
        credential_id=3,
        exchange_id="binance",
        market_type="swap",
        symbol="BTC/USDT",
        side="long",
        strategy_config={"direction_mode": "long_only"},
        exchange_config={"exchange_id": "binance"},
        account_qty=0.0,
    )

    assert result.error == ""


def test_allocated_position_size_includes_legacy_credential_binding(monkeypatch):
    captured = {}

    class Cursor:
        def execute(self, sql, params):
            captured["sql"] = sql
            captured["params"] = params

        def fetchall(self):
            return [
                {"strategy_id": 1, "symbol": "BTCUSDT", "symbol_canonical": "", "size": 0.01},
                {"strategy_id": 2, "symbol": "BTC/USDT", "symbol_canonical": "", "size": 0.02},
                {"strategy_id": 3, "symbol": "BTC/USDT:USDT", "symbol_canonical": "", "size": 0.01},
            ]

        def close(self):
            return None

    class Db:
        def cursor(self):
            return Cursor()

    class DbContext:
        def __enter__(self):
            return Db()

        def __exit__(self, *_args):
            return False

    monkeypatch.setattr(records, "get_db_connection", lambda: DbContext())

    total = records.fetch_allocated_position_size(
        strategy_id=1,
        credential_id=7,
        market_type="swap",
        symbol="BTC/USDT",
        side="long",
    )

    assert total == pytest.approx(0.04)
    assert "JOIN qd_strategies_trading" in captured["sql"]
    assert "s.exchange_config::jsonb" in captured["sql"]
    assert captured["params"] == ["long", "swap", 1, 7, "7"]


def test_spot_entry_guard_applies_ownership_without_opposite_leg_check(monkeypatch):
    snapshot = calculate_position_ownership(
        symbol="BTC/USDT",
        side="long",
        account_qty=0.025,
        strategy_qty=0.015,
        protected_qty=0.01,
        coexistence_mode=ADVANCED_MODE,
    )
    monkeypatch.setattr(entry_position_guard, "fetch_allocated_position_size", lambda **_kwargs: 0.015)
    monkeypatch.setattr(entry_position_guard, "evaluate_and_record_ownership", lambda **_kwargs: snapshot)
    monkeypatch.setattr(
        entry_position_guard,
        "fetch_position_size_for_side",
        lambda *_args, **_kwargs: pytest.fail("spot must not inspect a short exchange leg"),
    )

    result = entry_position_guard.evaluate_entry_position_guard(
        client=object(),
        strategy_id=1,
        user_id=2,
        credential_id=3,
        exchange_id="binance",
        market_type="spot",
        symbol="BTC/USDT",
        side="long",
        strategy_config={"direction_mode": "long_only"},
        exchange_config={},
        account_qty=0.025,
    )

    assert result.error == ""
    assert result.ownership["coexistence_mode"] == ADVANCED_MODE
    assert result.ownership["status"] == STATUS_OK
