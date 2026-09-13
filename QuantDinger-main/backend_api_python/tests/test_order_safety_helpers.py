from decimal import Decimal

import pytest

from app.services.pending_orders.error_classification import classify_exchange_order_error
from app.services.pending_orders.order_budget import strategy_order_budget_snapshot
from app.services.pending_orders.order_quantities import (
    exchange_executable_base_quantity,
    reconciled_queue_status,
)
from app.services.strategy_runtime.bot_type import resolve_bot_type
from app.services.trading_executor import TradingExecutor


def test_spot_quote_amount_misread_as_base_quantity_is_blocked():
    snapshot = strategy_order_budget_snapshot(
        action="add_long",
        quantity=36.1659,
        price=63_000,
        initial_capital=1_000,
        leverage=1,
        market_type="spot",
        current_positions=(),
    )
    assert snapshot["allowed"] is False
    assert snapshot["reason"] == "strategy_budget_exceeded"
    assert snapshot["order_notional"] > 2_000_000


def test_reduce_order_is_never_blocked_by_entry_budget():
    snapshot = strategy_order_budget_snapshot(
        action="reduce_long",
        quantity=36,
        price=63_000,
        initial_capital=1_000,
        leverage=1,
        market_type="spot",
    )
    assert snapshot["allowed"] is True


class _OkxClient:
    def _normalize_order_size(self, **_kwargs):
        return Decimal("149"), 0

    def get_instrument(self, **_kwargs):
        return {"ctVal": "0.0001"}


class _GateClient:
    def _resolve_order_size(self, **_kwargs):
        return "74", None

    def contracts_signed_to_base_qty(self, **kwargs):
        return float(kwargs["contracts_signed"]) * 0.0001


@pytest.mark.parametrize(
    ("exchange_id", "client", "requested", "filled"),
    [
        ("okx", _OkxClient(), 0.014967300387, 0.0149),
        ("gate", _GateClient(), 0.007485690512, 0.0074),
    ],
)
def test_exchange_precision_quantity_is_terminal_after_full_executable_fill(
    exchange_id, client, requested, filled
):
    executable = exchange_executable_base_quantity(
        client,
        exchange_id=exchange_id,
        symbol="BTC/USDT",
        market_type="swap",
        requested=requested,
        exchange_config={},
    )
    status, reconciled = reconciled_queue_status(
        client,
        exchange_id=exchange_id,
        symbol="BTC/USDT",
        market_type="swap",
        requested=requested,
        filled=filled,
        avg_price=63_000,
        exchange_status="open",
        exchange_config={},
    )
    assert executable == pytest.approx(filled)
    assert reconciled == pytest.approx(filled)
    assert status == "filled"


def test_http_502_is_not_classified_as_order_size():
    result = classify_exchange_order_error("Binance HTTP 502: 502 Bad Gateway")
    assert result["category"] == "transport"
    assert result["retryable"] is True


def test_legacy_executor_type_routes_to_grid_engine():
    assert resolve_bot_type({"trading_config": {"executor_type": "grid"}}) == "grid"
    assert resolve_bot_type({"template_key": "robot_v2_layered_martingale"}) == "layered_martingale"


def test_legacy_grid_bot_params_route_to_resting_grid_engine():
    assert resolve_bot_type({
        "trading_config": {
            "bot_params": {
                "gridCount": 100,
                "lowerPrice": 0.63,
                "upperPrice": 1.36,
            },
        },
    }) == "grid"


def test_generated_grid_source_recovers_missing_runtime_metadata():
    source = """
GRID_TEMPLATE_VERSION = 6
CELL_LOWER = [0.9]
CELL_UPPER = [1.0]
CELL_ROLES = ['long_entry']
MAX_OPEN_ENTRY_ORDERS = 1
"""

    assert resolve_bot_type({}, {}, source_code=source) == "grid"


@pytest.mark.parametrize(
    ("expected", "source"),
    [
        (
            "dca",
            "DCA_TEMPLATE_VERSION\nDCA_INTERVAL_MINUTES\nDCA_MAX_ORDERS\n"
            "DCA_TOTAL_BUDGET_PCT\ndef _reconcile_purchase():\n    pass\n",
        ),
        (
            "martingale",
            '"""Strategy API V2 martingale robot generated from the visual builder."""\n'
            "ROBOT_TEMPLATE_VERSION = 6\nENTRY_TRIGGER_MODE = 'realtime_price'\n"
            "PRICE_LEVELS = [1]\ndef on_price_tick(context, prices):\n    pass\n",
        ),
        (
            "layered_martingale",
            '"""Strategy API V2 layered martingale robot generated from the visual builder."""\n'
            "ROBOT_TEMPLATE_VERSION = 6\nENTRY_TRIGGER_MODE = 'realtime_price'\n"
            "PRICE_LEVELS = [1]\ndef on_price_tick(context, prices):\n    pass\n",
        ),
    ],
)
def test_generated_non_grid_robot_source_recovers_missing_runtime_metadata(expected, source):
    assert resolve_bot_type({}, {}, source_code=source) == expected


def test_generated_grid_constants_recover_missing_deployed_bot_params():
    recovered = TradingExecutor._recover_generated_grid_config(
        {"leverage": 3},
        {
            "CELL_LOWER": [0.90, 0.95],
            "CELL_UPPER": [0.95, 1.00],
            "GRID_SIDE": "long",
            "DYNAMIC_ANCHOR": True,
            "INITIAL_POSITION_PCT": 0.55,
            "MAX_OPEN_ENTRY_ORDERS": 2,
            "EQUITY_TAKE_PROFIT": 0.2,
        },
    )

    assert recovered["bot_type"] == "grid"
    assert recovered["executor_type"] == "grid"
    assert recovered["bot_params"] == {
        "lowerPrice": 0.90,
        "upperPrice": 1.00,
        "gridCount": 2,
        "gridCountUnit": "cells",
        "amountPerGridPct": pytest.approx(0.5),
        "gridMode": "arithmetic",
        "gridDirection": "long",
        "initialPositionPct": pytest.approx(0.55),
        "orderMode": "maker",
        "boundaryAction": "pause",
        "maxOpenOrders": 2,
        "dynamicAnchor": True,
    }
    assert recovered["equity_take_profit_pct"] == pytest.approx(0.2)
