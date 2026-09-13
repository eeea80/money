from app.services.live_trading.okx import OkxClient
from app.services.quick_trade.orders import enrich_fill


def test_quick_trade_calls_okx_wait_for_fill_with_public_signature(monkeypatch):
    client = OkxClient(api_key="key", secret_key="secret", passphrase="passphrase")
    captured = {}

    def fake_wait_for_fill(**kwargs):
        captured.update(kwargs)
        return {"filled": 0.25, "avg_price": 100.0, "state": "filled"}

    monkeypatch.setattr(client, "wait_for_fill", fake_wait_for_fill)

    result = enrich_fill(
        client,
        order_id="order-1",
        symbol="BTC/USDT",
        market_type="swap",
        max_wait_sec=0.1,
    )

    assert captured == {
        "symbol": "BTC/USDT",
        "ord_id": "order-1",
        "market_type": "swap",
        "max_wait_sec": 0.1,
    }
    assert result["filled"] == 0.25
    assert result["status"] == "filled"


def test_okx_wait_for_fill_converts_contracts_to_base_quantity(monkeypatch):
    client = OkxClient(api_key="key", secret_key="secret", passphrase="passphrase")
    monkeypatch.setattr(client, "get_instrument", lambda **_: {"ctVal": "0.01"})
    monkeypatch.setattr(
        client,
        "get_order",
        lambda **_: {"state": "filled", "accFillSz": "9430", "avgPx": "12.5"},
    )
    monkeypatch.setattr(client, "get_order_fills", lambda **_: {"data": []})

    result = client.wait_for_fill(
        symbol="BNB/USDT",
        ord_id="order-2",
        market_type="swap",
        max_wait_sec=0,
    )

    assert result["filled"] == 94.3
    assert result["avg_price"] == 12.5
