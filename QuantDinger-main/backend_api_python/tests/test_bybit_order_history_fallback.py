from __future__ import annotations

from app.services.live_trading.bybit import BybitClient


def test_get_order_falls_back_to_history_after_fast_fill():
    client = BybitClient.__new__(BybitClient)
    client.category = "linear"
    calls = []

    def request(method, path, *, params=None, **_kwargs):
        calls.append((method, path, params))
        if path == "/v5/order/realtime":
            return {"retCode": 0, "result": {"list": []}}
        return {
            "retCode": 0,
            "result": {
                "list": [
                    {
                        "orderId": "fast-fill-1",
                        "orderStatus": "Filled",
                        "cumExecQty": "0.001",
                        "avgPrice": "64000",
                    }
                ]
            },
        }

    client._signed_request = request

    order = client.get_order(symbol="BTC/USDT", order_id="fast-fill-1")

    assert order["orderStatus"] == "Filled"
    assert [path for _, path, _ in calls] == ["/v5/order/realtime", "/v5/order/history"]
