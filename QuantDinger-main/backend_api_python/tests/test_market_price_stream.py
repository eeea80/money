import time

from app.services.market_price_stream import PublicMarketPriceFeed


def _feed(exchange_id="binance", market_type="swap", fallback=None):
    return PublicMarketPriceFeed(
        exchange_id=exchange_id,
        market_type=market_type,
        instruments=[{
            "key": "Crypto:BTC/USDT@binance:swap",
            "symbol": "BTC/USDT",
        }],
        rest_fallback=fallback or (lambda: {}),
    )


def test_public_price_feed_normalizes_binance_and_okx_symbols():
    binance = _feed("binance")
    for symbol, price in binance._parse({"data": {"s": "BTCUSDT", "p": "101.5"}}):
        binance._update(symbol, price)
    snapshot = binance.snapshot(max_age_seconds=5)
    assert snapshot.prices["Crypto:BTC/USDT@binance:swap"] == 101.5
    assert snapshot.source == "public_websocket"

    okx = PublicMarketPriceFeed(
        exchange_id="okx",
        market_type="swap",
        instruments=[{"key": "Crypto:BTC/USDT@okx:swap", "symbol": "BTC/USDT"}],
        rest_fallback=lambda: {},
    )
    for symbol, price in okx._parse({"data": [{"instId": "BTC-USDT-SWAP", "last": "102"}]}):
        okx._update(symbol, price)
    assert okx.snapshot().prices["Crypto:BTC/USDT@okx:swap"] == 102


def test_public_price_feed_uses_rest_only_for_missing_or_stale_prices():
    feed = _feed(fallback=lambda: {"Crypto:BTC/USDT@binance:swap": 99.0})
    fallback = feed.snapshot(max_age_seconds=1)
    assert fallback.source == "rest_fallback"
    assert fallback.prices["Crypto:BTC/USDT@binance:swap"] == 99.0

    feed._prices["Crypto:BTC/USDT@binance:swap"] = (101.0, time.monotonic())
    streamed = feed.snapshot(max_age_seconds=1)
    assert streamed.source == "public_websocket"
    assert streamed.prices["Crypto:BTC/USDT@binance:swap"] == 101.0
