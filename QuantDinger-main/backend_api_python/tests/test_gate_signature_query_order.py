"""Gate signatures must use the exact query order sent over HTTP."""

from urllib.parse import urlencode

from app.services.live_trading.gate import GateUsdtFuturesClient


def test_gate_signed_request_sends_the_same_query_order_it_signs(monkeypatch):
    client = GateUsdtFuturesClient(api_key="key", secret_key="secret")
    captured = {}

    def fake_request(method, path, **kwargs):
        captured.update({"method": method, "path": path, **kwargs})
        return 200, {}, "{}"

    monkeypatch.setattr(client, "_request", fake_request)
    monkeypatch.setattr("app.services.live_trading.gate.time.time", lambda: 1_700_000_000)

    client._signed_request(
        "POST",
        "/api/v4/futures/usdt/positions/BTC_USDT/leverage",
        params={"leverage": "0", "cross_leverage_limit": "5"},
    )

    sent_params = captured["params"]
    assert list(sent_params) == ["cross_leverage_limit", "leverage"]
    query_string = urlencode(list(sent_params.items()))
    expected = client._sign(
        method="POST",
        url=captured["path"],
        query_string=query_string,
        body_str="",
        ts="1700000000",
    )
    assert captured["headers"]["SIGN"] == expected

