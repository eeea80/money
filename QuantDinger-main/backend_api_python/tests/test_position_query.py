"""Tests for close-quantity resolution (DB + exchange fallback)."""
import pytest
from unittest.mock import MagicMock

from app.services.live_trading.position_query import (
    resolve_reduce_only_quantity,
    symbols_equivalent,
)


def test_symbols_equivalent_compact_and_slash():
    assert symbols_equivalent("DOGEUSDT", "DOGE/USDT")
    assert symbols_equivalent("btc/usdt", "BTCUSDT")
    assert not symbols_equivalent("ETH/USDT", "DOGE/USDT")


def test_resolve_uses_exchange_when_db_missing_only_with_explicit_fallback(monkeypatch):
    monkeypatch.setattr(
        "app.services.live_trading.position_query.fetch_position_size_for_side",
        lambda *_a, **_k: 0.0,
    )
    monkeypatch.setattr(
        "app.services.live_trading.position_query.query_exchange_position_size",
        lambda **_k: 99.0,
    )
    amount, meta = resolve_reduce_only_quantity(
        strategy_id=1,
        symbol="DOGE/USDT",
        pos_side="short",
        requested_amount=0.0,
        client=MagicMock(),
        market_type="swap",
        exchange_config={},
        allow_exchange_fallback=True,
    )
    assert amount == 99.0
    assert meta.get("filled_from") == "exchange"
    assert meta.get("db_missing") is True


def test_resolve_rejects_strategy_close_when_db_position_is_missing(monkeypatch):
    monkeypatch.setattr(
        "app.services.live_trading.position_query.fetch_position_size_for_side",
        lambda *_a, **_k: 0.0,
    )
    monkeypatch.setattr(
        "app.services.live_trading.position_query.query_exchange_position_size",
        lambda **_k: 2.0,
    )

    amount, meta = resolve_reduce_only_quantity(
        strategy_id=1,
        symbol="BTC/USDT",
        pos_side="long",
        requested_amount=0.0004,
        client=MagicMock(),
        market_type="spot",
        exchange_config={},
    )

    assert amount == 0.0
    assert meta.get("db_missing") is True
    assert meta.get("blocked_by") == "strategy_position_missing"


def test_resolve_spot_close_never_exceeds_strategy_owned_quantity(monkeypatch):
    monkeypatch.setattr(
        "app.services.live_trading.position_query.fetch_position_size_for_side",
        lambda *_a, **_k: 0.0004,
    )
    monkeypatch.setattr(
        "app.services.live_trading.position_query.query_exchange_position_size",
        lambda **_k: 2.0,
    )

    amount, meta = resolve_reduce_only_quantity(
        strategy_id=1,
        symbol="BTC/USDT",
        pos_side="long",
        requested_amount=1.0,
        client=MagicMock(),
        market_type="spot",
        exchange_config={},
    )

    assert amount == pytest.approx(0.0004)
    assert meta.get("capped_by") == "db"


def test_resolve_caps_to_db_when_smaller(monkeypatch):
    monkeypatch.setattr(
        "app.services.live_trading.position_query.fetch_position_size_for_side",
        lambda *_a, **_k: 50.0,
    )
    monkeypatch.setattr(
        "app.services.live_trading.position_query.query_exchange_position_size",
        lambda **_k: 99.0,
    )
    amount, meta = resolve_reduce_only_quantity(
        strategy_id=1,
        symbol="DOGE/USDT",
        pos_side="short",
        requested_amount=80.0,
        client=MagicMock(),
        market_type="swap",
        exchange_config={},
    )
    assert amount == 50.0
    assert meta.get("capped_by") == "db"


def test_resolve_account_surplus_does_not_reduce_strategy_exit(monkeypatch):
    monkeypatch.setattr(
        "app.services.live_trading.position_query.fetch_position_size_for_side",
        lambda *_a, **_k: 0.015,
    )
    monkeypatch.setattr(
        "app.services.live_trading.position_query.query_exchange_position_size",
        lambda **_k: 0.02,
    )
    monkeypatch.setattr(
        "app.services.live_trading.position_query.fetch_allocated_position_size",
        lambda **_k: 0.015,
    )
    amount, meta = resolve_reduce_only_quantity(
        strategy_id=1,
        symbol="BTC/USDT",
        pos_side="long",
        requested_amount=0.015,
        client=MagicMock(),
        market_type="swap",
        exchange_config={},
        user_id=1,
        credential_id=2,
    )
    assert amount == pytest.approx(0.015)
    assert meta["other_strategy_allocated_size"] == 0
    assert meta["exchange_strategy_available"] == pytest.approx(0.02)


