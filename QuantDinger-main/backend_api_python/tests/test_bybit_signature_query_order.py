from __future__ import annotations

from urllib.parse import urlencode

from app.services.live_trading.bybit import BybitClient


def test_bybit_signed_request_sends_the_same_query_order_it_signs(monkeypatch):
    client = BybitClient(api_key="key", secret_key="secret")
    captured = {}

    def fake_request(method, path, **kwargs):
        captured.update({"method": method, "path": path, **kwargs})
        return 200, {"retCode": 0, "result": {}}, "{}"

    monkeypatch.setattr(client, "_request", fake_request)
    monkeypatch.setattr(client, "sync_server_time_offset", lambda **_kwargs: None)
    monkeypatch.setattr("app.services.live_trading.bybit.time.time", lambda: 1_700_000_000)

    client._signed_request(
        "GET",
        "/v5/order/history",
        params={"category": "linear", "symbol": "BTCUSDT", "orderId": "order-1"},
    )

    sent_params = captured["params"]
    assert list(sent_params) == ["category", "orderId", "symbol"]
    payload = urlencode(list(sent_params.items()))
    expected = client._sign(f"1700000000000key{client.recv_window_ms}{payload}")
    assert captured["headers"]["X-BAPI-SIGN"] == expected
