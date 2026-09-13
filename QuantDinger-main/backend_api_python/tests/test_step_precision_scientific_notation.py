"""Precision inference from exchange step sizes below 1E-6.

Decimal.normalize() renders steps such as 0.0000001 as "1E-7". Parsing that
string for a '.' misreads the precision as 0, which truncates prices and
quantities to integers when they are rendered for the exchange.
"""

import time
from decimal import Decimal

from app.services.live_trading.binance_spot import BinanceSpotClient
from app.services.live_trading.bitget import BitgetMixClient
from app.services.live_trading.bybit import BybitClient


def _bybit_client(price_tick: str, qty_step: str) -> BybitClient:
    client = BybitClient(api_key="k", secret_key="s", category="linear")
    client._inst_cache["linear:1000PEPEUSDT"] = (
        time.time(),
        {
            "priceFilter": {"tickSize": price_tick},
            "lotSizeFilter": {"qtyStep": qty_step, "minOrderQty": "0"},
        },
    )
    return client


def _bitget_client(contract: dict) -> BitgetMixClient:
    client = BitgetMixClient.__new__(BitgetMixClient)
    client._contract_cache = {}
    client._contract_cache_ttl_sec = 300.0
    client.get_contract = lambda **_kwargs: contract
    return client


def test_bybit_small_tick_keeps_price_decimals():
    client = _bybit_client("0.0000001", "100")
    price, precision = client._normalize_price(symbol="1000PEPE/USDT", price=0.01234567)
    assert precision == 7
    assert client._dec_str(price, strict_precision=precision) == "0.0123456"


def test_bybit_small_qty_step_keeps_qty_decimals():
    client = _bybit_client("0.01", "0.00000001")
    qty, precision = client._normalize_qty(symbol="1000PEPE/USDT", qty=0.123456789)
    assert precision == 8
    assert client._dec_str(qty, strict_precision=precision) == "0.12345678"


def test_bitget_small_price_step_keeps_price_decimals():
    client = _bitget_client({"priceStep": "0.0000001"})
    price, precision = client._normalize_price(
        symbol="PEPE/USDT", product_type="USDT-FUTURES", price=0.01234567
    )
    assert precision == 7
    assert client._dec_str(price, strict_precision=precision) == "0.0123456"


def test_bitget_small_size_step_keeps_size_decimals():
    client = _bitget_client({"sizeMultiplier": "0.00000001"})
    size, precision = client._normalize_size(
        symbol="BTC/USDT", product_type="USDT-FUTURES", base_size=0.123456789
    )
    assert precision == 8
    assert client._dec_str(size, strict_precision=precision) == "0.12345678"


def test_binance_decimal_places_from_small_step():
    assert BinanceSpotClient._decimal_places_from_step(Decimal("0.00000001")) == 8
    assert BinanceSpotClient._decimal_places_from_step(Decimal("0.00001000")) == 5
    assert BinanceSpotClient._decimal_places_from_step(Decimal("10")) == 0
