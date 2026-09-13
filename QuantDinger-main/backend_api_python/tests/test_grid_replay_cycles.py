import pandas as pd
import pytest

from app.services.strategy_runtime.robot_v2 import _build_grid_v2_source
from app.services.strategy_v2 import StrategyV2BacktestRunner


SYMBOL = "Crypto:BTC/USDT@swap"


def _source(side="long", slots=4, initial=0.6):
    return _build_grid_v2_source(
        dict(side=side, dynamic_anchor=True, start_price=0.98, end_price=1.02,
             grid_count=8, initial_position_pct=initial, max_open_orders=slots,
             equity_take_profit_pct=0, equity_stop_loss_pct=0, equity_trailing_enabled=False),
        instrument=SYMBOL, timeframe="15m",
    )


def _run(code, prices):
    frame = pd.DataFrame(dict(
        open=prices, high=[p + 0.02 for p in prices], low=[p - 0.02 for p in prices],
        close=prices, volume=[100000] * len(prices),
    ), index=pd.date_range("2026-01-01", periods=len(prices), freq="15min"))
    runner = StrategyV2BacktestRunner(
        code=code, frames={SYMBOL: frame}, initial_capital=1000,
        commission=0.0005, slippage=0, leverage_enabled=True, leverage=1,
    )
    return runner, runner.run()


@pytest.mark.parametrize("side", ["long", "short"])
@pytest.mark.parametrize("slots", [1, 4, 8])
def test_initial_inventory_cells_resume_trading_after_initial_exit(side, slots):
    prices = [100, 100, 100.6, 100.6, 101.1, 101.1, 101.6, 101.6, 102.2, 102.2]
    prices += [101.4, 101.4, 102.2, 102.2] * 3
    if side == "short":
        prices = [200 - price for price in prices]
    runner, result = _run(_source(side, slots), prices)
    later_entries = [e for e in result["executions"] if e["reason"] == side + "_entry"]
    assert len(later_entries) >= 3
    assert len([e for e in result["executions"] if e["reason"] == side + "_exit"]) >= 7
    assert runner.program.state.halted is False
    assert runner.program.state.cell_states.count("entry_pending") <= slots
    assert result["audit"]["passed"] is True


def test_requested_entry_capacity_can_include_recycled_seed_cells():
    runner, _ = _run(_source(slots=8), [100, 100])
    assert runner.program.namespace["MAX_OPEN_ENTRY_ORDERS"] == 8


def test_zero_initial_allocation_does_not_create_unfunded_seed_orders():
    _, result = _run(_source(initial=0), [100, 100, 102, 102, 101.4, 102.2] * 3)
    assert all("grid_initial" not in e["reason"] for e in result["executions"])
    assert all(int(e["client_order_id"].split("-")[1]) < 4 for e in result["executions"])
    assert result["audit"]["passed"] is True


def test_rebalancing_entry_slots_keeps_partially_filled_orders():
    runner, _ = _run(_source(slots=1), [100, 100])
    state = runner.program.state
    state.cell_states = ["entry_ready"] * 4 + ["disabled"] * 4
    state.cell_states[0] = "entry_pending"
    state.cell_refs[0] = "partial-entry"
    runner.context.update_order_statuses({"partial-entry": {
        "status": "partial", "filled_quantity": 0.1,
    }})
    runner.program.namespace["_arm_orders"](runner.context, 101)
    assert state.cell_states.count("entry_pending") == 1
    assert state.cell_refs[0] == "partial-entry"
    assert runner.context.get_order_status("partial-entry")["status"] == "partial"
    assert not runner.context.flush_cancelled_order_ids()


def test_unchanged_price_keeps_existing_entry_references():
    runner, _ = _run(_source(slots=4, initial=0), [100] * 10)
    assert runner.program.state.cell_cycles[:4] == [1] * 4


def test_neutral_grid_continues_both_legs_without_exceeding_capacity():
    runner, result = _run(_source(side="neutral", slots=4), [100, 100, 99.4, 99.4, 100, 100, 100.6, 100.6, 100, 100] * 3)
    reasons = [e["reason"] for e in result["executions"]]
    for reason in ("long_entry", "short_entry", "long_exit", "short_exit"):
        assert reasons.count(reason) >= 3
    assert runner.program.state.cell_states.count("entry_pending") <= 4
    assert result["audit"]["passed"] is True


def test_equity_take_profit_remains_a_terminal_stop():
    code = _source().replace("EQUITY_TAKE_PROFIT = 0.0", "EQUITY_TAKE_PROFIT = 0.001")
    runner, result = _run(code, [100, 100, 102, 102] + [101.4, 102.2] * 8)
    assert runner.program.state.halted is True
    reasons = [e["reason"] for e in result["executions"]]
    assert "long_entry" not in reasons
