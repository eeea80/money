from __future__ import annotations

from app.services.live_trading.okx import OkxClient


def _fake_okx_client() -> OkxClient:
    client = object.__new__(OkxClient)
    client.seen_params = []

    def fake_signed_request(method, path, params=None, body=None):
        client.seen_params.append({"method": method, "path": path, "params": dict(params or {})})
        return {"data": [{"maker": "-0.0002", "taker": "-0.0005"}]}

    client._signed_request = fake_signed_request
    return client


def test_okx_fee_rate_uses_swap_inst_id():
    client = _fake_okx_client()

    result = client.get_fee_rate("SOL/USDT", market_type="swap")

    assert result == {"maker": 0.0002, "taker": 0.0005}
    assert client.seen_params[-1]["params"] == {"instType": "SWAP", "instId": "SOL-USDT-SWAP"}


def test_okx_fee_rate_uses_spot_inst_id():
    client = _fake_okx_client()

    result = client.get_fee_rate("SOL/USDT", market_type="spot")

    assert result == {"maker": 0.0002, "taker": 0.0005}
    assert client.seen_params[-1]["params"] == {"instType": "SPOT", "instId": "SOL-USDT"}
