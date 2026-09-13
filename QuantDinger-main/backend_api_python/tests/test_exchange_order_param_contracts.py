from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Dict, Type
from unittest.mock import MagicMock

import pytest

from app.services.grid.exchange_orders import place_grid_limit_order
from app.services.live_trading.base import LiveOrderResult
from app.services.live_trading.binance import BinanceFuturesClient
from app.services.live_trading.binance_spot import BinanceSpotClient
from app.services.live_trading.bitget import BitgetMixClient
from app.services.live_trading.bitget_spot import BitgetSpotClient
from app.services.live_trading.bybit import BybitClient
from app.services.live_trading.gate import GateSpotClient, GateUsdtFuturesClient
from app.services.live_trading.okx import OkxClient


@dataclass(frozen=True)
class OrderParamCase:
    case_id: str
    client_cls: Type
    market_type: str
    side: str
    pos_side: str
    reduce_only: bool
    expected: Dict[str, Any]
    exchange_config: Dict[str, Any] | None = None


CASES = (
    OrderParamCase(
        "binance_futures_close_long_reduce_only",
        BinanceFuturesClient,
        "swap",
        "sell",
        "long",
        True,
        {
            "symbol": "BTC/USDT",
            "side": "SELL",
            "quantity": 0.01,
            "price": 70000.0,
            "reduce_only": True,
            "position_side": "long",
            "client_order_id": "coid-1",
        },
    ),
    OrderParamCase(
        "binance_spot_open_buy_no_reduce_only",
        BinanceSpotClient,
        "spot",
        "buy",
        "",
        False,
        {
            "symbol": "BTC/USDT",
            "side": "BUY",
            "quantity": 0.01,
            "price": 70000.0,
            "client_order_id": "coid-1",
        },
    ),
    OrderParamCase(
        "okx_swap_close_short",
        OkxClient,
        "swap",
        "buy",
        "short",
        True,
        {
            "market_type": "swap",
            "symbol": "BTC/USDT",
            "side": "buy",
            "size": 0.01,
            "price": 70000.0,
            "pos_side": "short",
            "td_mode": "cross",
            "reduce_only": True,
            "client_order_id": "coid-1",
        },
    ),
    OrderParamCase(
        "bitget_mix_open_short_with_product_type",
        BitgetMixClient,
        "swap",
        "sell",
        "short",
        False,
        {
            "symbol": "BTC/USDT",
            "side": "sell",
            "size": 0.01,
            "price": 70000.0,
            "margin_coin": "USDT",
            "product_type": "USDT-FUTURES",
            "margin_mode": "cross",
            "reduce_only": False,
            "post_only": True,
            "client_order_id": "coid-1",
            "hold_side": "short",
        },
        {"product_type": "USDT-FUTURES", "margin_coin": "USDT"},
    ),
    OrderParamCase(
        "bitget_spot_buy",
        BitgetSpotClient,
        "spot",
        "buy",
        "",
        False,
        {
            "symbol": "BTC/USDT",
            "side": "buy",
            "size": 0.01,
            "price": 70000.0,
            "client_order_id": "coid-1",
        },
    ),
    OrderParamCase(
        "bybit_close_long",
        BybitClient,
        "swap",
        "sell",
        "long",
        True,
        {
            "symbol": "BTC/USDT",
            "side": "sell",
            "qty": 0.01,
            "price": 70000.0,
            "reduce_only": True,
            "pos_side": "long",
            "client_order_id": "coid-1",
        },
    ),
    OrderParamCase(
        "gate_spot_sell",
        GateSpotClient,
        "spot",
        "sell",
        "",
        False,
        {
            "symbol": "BTC/USDT",
            "side": "sell",
            "size": 0.01,
            "price": 70000.0,
            "client_order_id": "coid-1",
        },
    ),
    OrderParamCase(
        "gate_futures_close_short",
        GateUsdtFuturesClient,
        "swap",
        "buy",
        "short",
        True,
        {
            "symbol": "BTC/USDT",
            "side": "buy",
            "size": 0.01,
            "price": 70000.0,
            "reduce_only": True,
            "client_order_id": "coid-1",
        },
    ),
)