def test_resolve_reserves_other_strategy_allocations(monkeypatch):
    monkeypatch.setattr(
        "app.services.live_trading.position_query.fetch_position_size_for_side",
        lambda *_a, **_k: 0.015,
    )
    monkeypatch.setattr(
        "app.services.live_trading.position_query.query_exchange_position_size",
        lambda **_k: 0.025,
    )

    monkeypatch.setattr(
        "app.services.live_trading.position_query.fetch_allocated_position_size",
        lambda **_k: 0.02,
    )
    amount, meta = resolve_reduce_only_quantity(
        strategy_id=1,
        symbol="BTC/USDT",
        pos_side="long",
        requested_amount=0.015,
        client=MagicMock(),
        market_type="spot",
        exchange_config={},
        user_id=1,
        credential_id=2,
    )
    assert amount == pytest.approx(0.015)
    assert meta["other_strategy_allocated_size"] == pytest.approx(0.005)
    assert meta["exchange_strategy_available"] == pytest.approx(0.02)


def test_resolve_caps_exit_when_account_cannot_cover_other_strategies(monkeypatch):
    monkeypatch.setattr(
        "app.services.live_trading.position_query.fetch_position_size_for_side",
        lambda *_a, **_k: 0.015,
    )
    monkeypatch.setattr(
        "app.services.live_trading.position_query.query_exchange_position_size",
        lambda **_k: 0.012,
    )
    monkeypatch.setattr(
        "app.services.live_trading.position_query.fetch_allocated_position_size",
        lambda **_k: 0.02,
    )
    amount, meta = resolve_reduce_only_quantity(
        strategy_id=1,
        symbol="BTC/USDT",
        pos_side="long",
        requested_amount=0.015,
        client=MagicMock(),
        market_type="spot",
        exchange_config={},
        user_id=1,
        credential_id=2,
    )
    assert amount == pytest.approx(0.007)
    assert meta["capped_by"] == "account_allocation"


def test_spot_position_query_uses_total_inventory_including_locked():
    from app.services.live_trading.binance_spot import BinanceSpotClient
    from app.services.live_trading.position_query import query_exchange_position_size

    client = MagicMock(spec=BinanceSpotClient)
    client.get_account.return_value = {
        "balances": [{"asset": "BTC", "free": "0.6", "locked": "0.4"}],
    }

    qty = query_exchange_position_size(
        client=client,
        symbol="BTC/USDT",
        pos_side="long",
        market_type="spot",
        strict=True,
    )

    assert qty == pytest.approx(1.0)


def test_strict_spot_position_query_propagates_exchange_snapshot_failure():
    from app.services.live_trading.binance_spot import BinanceSpotClient
    from app.services.live_trading.position_query import query_exchange_position_size

    client = MagicMock(spec=BinanceSpotClient)
    client.get_account.side_effect = RuntimeError("spot account unavailable")

    with pytest.raises(RuntimeError, match="spot account unavailable"):
        query_exchange_position_size(
            client=client,
            symbol="BTC/USDT",
            pos_side="long",
            market_type="spot",
            strict=True,
        )


def test_okx_net_mode_long_position(monkeypatch):
    from app.services.live_trading.okx import OkxClient
    from app.services.live_trading.position_query import query_exchange_position_size

    class FakeOkx(OkxClient):
        def __init__(self):
            pass

        def get_positions(self, *, inst_id: str = "", inst_type: str = "SWAP"):
            return {
                "data": [
                    {
                        "instId": inst_id,
                        "posSide": "net",
                        "pos": "10",
                        "ctVal": "0.01",
                    }
                ]
            }

    qty = query_exchange_position_size(
        client=FakeOkx(),
        symbol="BNB/USDT",
        pos_side="long",
        market_type="swap",
    )
    assert qty == pytest.approx(0.1)


