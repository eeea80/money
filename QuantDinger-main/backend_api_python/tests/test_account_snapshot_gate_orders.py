import pytest

from app.services.live_trading.account_snapshot import (
    _fetch_gate_open_orders,
    _fetch_multi_crypto_snapshot,
    _parse_gate_futures_orders,
    _parse_gate_spot_orders,
)
from app.services.live_trading.gate import GateSpotClient, GateUsdtFuturesClient


def test_parse_gate_spot_open_order_groups():
    rows = _parse_gate_spot_orders(
        [
            {
                "currency_pair": "BTC_USDT",
                "total": 1,
                "orders": [
                    {
                        "id": "spot-1",
                        "side": "buy",
                        "type": "limit",
                        "amount": "0.001",
                        "left": "0.0007",
                        "price": "78000.5",
                        "status": "open",
                    }
                ],
            }
        ]
    )

    assert len(rows) == 1
    assert rows[0]["symbol"] == "BTC/USDT"
    assert rows[0]["side"] == "buy"
    assert rows[0]["market_type"] == "spot"
    assert rows[0]["order_type"] == "limit"
    assert rows[0]["price"] == 78000.5
    assert rows[0]["amount"] == 0.001
    assert rows[0]["filled"] == pytest.approx(0.0003)
    assert rows[0]["exchange_order_id"] == "spot-1"
    assert rows[0]["status"] == "open"
    assert rows[0]["inst_id"] == "BTC_USDT"


def test_parse_gate_futures_open_orders_converts_contracts_to_base_size():
    class ContractClient:
        def get_contract(self, *, contract):
            assert contract == "BTC_USDT"
            return {"quanto_multiplier": "0.0001"}

    rows = _parse_gate_futures_orders(
        [
            {
                "id_string": "swap-1",
                "contract": "BTC_USDT",
                "size": "10",
                "left": "6",
                "price": "77000",
                "status": "open",
            }
        ],
        client=ContractClient(),
    )

    assert len(rows) == 1
    assert rows[0]["symbol"] == "BTC/USDT"
    assert rows[0]["side"] == "buy"
    assert rows[0]["market_type"] == "swap"
    assert rows[0]["amount"] == 0.001
    assert rows[0]["filled"] == pytest.approx(0.0004)
    assert rows[0]["exchange_order_id"] == "swap-1"


def test_fetch_gate_open_orders_keeps_spot_when_futures_fails(monkeypatch):
    swap = GateUsdtFuturesClient(api_key="k", secret_key="s")
    spot = GateSpotClient(api_key="k", secret_key="s")

    def fail_futures(*, limit):
        raise RuntimeError("futures unavailable")

    monkeypatch.setattr(swap, "get_open_orders", fail_futures)
    monkeypatch.setattr(
        spot,
        "get_open_orders",
        lambda *, limit: [
            {
                "currency_pair": "ETH_USDT",
                "orders": [
                    {
                        "id": "spot-2",
                        "side": "sell",
                        "type": "limit",
                        "amount": "0.2",
                        "left": "0.2",
                        "price": "4000",
                        "status": "open",
                    }
                ],
            }
        ],
    )

    errors = []
    rows = _fetch_gate_open_orders(swap, spot, errors)

    assert [row["exchange_order_id"] for row in rows] == ["spot-2"]
    assert len(errors) == 1
    assert "GATE 合约挂单" in errors[0]


def test_gate_multi_market_snapshot_includes_spot_and_futures_orders(monkeypatch):
    swap = GateUsdtFuturesClient(api_key="k", secret_key="s")
    spot = GateSpotClient(api_key="k", secret_key="s")
    monkeypatch.setattr(
        "app.services.live_trading.account_snapshot.create_client",
        lambda _config, *, market_type: spot if market_type == "spot" else swap,
    )
    monkeypatch.setattr(
        "app.services.live_trading.account_snapshot._fetch_swap_positions_snapshot",
        lambda *_args: [],
    )
    monkeypatch.setattr(
        "app.services.live_trading.account_snapshot._fetch_spot_wallet",
        lambda *_args, **_kwargs: [],
    )
    monkeypatch.setattr(
        swap,
        "get_open_orders",
        lambda *, limit: [
            {
                "id_string": "swap-2",
                "contract": "ETH_USDT",
                "size": "-2",
                "left": "-2",
                "price": "4000",
            }
        ],
    )
    monkeypatch.setattr(
        swap,
        "get_contract",
        lambda *, contract: {"quanto_multiplier": "0.01"},
    )
    monkeypatch.setattr(
        spot,
        "get_open_orders",
        lambda *, limit: [
            {
                "currency_pair": "BTC_USDT",
                "orders": [
                    {
                        "id": "spot-3",
                        "side": "buy",
                        "amount": "0.01",
                        "left": "0.01",
                        "price": "78000",
                    }
                ],
            }
        ],
    )

    errors = []
    _, _, rows = _fetch_multi_crypto_snapshot(
        {"exchange_id": "gate"},
        "gate",
        errors,
    )

    assert not errors
    assert {row["exchange_order_id"] for row in rows} == {"swap-2", "spot-3"}
    assert {row["market_type"] for row in rows} == {"swap", "spot"}