def _make_client(client_cls: Type) -> MagicMock:
    client = MagicMock()
    client.__class__ = client_cls
    client.place_limit_order.return_value = LiveOrderResult(
        exchange_id="test",
        exchange_order_id="oid-1",
        filled=0.0,
        avg_price=0.0,
        raw={},
    )
    return client


@pytest.mark.parametrize("case", CASES, ids=lambda c: c.case_id)
def test_place_grid_limit_order_param_contract(case: OrderParamCase):
    client = _make_client(case.client_cls)

    result = place_grid_limit_order(
        client,
        symbol="BTC/USDT",
        side=case.side,
        quantity=0.01,
        price=70000.0,
        market_type=case.market_type,
        exchange_config=case.exchange_config or {},
        pos_side=case.pos_side,
        reduce_only=case.reduce_only,
        client_order_id="coid-1",
        leverage=3.0,
        margin_mode="cross",
        post_only=True,
    )

    assert result.exchange_order_id == "oid-1"
    assert client.place_limit_order.call_args.kwargs == case.expected


def test_place_grid_limit_order_sets_leverage_for_contract_clients():
    client = _make_client(BitgetMixClient)

    place_grid_limit_order(
        client,
        symbol="BTC/USDT",
        side="buy",
        quantity=0.01,
        price=70000.0,
        market_type="swap",
        exchange_config={"product_type": "USDT-FUTURES", "margin_coin": "USDT"},
        pos_side="long",
        leverage=5.0,
        margin_mode="cross",
    )

    client.set_leverage.assert_called_once()
    assert client.set_leverage.call_args.kwargs["hold_side"] == "long"
    assert client.set_leverage.call_args.kwargs["product_type"] == "USDT-FUTURES"


@pytest.mark.parametrize(
    ("physical_side", "position_side", "reduce_only", "expected_side", "expected_trade"),
    (
        ("buy", "long", False, "buy", "open"),
        ("sell", "short", False, "sell", "open"),
        ("sell", "long", True, "buy", "close"),
        ("buy", "short", True, "sell", "close"),
    ),
)
def test_bitget_v2_hedge_order_fields_follow_documented_position_direction(
    physical_side,
    position_side,
    reduce_only,
    expected_side,
    expected_trade,
):
    client = BitgetMixClient.__new__(BitgetMixClient)
    client.get_account_pos_mode = lambda **_kwargs: "hedge_mode"

    fields = client._mix_order_position_fields(
        symbol="BTC/USDT",
        side=physical_side,
        reduce_only=reduce_only,
        margin_coin="USDT",
        product_type="USDT-FUTURES",
        hold_side=position_side,
    )

    assert fields == {"side": expected_side, "tradeSide": expected_trade}
    assert "holdSide" not in fields


@pytest.mark.parametrize(("position_mode", "expects_reduce_only"), (("net", True), ("long", False)))
def test_okx_reduce_only_is_only_sent_in_net_mode(position_mode, expects_reduce_only):
    client = OkxClient.__new__(OkxClient)
    client.broker_code = ""
    client._normalize_order_size = lambda **_kwargs: (Decimal("1"), 0)
    client._resolve_pos_side = lambda **_kwargs: position_mode
    sent = []
    client._signed_request = (
        lambda method, path, json_body=None, params=None: sent.append(json_body)
        or {"data": [{"ordId": "1"}]}
    )

    client.place_market_order(
        symbol="BTC/USDT",
        side="sell",
        size=0.01,
        market_type="swap",
        pos_side="long",
        reduce_only=True,
    )

    assert ("reduceOnly" in sent[0]) is expects_reduce_only
