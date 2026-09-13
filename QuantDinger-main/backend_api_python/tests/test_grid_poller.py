"""Tests for grid poller scheduling and runtime state helpers."""

from __future__ import annotations

import time
from unittest.mock import MagicMock, patch

import pytest

from app.services.grid.poller import GridFillPoller
from app.services.grid.resting_orders_repo import GridRestingOrder
from app.services.grid.runtime_state import load_grid_resting_state


def test_load_grid_resting_state_initial_flag():
    tc = {"script_runtime_state": {"grid_resting": {"initial_market_done": True}}}
    assert load_grid_resting_state(tc).get("initial_market_done") is True


def test_poller_select_orders_respects_interval():
    poller = GridFillPoller()
    poller._min_order_interval = 100.0
    order = GridRestingOrder(id=1, strategy_id=99, symbol="BTC/USDT", status="open")
    poller._last_poll_by_order[1] = time.time()
    with patch("app.services.grid.poller.get_runner", return_value=MagicMock()):
        selected = poller._select_orders([order])
    assert selected == []


def test_poller_select_orders_prioritizes_partial():
    poller = GridFillPoller()
    poller._min_order_interval = 0.0
    partial = GridRestingOrder(id=1, strategy_id=1, symbol="BTC/USDT", status="partial")
    open_o = GridRestingOrder(id=2, strategy_id=1, symbol="BTC/USDT", status="open")
    runner = MagicMock()
    with patch("app.services.grid.poller.get_runner", return_value=runner):
        selected = poller._select_orders([open_o, partial])
    assert selected[0].status == "partial"


def test_poller_idempotent_skip_when_processed():
    poller = GridFillPoller()
    runner = MagicMock()
    order = GridRestingOrder(
        id=10,
        strategy_id=1,
        symbol="BTC/USDT",
        quantity=1.0,
        processed_fill_qty=1.0,
        filled_quantity=1.0,
        status="open",
    )
    with patch("app.services.grid.poller.query_grid_order_fill", return_value=(1.0, 100.0, "filled")):
        with patch.object(poller._repo, "update_status") as upd:
            poller._poll_order(runner, MagicMock(), order, "swap")
            upd.assert_called()
            args = upd.call_args
        assert args[0][0] == 10


def test_poller_dispatches_partial_fill_immediately():
    poller = GridFillPoller()
    runner = MagicMock()
    order = GridRestingOrder(
        id=11,
        strategy_id=1,
        symbol="BTC/USDT",
        price=100.0,
        quantity=1.0,
        processed_fill_qty=0.0,
        filled_quantity=0.0,
        status="open",
    )

    with patch("app.services.grid.poller.query_grid_order_fill", return_value=(0.4, 99.5, "partial")):
        with patch.object(poller._repo, "update_status") as update:
            poller._poll_order(runner, MagicMock(), order, "swap")

    runner.engine.on_order_filled.assert_called_once_with(order, 0.4, 99.5)
    assert update.call_args.kwargs["status"] == "partial"
    assert update.call_args.kwargs["processed_fill_qty"] == pytest.approx(0.4)


def test_poller_retries_fill_when_local_ledger_posting_fails():
    poller = GridFillPoller()
    runner = MagicMock()
    runner.engine.on_order_filled.side_effect = RuntimeError("ledger unavailable")
    order = GridRestingOrder(
        id=14,
        strategy_id=1,
        symbol="BTC/USDT",
        price=100.0,
        quantity=1.0,
        processed_fill_qty=0.0,
        filled_quantity=0.0,
        status="open",
    )

    with patch(
        "app.services.grid.poller.query_grid_order_fill",
        return_value=(0.4, 99.5, "partial"),
    ):
        with patch.object(poller._repo, "update_status") as update:
            poller._poll_order(runner, MagicMock(), order, "swap")

    runner.engine.on_order_filled.assert_called_once_with(order, 0.4, 99.5)
    assert update.call_args.kwargs["status"] == "partial"
    assert update.call_args.kwargs["filled_quantity"] == pytest.approx(0.4)
    assert update.call_args.kwargs["processed_fill_qty"] == pytest.approx(0.0)


def test_poller_reconciles_cancelled_partial_fill():
    poller = GridFillPoller()
    runner = MagicMock()
    order = GridRestingOrder(
        id=12,
        strategy_id=1,
        symbol="BTC/USDT",
        price=100.0,
        quantity=1.0,
        processed_fill_qty=0.0,
        filled_quantity=0.0,
        status="open",
    )

    with patch("app.services.grid.poller.query_grid_order_fill", return_value=(0.25, 100.5, "cancelled")):
        with patch.object(poller._repo, "update_status") as update:
            poller._poll_order(runner, MagicMock(), order, "swap")

    runner.engine.on_order_filled.assert_called_once_with(order, 0.25, 100.5)
    runner.engine.sync_held_cell_exits.assert_called_once_with(100.5)
    assert update.call_args.kwargs["status"] == "cancelled"


def test_poller_posts_exchange_fee_with_rest_fallback():
    poller = GridFillPoller()
    runner = MagicMock()
    runner.exchange_config = {"exchange_id": "gate", "credential_id": 1}
    order = GridRestingOrder(
        id=13,
        strategy_id=1,
        symbol="BTC/USDT",
        price=100.0,
        quantity=1.0,
        exchange_order_id="gate-13",
        processed_fill_qty=0.0,
        status="open",
    )

    def fake_wait(*args, **kwargs):
        kwargs["details"].update(
            {"fee": 0.05, "fee_ccy": "USDT", "filled": 1.0, "avg_price": 100.0}
        )
        return 1.0, 100.0

    with patch("app.services.grid.poller.query_grid_order_fill", return_value=(1.0, 100.0, "filled")):
        with patch("app.services.grid.poller.wait_grid_market_fill", side_effect=fake_wait):
            with patch.object(poller._repo, "update_status"):
                poller._poll_order(runner, MagicMock(), order, "swap")

    runner.engine.on_order_filled.assert_called_once_with(
        order,
        1.0,
        100.0,
        commission=pytest.approx(0.05),
        commission_ccy="USDT",
        commission_quote=pytest.approx(0.05),
        fee_status="actual",
        fee_source="rest",
    )


def test_poller_persists_authoritative_zero_fee():
    poller = GridFillPoller()
    runner = MagicMock()
    runner.exchange_config = {"exchange_id": "binance", "credential_id": 1}
    order = GridRestingOrder(
        id=14,
        strategy_id=1,
        symbol="BTC/USDT",
        price=100.0,
        quantity=1.0,
        exchange_order_id="binance-14",
        processed_fill_qty=0.0,
        status="open",
    )

    def fake_wait(*args, **kwargs):
        kwargs["details"].update(
            {
                "filled": 1.0,
                "avg_price": 100.0,
                "fees_by_ccy": {"USDT": 0.0},
                "fee_status": "actual_zero",
            }
        )
        return 1.0, 100.0

    with patch(
        "app.services.grid.poller.query_grid_order_fill",
        return_value=(1.0, 100.0, "filled"),
    ), patch(
        "app.services.grid.poller.wait_grid_market_fill",
        side_effect=fake_wait,
    ), patch.object(poller._repo, "update_status"):
        poller._poll_order(runner, MagicMock(), order, "swap")

    runner.engine.on_order_filled.assert_called_once_with(
        order,
        1.0,
        100.0,
        commission=0.0,
        commission_ccy="",
        commission_quote=None,
        fee_status="actual_zero",
        fee_source="rest",
    )
