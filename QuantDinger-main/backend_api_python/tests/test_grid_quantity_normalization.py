import pytest

from app.services import instrument_rules
from app.services.grid.exchange_orders import normalize_grid_order_quantity
from app.services.instrument_rules import InstrumentRules
from app.services.live_trading.base import BaseRestClient
from app.services.live_trading.gate import GateSpotClient, GateUsdtFuturesClient
from app.services.live_trading.htx import HtxClient


def _gate_client(order_size_min="1", multiplier="0.0001"):
    client = GateUsdtFuturesClient.__new__(GateUsdtFuturesClient)
    client.get_contract = lambda **_kwargs: {
        "order_size_min": order_size_min,
        "quanto_multiplier": multiplier,
    }
    return client


def test_gate_futures_never_rounds_sub_minimum_quantity_up():
    client = _gate_client()

    size, headers = client._resolve_order_size(
        contract="BTC_USDT",
        side="sell",
        base_size=0.00005,
    )

    assert size == "0"
    assert headers is None


def test_gate_grid_quantity_is_floored_and_returned_in_base_units():
    client = _gate_client()

    assert normalize_grid_order_quantity(
        client,
        symbol="BTC/USDT",
        quantity=0.00039,
        market_type="swap",
    ) == 0.0003
    assert normalize_grid_order_quantity(
        client,
        symbol="BTC/USDT",
        quantity=0.00005,
        market_type="swap",
    ) == 0.0


def test_htx_futures_never_rounds_sub_contract_quantity_up():
    client = HtxClient.__new__(HtxClient)
    client.get_contract_info = lambda **_kwargs: {"contract_size": "0.001"}

    assert client._base_to_contracts(symbol="BTC/USDT", qty=0.0005) == 0


def test_gate_spot_grid_rejects_float_dust_and_floors_native_precision():
    client = GateSpotClient.__new__(GateSpotClient)
    client.get_currency_pair = lambda **_kwargs: {
        "amount_precision": 6,
        "precision": 2,
        "min_base_amount": "0.0001",
        "min_quote_amount": "1",
    }

    assert normalize_grid_order_quantity(
        client,
        symbol="BTC/USDT",
        quantity=3.3532799999999997e-07,
        market_type="spot",
        price=100_000,
    ) == 0.0
    assert normalize_grid_order_quantity(
        client,
        symbol="BTC/USDT",
        quantity=0.0001239,
        market_type="spot",
        price=100_000,
    ) == pytest.approx(0.000123)


def test_htx_spot_grid_rejects_float_dust_and_minimum_notional():
    client = HtxClient.__new__(HtxClient)
    client.get_spot_symbol_info = lambda **_kwargs: {
        "amount-precision": 6,
        "price-precision": 2,
        "min-order-amt": "0.0001",
        "min-order-value": "1",
    }

    assert normalize_grid_order_quantity(
        client,
        symbol="BTC/USDT",
        quantity=3.3532799999999997e-07,
        market_type="spot",
        price=100_000,
    ) == 0.0
    assert normalize_grid_order_quantity(
        client,
        symbol="BTC/USDT",
        quantity=0.0001,
        market_type="spot",
        price=5_000,
    ) == 0.0


@pytest.mark.parametrize("exchange_id", ["binance", "okx", "bitget", "bybit", "gate", "htx"])
@pytest.mark.parametrize("market_type", ["spot", "swap"])
def test_all_grid_exchanges_apply_common_minimum_rules(
    monkeypatch,
    exchange_id,
    market_type,
):
    rules = InstrumentRules(
        key=f"Crypto:BTC/USDT@{exchange_id}:{market_type}",
        exchange_id=exchange_id,
        market_type=market_type,
        symbol="BTC/USDT",
        amount_step=0.001,
        min_amount=0.01,
        min_notional=5.0,
    )

    class FakeProvider:
        def get_rules(self, *_args, **_kwargs):
            return rules

    monkeypatch.setattr(instrument_rules, "get_instrument_rules_provider", lambda: FakeProvider())
    client = BaseRestClient("https://example.invalid")

    assert normalize_grid_order_quantity(
        client,
        symbol="BTC/USDT",
        quantity=0.0099,
        market_type=market_type,
        exchange_config={"exchange_id": exchange_id},
        price=1_000,
    ) == 0.0
    assert normalize_grid_order_quantity(
        client,
        symbol="BTC/USDT",
        quantity=0.0129,
        market_type=market_type,
        exchange_config={"exchange_id": exchange_id},
        price=100,
    ) == 0.0
    assert normalize_grid_order_quantity(
        client,
        symbol="BTC/USDT",
        quantity=0.1239,
        market_type=market_type,
        exchange_config={"exchange_id": exchange_id},
        price=100,
    ) == pytest.approx(0.123)