def test_okx_net_mode_short_ignored_for_long_query(monkeypatch):
    from app.services.live_trading.okx import OkxClient
    from app.services.live_trading.position_query import query_exchange_position_size

    class FakeOkx(OkxClient):
        def __init__(self):
            pass

        def get_positions(self, *, inst_id: str = "", inst_type: str = "SWAP"):
            return {
                "data": [
                    {
                        "instId": inst_id,
                        "posSide": "net",
                        "pos": "-10",
                        "ctVal": "0.01",
                    }
                ]
            }

    qty = query_exchange_position_size(
        client=FakeOkx(),
        symbol="BNB/USDT",
        pos_side="long",
        market_type="swap",
    )
    assert qty == 0.0


def test_binance_one_way_long_query(monkeypatch):
    from app.services.live_trading.binance import BinanceFuturesClient
    from app.services.live_trading.position_query import query_exchange_position_size

    class FakeBinance(BinanceFuturesClient):
        def __init__(self):
            pass

        def get_positions(self):
            return [
                {"symbol": "BNBUSDT", "positionSide": "BOTH", "positionAmt": "2.5"},
            ]

    qty = query_exchange_position_size(
        client=FakeBinance(),
        symbol="BNB/USDT",
        pos_side="long",
        market_type="swap",
    )
    assert qty == pytest.approx(2.5)


def test_binance_one_way_short_not_returned_as_long():
    from app.services.live_trading.binance import BinanceFuturesClient
    from app.services.live_trading.position_query import query_exchange_position_size

    class FakeBinance(BinanceFuturesClient):
        def __init__(self):
            pass

        def get_positions(self):
            return [
                {"symbol": "BNBUSDT", "positionSide": "BOTH", "positionAmt": "-2.5"},
            ]

    assert query_exchange_position_size(
        client=FakeBinance(),
        symbol="BNB/USDT",
        pos_side="long",
        market_type="swap",
    ) == 0.0
    assert query_exchange_position_size(
        client=FakeBinance(),
        symbol="BNB/USDT",
        pos_side="short",
        market_type="swap",
    ) == pytest.approx(2.5)


def test_bitget_one_way_total_without_hold_side():
    from app.services.live_trading.bitget import BitgetMixClient
    from app.services.live_trading.position_query import query_exchange_position_size

    class FakeBitget(BitgetMixClient):
        def __init__(self):
            pass

        def get_positions(self, *, product_type: str = "USDT-FUTURES", symbol: str = ""):
            return {
                "data": [
                    {"symbol": "BNBUSDT", "side": "buy", "total": "1.8"},
                ]
            }

    qty = query_exchange_position_size(
        client=FakeBitget(),
        symbol="BNB/USDT",
        pos_side="long",
        market_type="swap",
    )
    assert qty == pytest.approx(1.8)


def test_gate_flat_position_query_returns_zero_in_strict_mode():
    from app.services.live_trading.gate import GateUsdtFuturesClient
    from app.services.live_trading.position_query import query_exchange_position_size

    class FakeGate(GateUsdtFuturesClient):
        def __init__(self):
            pass

        def get_positions(self):
            return []

    qty = query_exchange_position_size(
        client=FakeGate(),
        symbol="BTC/USDT",
        pos_side="long",
        market_type="swap",
        strict=True,
    )
    assert qty == 0.0


def test_gate_dual_short_mode_is_not_misread_as_long():
    from app.services.live_trading.gate import GateUsdtFuturesClient
    from app.services.live_trading.position_query import query_exchange_position_size

    class FakeGate(GateUsdtFuturesClient):
        def __init__(self):
            pass

        def get_positions(self):
            return [
                {
                    "contract": "BTC_USDT",
                    "mode": "dual_short",
                    "size": "2",
                }
            ]

        def get_contract(self, *, contract):
            return {"quanto_multiplier": "0.001"}

    assert query_exchange_position_size(
        client=FakeGate(),
        symbol="BTC/USDT",
        pos_side="short",
        market_type="swap",
    ) == pytest.approx(0.002)
    assert query_exchange_position_size(
        client=FakeGate(),
        symbol="BTC/USDT",
        pos_side="long",
        market_type="swap",
    ) == 0.0
