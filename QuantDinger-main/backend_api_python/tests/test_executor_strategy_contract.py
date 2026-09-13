import pytest
import pandas as pd
from types import SimpleNamespace

from app.services.strategy_runtime.executors import (
    build_executor_strategy_payload,
    executor_templates,
    preview_executor,
)
from app.services.strategy_v2 import compile_strategy_v2
from app.services.strategy_v2 import StrategyV2BacktestRunner, StrategyV2LiveSession
from app.services.strategy_runtime.robot_v2 import migrate_legacy_robot_v2_source


def _robot_payload(executor_type: str, **overrides):
    payload = {
        "executor_type": executor_type,
        "execution_mode": "signal",
        "strategy_name": f"V2 {executor_type}",
        "symbol": "BTC/USDT",
        "market_type": "swap",
        "side": "long",
        "timeframe": "15m",
        "leverage": 3,
        "initial_capital": 1000,
        "entry_price": 100,
        "start_price": 90,
        "end_price": 110,
        "grid_count": 5,
        "total_amount_quote": 500,
        "base_order_size": 50,
        "safety_order_size": 75,
        "price_deviation_pct": 0.01,
        "step_multiplier": 1.5,
        "volume_multiplier": 1.5,
        "max_layers": 4,
        "layer_count": 3,
        "orders_per_layer": 2,
        "take_profit_pct": 0.02,
        "trailing_take_profit_enabled": True,
        "trailing_activation_pct": 0.01,
        "trailing_callback_pct": 0.003,
        "hard_stop_pct": 0.1,
        "dca_interval_minutes": 60,
    }
    payload.update(overrides)
    return payload


def test_executor_templates_expose_only_supported_robot_types():
    catalog = executor_templates()
    items = catalog["items"]
    assert {item["executor_type"] for item in items} == {
        "grid",
        "dca",
        "martingale",
        "layered_martingale",
    }
    assert catalog["compatibility"]["strategy"]["api_version"] == 2
    assert catalog["compatibility"]["backtest"]["supported"] is True
    assert catalog["compatibility"]["live"]["credential_required"] is True
    assert catalog["compatibility"]["markets"] == ["Crypto"]
    for item in items:
        defaults = item["defaults"]
        assert defaults["dynamic_anchor"] is True
        assert "initial_capital" not in defaults
        assert "leverage" not in defaults
        assert defaults["equity_take_profit_pct"] == pytest.approx(0.10)
        assert defaults["equity_stop_loss_pct"] == pytest.approx(0.06)
        assert defaults["equity_trailing_enabled"] is True
        assert 0 < defaults["equity_trailing_callback_pct"] < defaults["equity_trailing_activation_pct"]
        if item["executor_type"] in {"dca", "martingale", "layered_martingale"}:
            assert defaults["trailing_take_profit_enabled"] is True
            assert 0 < defaults["trailing_callback_pct"] < defaults["trailing_activation_pct"]
        if item["executor_type"] in {"martingale", "layered_martingale"}:
            assert defaults["restart_after_stop"] is False
            assert defaults["final_level_uses_remaining_budget"] is True


@pytest.mark.parametrize("executor_type", ["grid", "dca", "martingale", "layered_martingale"])
def test_every_robot_generates_a_compilable_strategy_v2_source(executor_type):
    payload = build_executor_strategy_payload(_robot_payload(executor_type), user_id=7)
    program = compile_strategy_v2(payload["code"])

    assert payload["strategy_type"] == "StrategyV2"
    assert payload["template_key"] == f"robot_v2_{executor_type}"
    assert payload["trading_config"]["api_version"] == 2
    assert payload["trading_config"]["strategy_family"] == "robot"
    assert program.manifest.api_version == 2
    assert program.manifest.strategy_type == "cta"
    if executor_type == "dca":
        assert program.manifest.primary_frequency == "1h"
        assert program.manifest.leverage_allowed is False
        assert program.manifest.universe.instruments[0].key == "Crypto:BTC/USDT@spot"
    else:
        assert program.manifest.primary_frequency == "15m"
        assert program.manifest.leverage_allowed is True
        assert program.manifest.max_leverage == 100
        assert program.manifest.universe.instruments[0].key == "Crypto:BTC/USDT@swap"
    assert payload["compatibility"]["strategy"]["editable_source"] is True
    assert payload["metadata"]["equity_risk"]["basis"] == "starting_equity"
    trigger = payload["metadata"]["trigger_contract"]
    if executor_type == "grid":
        assert trigger["entry"] == "exchange_resting_orders"
    elif executor_type == "dca":
        assert trigger["entry"] == "schedule"
    else:
        assert trigger["entry"] == "realtime_price"
        assert trigger["signal_confirmation"] == "price_tick"
    assert payload["metadata"]["equity_risk"]["trailing_enabled"] is True
    assert "PERSIST_RUNTIME_STATE = True" in payload["code"]
    assert payload["trading_config"]["equity_trailing_enabled"] is True
    assert payload["metadata"]["last_run_config"] == payload["trading_config"]


@pytest.mark.parametrize("executor_type", ["grid", "dca", "martingale", "layered_martingale"])
def test_every_robot_uses_total_equity_take_profit_stop_and_trailing(executor_type):
    payload = build_executor_strategy_payload(
        _robot_payload(
            executor_type,
            equity_take_profit_pct=0.20,
            equity_stop_loss_pct=0.10,
            equity_trailing_enabled=True,
            equity_trailing_activation_pct=0.04,
            equity_trailing_callback_pct=0.02,
        ),
        user_id=7,
    )
    config = payload["trading_config"]["executor_config"]
    assert config["equity_take_profit_pct"] == pytest.approx(0.20)
    assert config["equity_stop_loss_pct"] == pytest.approx(0.10)
    assert config["equity_trailing_enabled"] is True
    assert "current_equity = float(context.portfolio.total_value or 0.0)" in payload["code"]

    namespace = {}
    exec(payload["code"], namespace)
    namespace["g"] = SimpleNamespace(
        equity_peak_return=0.0,
        equity_trailing_armed=False,
    )
    context = SimpleNamespace(portfolio=SimpleNamespace(starting_cash=1000.0, total_value=1050.0))
    assert namespace["_equity_risk_reason"](context) == ""
    assert namespace["g"].equity_trailing_armed is True
    context.portfolio.total_value = 1029.0
    assert namespace["_equity_risk_reason"](context) == "equity_trailing_stop"


def test_robot_preview_warns_when_total_equity_trailing_is_invalid():
    preview = preview_executor(_robot_payload(
        "grid",
        equity_trailing_enabled=True,
        equity_trailing_activation_pct=0.02,
        equity_trailing_callback_pct=0.03,
    ))

    assert "invalid_equity_trailing_take_profit" in preview["warnings"]


def test_robot_build_rejects_invalid_risk_and_capital_instead_of_silently_saving():
    with pytest.raises(ValueError, match="invalid_equity_trailing_take_profit"):
        build_executor_strategy_payload(_robot_payload(
            "grid",
            equity_trailing_enabled=True,
            equity_trailing_activation_pct=0.02,
            equity_trailing_callback_pct=0.03,
        ), user_id=7)

    with pytest.raises(ValueError, match="INITIAL_CAPITAL_OUT_OF_RANGE"):
        build_executor_strategy_payload(
            _robot_payload("dca", initial_capital=5),
            user_id=7,
        )


@pytest.mark.parametrize("executor_type", ["grid", "dca", "martingale", "layered_martingale"])
def test_system_robot_equity_risk_can_run_between_bars_and_rearm_after_rejection(executor_type):
    payload = build_executor_strategy_payload(
        _robot_payload(executor_type, equity_stop_loss_pct=0.10),
        user_id=7,
    )
    frame = _runtime_frame()
    instrument = next(iter(compile_strategy_v2(payload["code"]).manifest.universe.instruments)).key
    session = StrategyV2LiveSession(
        code=payload["code"],
        frames={instrument: frame},
        initial_capital=1000,
    )
    session.portfolio.total_value = 850

    _orders, _messages, reason = session.evaluate_equity_risk(
        timestamp=frame.index[-1],
    )

    assert reason.endswith("equity_stop_loss")
    assert session.program.state.equity_exit_pending is True
    session.release_equity_risk_exit()
    assert session.program.state.equity_exit_pending is False
    assert session.program.state.equity_stop_reason == ""


def _runtime_frame():
    prices = [100.0, 99.0, 98.0, 101.0, 103.0]
    index = pd.date_range("2026-01-01", periods=len(prices), freq="15min")
    return pd.DataFrame({
        "open": prices,
        "high": [price + 2.0 for price in prices],
        "low": [price - 2.0 for price in prices],
        "close": prices,
        "volume": [100000.0] * len(prices),
    }, index=index)


@pytest.mark.parametrize("executor_type", ["grid", "dca", "martingale", "layered_martingale"])
def test_every_robot_runs_in_backtest_and_live_v2_engines(executor_type):
    payload = build_executor_strategy_payload(
        _robot_payload(
            executor_type,
            initial_position_pct=0.2,
            hard_stop_pct=0.2,
        ),
        user_id=7,
    )
    instrument = (
        "Crypto:BTC/USDT@spot"
        if executor_type == "dca"
        else "Crypto:BTC/USDT@swap"
    )
    frame = _runtime_frame()

    result = StrategyV2BacktestRunner(
        code=payload["code"],
        frames={instrument: frame},
        initial_capital=1000,
        commission=0,
        slippage=0,
        leverage_enabled=executor_type != "dca",
        leverage=1 if executor_type == "dca" else 3,
    ).run()
    session = StrategyV2LiveSession(
        code=payload["code"],
        frames={instrument: frame.iloc[:2]},
        initial_capital=1000,
    )
    intents, _, _ = session.process({instrument: frame.iloc[:2]})

    assert result["engine"]["version"] == "quantdinger-strategy-api-v2"
    assert result["manifest"]["apiVersion"] == 2
    assert result["totalExecutions"] >= 1
    assert intents
    assert all(abs(float(intent.value)) <= 1000 for intent in intents)


@pytest.mark.parametrize("executor_type", ["dca", "martingale", "layered_martingale"])
def test_robot_trailing_take_profit_activates_and_closes_after_pullback(executor_type):
    payload = build_executor_strategy_payload(_robot_payload(executor_type), user_id=7)
    instrument = (
        "Crypto:BTC/USDT@spot"
        if executor_type == "dca"
        else "Crypto:BTC/USDT@swap"
    )
    frame = _runtime_frame().iloc[:2]
    session = StrategyV2LiveSession(
        code=payload["code"],
        frames={instrument: frame},
        initial_capital=1000,
    )

    intents, _, _ = session.process({instrument: frame})

    assert intents
    assert "TAKE_PROFIT = 0.0" in payload["code"]
    assert "trailing_stop_pct=TRAILING_CALLBACK" in payload["code"]
    assert intents[0].protection is not None
    assert intents[0].protection.take_profit_pct == 0
    assert intents[0].protection.trailing_activation_pct == pytest.approx(0.01)
    assert intents[0].protection.trailing_stop_pct == pytest.approx(0.003)

    session.synchronize_positions({
        instrument: {
            "side": "long",
            "position_side": "" if executor_type == "dca" else "long",
            "amount": 1,
            "avg_cost": 100,
            "last_price": 100,
        }
    })
    assert session.evaluate_protections(
        {instrument: 102},
        timestamp="2026-01-01 01:00:00",
    ) == []
    restored = StrategyV2LiveSession(
        code=payload["code"],
        frames={instrument: frame},
        initial_capital=1000,
    )
    restored.restore_protection_snapshot(session.protection_snapshot())
    restored.synchronize_positions({
        instrument: {
            "side": "long",
            "position_side": "" if executor_type == "dca" else "long",
            "amount": 1,
            "avg_cost": 100,
            "last_price": 102,
        }
    })
    exits = restored.evaluate_protections(
        {instrument: 101.5},
        timestamp="2026-01-01 01:00:01",
    )

    assert len(exits) == 1
    assert exits[0].kind == "target_quantity"
    assert exits[0].value == 0
    assert exits[0].reason == "trailing_stop"


def test_live_session_keeps_long_and_short_positions_as_independent_legs():
    instrument = "Crypto:SOL/USDT@okx:swap"
    frame = _runtime_frame().iloc[:2]
    code = f'''
def initialize(context):
    context.set_universe(["{instrument}"])
    context.subscribe(frequency="1m")
    context.set_metadata(direction_mode="both")

def handle_data(context, data):
    pass
'''
    session = StrategyV2LiveSession(
        code=code,
        frames={instrument: frame},
        initial_capital=1_000,
    )

    session.synchronize_positions({
        f"{instrument}::long": {
            "side": "long",
            "position_side": "long",
            "amount": 2,
            "avg_cost": 100,
            "last_price": 101,
        },
        f"{instrument}::short": {
            "side": "short",
            "position_side": "short",
            "amount": 3,
            "avg_cost": 102,
            "last_price": 101,
        },
    })

    long_position = session.context.get_position(instrument, position_side="long")
    short_position = session.context.get_position(instrument, position_side="short")
    assert long_position.amount == pytest.approx(2)
    assert long_position.position_side == "long"
    assert short_position.amount == pytest.approx(-3)
    assert short_position.position_side == "short"


def test_dual_leg_protections_close_only_the_triggered_position_side():
    instrument = "Crypto:SOL/USDT@okx:swap"
    frame = _runtime_frame().iloc[:2]
    code = f'''
def initialize(context):
    context.set_universe(["{instrument}"])
    context.subscribe(frequency="1m")
    context.set_metadata(direction_mode="both")

def handle_data(context, data):
    order("{instrument}", 1, position_side="long", stop_loss_pct=0.02)
    order("{instrument}", -1, position_side="short", stop_loss_pct=0.02)
'''
    session = StrategyV2LiveSession(
        code=code,
        frames={instrument: frame},
        initial_capital=1_000,
    )
    intents, _, _ = session.process({instrument: frame})
    assert {item.position_side for item in intents} == {"long", "short"}
    session.synchronize_positions({
        f"{instrument}::long": {
            "side": "long",
            "amount": 1,
            "avg_cost": 100,
            "last_price": 100,
        },
        f"{instrument}::short": {
            "side": "short",
            "amount": 1,
            "avg_cost": 100,
            "last_price": 100,
        },
    })

    long_exit = session.evaluate_protections(
        {instrument: 97},
        timestamp="2026-01-01 00:01:00",
    )
    short_exit = session.evaluate_protections(
        {instrument: 103},
        timestamp="2026-01-01 00:02:00",
    )

    assert len(long_exit) == 1
    assert long_exit[0].position_side == "long"
    assert len(short_exit) == 1
    assert short_exit[0].position_side == "short"


@pytest.mark.parametrize("executor_type", ["dca", "martingale", "layered_martingale"])
def test_robot_can_disable_trailing_take_profit_and_keep_fixed_take_profit(executor_type):
    payload = build_executor_strategy_payload(
        _robot_payload(executor_type, trailing_take_profit_enabled=False),
        user_id=7,
    )
    instrument = (
        "Crypto:BTC/USDT@spot"
        if executor_type == "dca"
        else "Crypto:BTC/USDT@swap"
    )
    frame = _runtime_frame().iloc[:2]
    session = StrategyV2LiveSession(
        code=payload["code"],
        frames={instrument: frame},
        initial_capital=1000,
    )

    intents, _, _ = session.process({instrument: frame})

    assert "TAKE_PROFIT = 0.02" in payload["code"]
    assert intents[0].protection is not None
    assert intents[0].protection.take_profit_pct == pytest.approx(0.02)
    assert intents[0].protection.trailing_stop_pct == 0
    assert intents[0].protection.trailing_activation_pct == 0


@pytest.mark.parametrize("executor_type", ["dca", "martingale", "layered_martingale"])
def test_robot_preview_rejects_invalid_trailing_take_profit(executor_type):
    preview = preview_executor(_robot_payload(
        executor_type,
        trailing_activation_pct=0.002,
        trailing_callback_pct=0.003,
    ))

    assert "invalid_trailing_take_profit" in preview["warnings"]


def test_robot_preview_keeps_each_algorithm_shape():
    grid = preview_executor(_robot_payload("grid"))
    dca = preview_executor(_robot_payload("dca"))
    martingale = preview_executor(_robot_payload("martingale", side="short"))
    layered = preview_executor(_robot_payload("layered_martingale"))

    assert len(grid["levels"]) == 5
    assert len(dca["levels"]) == 4
    assert [level["amount_quote"] for level in dca["levels"]] == [0.25] * 4
    assert [level.get("scheduled_offset_minutes", 0) for level in dca["levels"]] == [0, 60, 120, 180]
    assert {level["side"] for level in martingale["levels"]} == {"short"}
    assert len({level["amount_quote"] for level in martingale["levels"]}) > 1
    assert all("scheduled_bar" not in level for level in martingale["levels"])
    assert len(layered["levels"]) == 6


def test_martingale_preview_reports_hard_stop_level_conflicts_without_blocking():
    preview = preview_executor(_robot_payload(
        "martingale",
        entry_price=100,
        base_order_size=1,
        safety_order_size=2,
        max_layers=6,
        price_deviation_pct=0.04,
        step_multiplier=1.2,
        volume_multiplier=2,
        hard_stop_pct=0.12,
    ))

    assert "hard_stop_blocks_level" in preview["warnings"]
    diagnostic = preview["risk_diagnostics"][-1]
    assert diagnostic["code"] == "hard_stop_blocks_level"
    assert diagnostic["before_level"] == 6
    assert diagnostic["required_stop_pct"] > preview["config"]["hard_stop_pct"]
    assert diagnostic["suggested_stop_pct"] > diagnostic["required_stop_pct"]
    assert preview["config"]["restart_after_stop"] is False
    assert preview["config"]["final_level_uses_remaining_budget"] is True


def test_martingale_generated_source_uses_confirmed_batched_incremental_orders():
    payload = build_executor_strategy_payload(
        _robot_payload("martingale", restart_after_stop=True),
        user_id=7,
    )
    source = payload["code"]

    assert "ROBOT_TEMPLATE_VERSION = 6" in source
    assert "ENTRY_TRIGGER_MODE = 'realtime_price'" in source
    assert "def on_price_tick(context, prices):" in source
    assert "PERSIST_RUNTIME_STATE = True" in source
    assert "RESTART_AFTER_STOP = True" in source
    assert "get_order_status(reference)" in source
    assert 'g.level_statuses = ["ready" for _ in PRICE_LEVELS]' in source
    assert "def _submit_levels(context, indexes):" in source
    assert "order_value(" in source
    assert "position_side=POSITION_SIDE" in source
    assert "trailing_rebase_on_scale_in=False" in source
    assert "order_target_value(\n        INSTRUMENT,\n        DIRECTION * quote_total" not in source
    assert 'get_history(2, TIMEFRAME, ["high", "low", "close"], INSTRUMENT)' in source

    grid = build_executor_strategy_payload(
        _robot_payload("grid"),
        user_id=7,
    )
    assert "GRID_TEMPLATE_VERSION = 7" in grid["code"]
    assert "g.cell_states" in grid["code"]
    assert 'reason=side + "_exit"' in grid["code"]


def test_martingale_live_price_tick_triggers_levels_without_waiting_for_a_new_bar():
    payload = build_executor_strategy_payload(
        _robot_payload(
            "martingale",
            market_type="spot",
            leverage=1,
            initial_capital=100,
            entry_price=100,
            base_order_size=1,
            safety_order_size=2,
            max_layers=4,
            price_deviation_pct=0.04,
            step_multiplier=1.2,
            volume_multiplier=2,
            hard_stop_pct=0,
        ),
        user_id=7,
    )
    instrument = "Crypto:BTC/USDT@spot"
    frame = _runtime_frame().iloc[:2]
    session = StrategyV2LiveSession(
        code=payload["code"],
        frames={instrument: frame},
        initial_capital=100,
        params={"commission": 0.001, "execution_mode": "live"},
    )

    initial, _ = session.evaluate_price_tick(
        {instrument: 100},
        timestamp="2026-01-01T00:00:01Z",
    )
    assert len(initial) == 1
    assert initial[0].reason == "robot_level"
    reference = initial[0].client_order_id
    session.context.update_order_statuses({
        reference: {
            "client_order_id": reference,
            "status": "filled",
            "filled_notional": abs(initial[0].value),
            "fee": 0,
        }
    })
    session.synchronize_positions({
        instrument: {
            "side": "long",
            "amount": 0.01,
            "avg_cost": 100,
            "last_price": 100,
        }
    })

    scale_ins, _ = session.evaluate_price_tick(
        {instrument: 90},
        timestamp="2026-01-01T00:00:02Z",
    )
    assert len(scale_ins) == 1
    assert scale_ins[0].reason == "robot_level"
    assert scale_ins[0].client_order_id != reference

    bar_orders, _, _ = session.process({instrument: frame})
    assert bar_orders == []


def test_martingale_crosses_multiple_levels_as_one_batch_and_spends_full_budget_with_fees():
    payload = build_executor_strategy_payload(
        _robot_payload(
            "martingale",
            market_type="spot",
            leverage=1,
            initial_capital=100,
            entry_price=100,
            base_order_size=1,
            safety_order_size=2,
            max_layers=6,
            price_deviation_pct=0.04,
            step_multiplier=1.2,
            volume_multiplier=2,
            trailing_take_profit_enabled=True,
            trailing_activation_pct=0.5,
            trailing_callback_pct=0.1,
            hard_stop_pct=0,
        ),
        user_id=7,
    )
    instrument = "Crypto:BTC/USDT@spot"
    index = pd.date_range("2026-01-01", periods=5, freq="1h")
    frame = pd.DataFrame({
        "open": [100, 100, 68, 68, 68],
        "high": [101, 101, 101, 69, 69],
        "low": [99, 60, 60, 67, 67],
        "close": [100, 100, 68, 68, 68],
        "volume": [100000] * 5,
    }, index=index)

    result = StrategyV2BacktestRunner(
        code=payload["code"],
        frames={instrument: frame},
        initial_capital=100,
        commission=0.005,
        slippage=0,
    ).run()
    entries = [
        item for item in result["executions"]
        if item.get("reason") == "robot_level"
    ]

    assert len(entries) == 2
    assert all(item["status"] == "filled" for item in entries)
    assert sum(
        float(item["notional"]) + float(item["commission"])
        for item in entries
    ) == pytest.approx(100, abs=1e-6)
    assert all(
        item["status"] == "filled"
        for item in result["orderLedger"]
        if str(item.get("clientOrderId") or "").startswith("martingale:")
    )


def test_martingale_session_restores_pending_batch_and_retries_rejected_batch_without_advancing():
    payload = build_executor_strategy_payload(
        _robot_payload(
            "martingale",
            market_type="spot",
            leverage=1,
            initial_capital=100,
            entry_price=100,
            base_order_size=1,
            safety_order_size=2,
            max_layers=6,
            price_deviation_pct=0.04,
            step_multiplier=1.2,
            volume_multiplier=2,
            hard_stop_pct=0,
        ),
        user_id=7,
    )
    instrument = "Crypto:BTC/USDT@spot"
    index = pd.date_range("2026-01-01", periods=3, freq="1h")
    frame = pd.DataFrame({
        "open": [100, 100, 68],
        "high": [101, 101, 101],
        "low": [99, 60, 60],
        "close": [100, 100, 68],
        "volume": [100000] * 3,
    }, index=index)
    first = StrategyV2LiveSession(
        code=payload["code"],
        frames={instrument: frame.iloc[:2]},
        initial_capital=100,
        params={"commission": 0.001},
    )
    intents, _, _ = first.process(
        {instrument: frame.iloc[:2]},
        schedule_time=index[1],
    )
    assert len(intents) == 1
    reference = intents[0].client_order_id

    restored = StrategyV2LiveSession(
        code=payload["code"],
        frames={instrument: frame.iloc[:2]},
        initial_capital=100,
        params={"commission": 0.001},
    )
    restored.restore_session_snapshot(first.session_snapshot())
    same_bar, _, _ = restored.process(
        {instrument: frame.iloc[:2]},
        schedule_time=index[1],
    )
    assert same_bar == []
    assert set(restored.program.state.level_refs) == {reference}

    restored.context.update_order_statuses({
        reference: {
            "client_order_id": reference,
            "status": "rejected",
        }
    })
    retried, _, _ = restored.process(
        {instrument: frame},
        schedule_time=index[2],
    )

    assert len(retried) == 1
    assert retried[0].client_order_id != reference
    assert retried[0].client_order_id.endswith(":attempt:1")
    assert restored.program.state.next_level == 0
    assert set(restored.program.state.level_statuses) == {"pending"}


@pytest.mark.parametrize(
    ("restart_after_stop", "expects_reentry"),
    [(False, False), (True, True)],
)
def test_martingale_stop_loss_reentry_toggle_waits_for_flat_and_one_new_bar(
    restart_after_stop,
    expects_reentry,
):
    payload = build_executor_strategy_payload(
        _robot_payload(
            "martingale",
            market_type="spot",
            leverage=1,
            initial_capital=100,
            entry_price=100,
            base_order_size=1,
            safety_order_size=2,
            max_layers=3,
            price_deviation_pct=0.04,
            step_multiplier=1.2,
            volume_multiplier=2,
            trailing_take_profit_enabled=False,
            take_profit_pct=0,
            hard_stop_pct=0.12,
            restart_after_stop=restart_after_stop,
        ),
        user_id=7,
    )
    instrument = "Crypto:BTC/USDT@spot"
    index = pd.date_range("2026-01-01", periods=3, freq="1h")
    frame = pd.DataFrame({
        "open": [100, 87, 87],
        "high": [101, 88, 88],
        "low": [99, 86, 86],
        "close": [100, 87, 87],
        "volume": [100000] * 3,
    }, index=index)
    session = StrategyV2LiveSession(
        code=payload["code"],
        frames={instrument: frame.iloc[:1]},
        initial_capital=100,
        params={"commission": 0},
    )
    entries, _, _ = session.process(
        {instrument: frame.iloc[:1]},
        schedule_time=index[0],
    )
    assert len(entries) == 1
    reference = entries[0].client_order_id
    session.context.update_order_statuses({
        reference: {
            "client_order_id": reference,
            "status": "filled",
            "filled_notional": abs(entries[0].value),
            "fee": 0,
        }
    })
    session.synchronize_positions({
        instrument: {
            "side": "long",
            "position_side": "long",
            "amount": 1,
            "avg_cost": 100,
            "last_price": 100,
        }
    })
    exits = session.evaluate_protections(
        {instrument: 87},
        timestamp=index[1],
    )
    assert len(exits) == 1
    assert exits[0].reason == "stop_loss"
    session.synchronize_positions({})

    transition_orders, _, _ = session.process(
        {instrument: frame.iloc[:2]},
        schedule_time=index[1],
    )
    assert transition_orders == []
    later_orders, _, _ = session.process(
        {instrument: frame},
        schedule_time=index[2],
    )

    assert bool(later_orders) is expects_reentry
    assert session.program.state.halted_after_stop is (not restart_after_stop)


def test_neutral_grid_preview_is_symmetric_and_uses_adjacent_cell_exits():
    preview = preview_executor(_robot_payload(
        "grid",
        side="neutral",
        grid_count=9,
        start_price=0.8,
        end_price=1.2,
        total_amount_quote=1000,
        dynamic_anchor=True,
    ))

    long_rows = [row for row in preview["levels"] if row["side"] == "long"]
    short_rows = [row for row in preview["levels"] if row["side"] == "short"]

    assert preview["config"]["grid_count"] == 10
    assert "neutral_grid_count_adjusted_even" in preview["warnings"]
    assert len(long_rows) == len(short_rows) == 5
    assert sum(row["amount_quote"] for row in long_rows) == pytest.approx(500)
    assert sum(row["amount_quote"] for row in short_rows) == pytest.approx(500)
    assert all(row["take_profit_price"] > row["price"] for row in long_rows)
    assert all(row["take_profit_price"] < row["price"] for row in short_rows)


def test_dense_grid_preview_warns_and_generated_source_preserves_entry_slots():
    request = _robot_payload(
        "grid",
        side="long",
        grid_count=80,
        start_price=0.8,
        end_price=1.2,
        max_open_orders=50,
        dynamic_anchor=True,
    )

    preview = preview_executor(request)
    payload = build_executor_strategy_payload(request, user_id=7)

    assert "high_frequency_grid_backtest_workload" in preview["warnings"]
    assert preview["config"]["grid_count"] == 80
    assert "MAX_OPEN_ENTRY_ORDERS = 50" in payload["code"]


def test_grid_preview_rejects_pathological_cell_count_instead_of_silent_truncation():
    with pytest.raises(ValueError, match="GRID_COUNT_EXCEEDS_SAFE_LIMIT"):
        preview_executor(_robot_payload(
            "grid",
            grid_count=201,
            start_price=0.8,
            end_price=1.2,
        ))


def test_dca_catalog_and_source_use_a_time_based_fixed_allocation_plan():
    defaults = next(
        item["defaults"] for item in executor_templates()["items"]
        if item["executor_type"] == "dca"
    )
    preview = preview_executor({
        "executor_type": "dca",
        "symbol": "BTC/USDT",
        **defaults,
    })
    payload = build_executor_strategy_payload({
        "executor_type": "dca",
        "execution_mode": "signal",
        "symbol": "BTC/USDT",
        **defaults,
    }, user_id=7)

    assert defaults["market_type"] == "spot"
    assert defaults["side"] == "long"
    assert defaults["timeframe"] == "1H"
    assert defaults["dca_interval_minutes"] == 1440
    assert defaults["dca_max_orders"] == 5
    assert defaults["dca_total_budget_pct"] == pytest.approx(0.95)
    assert "volume_multiplier" not in defaults
    assert [level["amount_quote"] for level in preview["levels"]] == pytest.approx([0.19] * 5)
    assert [level.get("scheduled_offset_minutes", 0) for level in preview["levels"]] == [0, 1440, 2880, 4320, 5760]
    assert "DCA_INTERVAL_MINUTES = 1440" in payload["code"]
    assert "DCA_ORDER_PCT = 0.19" in payload["code"]
    assert "Crypto:BTC/USDT@spot" in payload["code"]
    assert "allow_leverage" not in payload["code"]
    assert 'reason="dca_scheduled_order"' in payload["code"]
    assert "DCA_TEMPLATE_VERSION = 6" in payload["code"]
    assert "get_order_status(reference)" in payload["code"]
    assert "g.dca_pending_ref = order_value(" in payload["code"]
    assert "client_order_id=reference" in payload["code"]
    assert "g.dca_spent_value += purchase_value" not in payload["code"]
    assert payload["code"].index('if name == "filled":') < payload["code"].index("g.dca_order_count += 1")
    assert "order_value(" in payload["code"]
    assert "PRICE_LEVELS" not in payload["code"]
    assert 'reason="robot_level"' not in payload["code"]


def test_dca_backtest_places_equal_orders_on_the_configured_time_schedule():
    payload = build_executor_strategy_payload(
        _robot_payload(
            "dca",
            dca_interval_minutes=30,
            dca_max_orders=3,
            dca_total_budget_pct=0.6,
            trailing_take_profit_enabled=False,
            take_profit_pct=0,
            hard_stop_pct=0,
        ),
        user_id=7,
    )
    instrument = "Crypto:BTC/USDT@spot"
    index = pd.date_range("2026-01-01", periods=10, freq="15min")
    frame = pd.DataFrame({
        "open": [100.0] * len(index),
        "high": [100.0] * len(index),
        "low": [100.0] * len(index),
        "close": [100.0] * len(index),
        "volume": [100000.0] * len(index),
    }, index=index)

    result = StrategyV2BacktestRunner(
        code=payload["code"],
        frames={instrument: frame},
        initial_capital=1000,
        commission=0,
        slippage=0,
        leverage_enabled=True,
        leverage=1,
    ).run()

    dca_orders = [
        item for item in result["executions"]
        if item.get("reason") == "dca_scheduled_order"
    ]
    assert len(dca_orders) == 3
    assert [item["notional"] for item in dca_orders] == pytest.approx([200, 200, 200])


def test_dca_rejected_order_does_not_consume_cycle_budget_or_order_count():
    payload = build_executor_strategy_payload(
        _robot_payload(
            "dca",
            dca_interval_minutes=60,
            dca_max_orders=2,
            dca_total_budget_pct=0.4,
            trailing_take_profit_enabled=False,
            take_profit_pct=0,
            hard_stop_pct=0,
        ),
        user_id=7,
    )
    instrument = "Crypto:BTC/USDT@spot"
    index = pd.date_range("2026-01-01", periods=3, freq="1h")
    frame = pd.DataFrame({
        "open": [100.0] * 3,
        "high": [100.0] * 3,
        "low": [100.0] * 3,
        "close": [100.0] * 3,
        "volume": [100000.0] * 3,
    }, index=index)
    session = StrategyV2LiveSession(
        code=payload["code"],
        frames={instrument: frame.iloc[:1]},
        initial_capital=1000,
    )

    first, _, _ = session.process(
        {instrument: frame.iloc[:1]},
        schedule_time=index[0],
    )
    assert len(first) == 1
    session.context.update_order_statuses({
        first[0].client_order_id: {
            "status": "rejected",
            "client_order_id": first[0].client_order_id,
        }
    })

    retry, _, _ = session.process(
        {instrument: frame.iloc[:2]},
        schedule_time=index[1],
    )
    assert len(retry) == 1
    assert retry[0].client_order_id != first[0].client_order_id
    state = session.session_snapshot()["strategyState"]
    assert state["dca_order_count"] == 0
    assert state["dca_spent_value"] == 0
    assert state["dca_attempt"] == 1


def test_dca_rising_market_never_turns_a_scheduled_purchase_into_a_sale():
    payload = build_executor_strategy_payload(
        _robot_payload(
            "dca",
            dca_interval_minutes=60,
            dca_max_orders=5,
            dca_total_budget_pct=0.95,
            trailing_take_profit_enabled=False,
            take_profit_pct=0,
            hard_stop_pct=0,
        ),
        user_id=7,
    )
    instrument = "Crypto:BTC/USDT@spot"
    index = pd.date_range("2026-01-01", periods=7, freq="1h")
    prices = [100.0 + index * 0.1 for index in range(len(index))]
    frame = pd.DataFrame({
        "open": prices,
        "high": prices,
        "low": prices,
        "close": prices,
        "volume": [100000.0] * len(index),
    }, index=index)

    result = StrategyV2BacktestRunner(
        code=payload["code"],
        frames={instrument: frame},
        initial_capital=1000,
        commission=0.0005,
        slippage=0.0005,
    ).run()
    dca_orders = [
        item for item in result["executions"]
        if item.get("reason") == "dca_scheduled_order"
    ]

    assert len(dca_orders) == 5
    assert {item["side"] for item in dca_orders} == {"buy"}
    assert {item["status"] for item in dca_orders} == {"filled"}
    assert result["attribution"]["orderStatus"]["rejected"] == 0
    assert result["audit"]["passed"] is True


def test_default_catalog_robot_can_anchor_levels_to_first_market_price():
    payload = build_executor_strategy_payload(
        _robot_payload("grid", dynamic_anchor=True, initial_position_pct=0.2),
        user_id=7,
    )

    assert payload["trading_config"]["executor_config"]["dynamic_anchor"] is True
    assert "DYNAMIC_ANCHOR = True" in payload["code"]
    assert "context.portfolio.starting_cash" in payload["code"]
    assert "CELL_BUDGET_PCTS" in payload["code"]
    assert '"grid_initial_" + side' in payload["code"]


def test_default_grid_uses_weights_and_a_minimum_notional_friendly_initial_share():
    defaults = next(
        item["defaults"] for item in executor_templates()["items"]
        if item["executor_type"] == "grid"
    )
    preview = preview_executor({
        "executor_type": "grid",
        "symbol": "BTC/USDT",
        **defaults,
    })

    assert defaults["total_amount_quote"] == defaults["grid_count"]
    assert defaults["initial_position_pct"] == pytest.approx(0.6)
    assert len(preview["levels"]) == 4
    assert all(level["price"] < 1.0 for level in preview["levels"])
    assert all(level["amount_quote"] == pytest.approx(2.0) for level in preview["levels"])
    assert preview["summary"]["total_amount_quote"] == pytest.approx(defaults["grid_count"])

    payload = build_executor_strategy_payload({
        "executor_type": "grid",
        "execution_mode": "signal",
        "symbol": "BTC/USDT",
        **defaults,
    }, user_id=7)
    assert "CELL_LOWER = [0.98, 0.985, 0.99, 0.995, 1.0, 1.005, 1.01, 1.015]" in payload["code"]
    assert "CELL_UPPER = [0.985, 0.99, 0.995, 1.0, 1.005, 1.01, 1.015, 1.02]" in payload["code"]
    assert "CELL_ROLES = ['long_entry', 'long_entry', 'long_entry', 'long_entry', 'long_seed', 'long_seed', 'long_seed', 'long_seed']" in payload["code"]
    assert "CELL_BUDGET_PCTS = [0.1, 0.1, 0.1, 0.1, 0.15, 0.15, 0.15, 0.15]" in payload["code"]
    assert payload["trading_config"]["bot_type"] == "grid"
    assert payload["trading_config"]["bot_params"]["gridDirection"] == "long"


def test_grid_backtest_repeats_entry_and_adjacent_cell_exit_without_whole_position_exit():
    payload = build_executor_strategy_payload(
        _robot_payload(
            "grid",
            dynamic_anchor=True,
            start_price=0.98,
            end_price=1.02,
            grid_count=8,
            initial_position_pct=0,
            take_profit_pct=0,
            hard_stop_pct=0,
            max_open_orders=4,
        ),
        user_id=7,
    )
    instrument = "Crypto:BTC/USDT@swap"
    prices = [100, 100, 99.4, 99.4, 100.1, 100.1, 99.4, 99.4, 100.1, 100.1]
    index = pd.date_range("2026-01-01", periods=len(prices), freq="1min")
    frame = pd.DataFrame({
        "open": prices,
        "high": [price + 0.1 for price in prices],
        "low": [price - 0.1 for price in prices],
        "close": prices,
        "volume": [100000.0] * len(prices),
    }, index=index)

    result = StrategyV2BacktestRunner(
        code=payload["code"],
        frames={instrument: frame},
        initial_capital=1000,
        commission=0,
        slippage=0,
        leverage_enabled=True,
        leverage=1,
    ).run()

    reasons = [row["reason"] for row in result["executions"]]
    assert reasons == ["long_entry", "long_exit", "long_entry", "long_exit"]
    assert "grid_equity_take_profit" not in reasons
    assert len(result["closedTrades"]) == 2
    assert result["audit"]["passed"] is True


def test_grid_initial_inventory_is_sold_one_cell_at_a_time():
    payload = build_executor_strategy_payload(
        _robot_payload(
            "grid",
            dynamic_anchor=True,
            start_price=0.98,
            end_price=1.02,
            grid_count=8,
            initial_position_pct=0.6,
            take_profit_pct=0,
            hard_stop_pct=0,
            max_open_orders=4,
        ),
        user_id=7,
    )
    instrument = "Crypto:BTC/USDT@swap"
    prices = [100, 100, 100.6, 100.6, 101.1, 101.1, 101.6, 101.6, 102.1, 102.1]
    index = pd.date_range("2026-01-01", periods=len(prices), freq="1min")
    frame = pd.DataFrame({
        "open": prices,
        "high": [price + 0.1 for price in prices],
        "low": [price - 0.1 for price in prices],
        "close": prices,
        "volume": [100000.0] * len(prices),
    }, index=index)

    result = StrategyV2BacktestRunner(
        code=payload["code"],
        frames={instrument: frame},
        initial_capital=1000,
        commission=0,
        slippage=0,
        leverage_enabled=True,
        leverage=1,
    ).run()

    executions = result["executions"]
    assert executions[0]["reason"] == "grid_initial_long"
    exits = [row for row in executions if row["reason"] == "long_exit"]
    assert len(exits) == 4
    assert [row["quantity"] for row in exits] == pytest.approx([1.5, 1.5, 1.5, 1.5])
    assert all(row["reason"] != "grid_equity_take_profit" for row in executions)
    assert result["audit"]["passed"] is True


@pytest.mark.parametrize("side", ["long", "short", "neutral"])
def test_every_grid_direction_routes_live_execution_to_resting_grid_engine(side):
    payload = build_executor_strategy_payload(
        _robot_payload("grid", side=side, dynamic_anchor=True),
        user_id=7,
    )

    assert payload["trading_config"]["bot_type"] == "grid"
    assert payload["trading_config"]["bot_params"]["gridDirection"] == side
    assert payload["trading_config"]["bot_params"]["gridCountUnit"] == "cells"
    assert payload["trading_config"]["bot_params"]["initialPositionPct"] == pytest.approx(
        0 if side == "neutral" else payload["trading_config"]["executor_config"]["initial_position_pct"]
    )


def test_legacy_robot_absolute_allocations_migrate_to_run_capital_weights():
    legacy = """AMOUNTS = [100.0, 300.0]
INITIAL_POSITION_PCT = 0.2
initial_value = sum(AMOUNTS) * INITIAL_POSITION_PCT
g.target_value += float(AMOUNTS[g.next_level] or 0.0)
"""

    migrated = migrate_legacy_robot_v2_source(legacy, "grid")

    assert "AMOUNT_WEIGHTS = [0.25, 0.75]" in migrated
    assert "LEVEL_CAPITAL_FRACTION = 0.8" in migrated
    assert "context.portfolio.starting_cash" in migrated
    assert "AMOUNTS" not in migrated


def test_live_robot_requires_a_saved_exchange_credential():
    with pytest.raises(ValueError, match="LIVE_EXECUTOR_CREDENTIAL_REQUIRED"):
        build_executor_strategy_payload(_robot_payload("grid", execution_mode="live"), user_id=7)

    payload = build_executor_strategy_payload(
        _robot_payload(
            "grid",
            execution_mode="live",
            exchange_config={"credential_id": 42, "exchange_id": "okx"},
        ),
        user_id=7,
    )
    assert payload["exchange_config"]["credential_id"] == 42


def test_dca_is_forced_to_spot_long_and_cannot_enable_leverage():
    payload = build_executor_strategy_payload(
        _robot_payload("dca", market_type="swap", side="short", leverage=20, timeframe="1m"),
        user_id=7,
    )
    program = compile_strategy_v2(payload["code"])

    assert payload["trade_direction"] == "long"
    assert payload["market_type"] == "spot"
    assert payload["timeframe"] == "1H"
    assert payload["leverage"] == 1
    assert payload["leverage_enabled"] is False
    assert program.manifest.leverage_allowed is False
    assert program.manifest.direction_mode == "long_only"
    assert program.manifest.universe.instruments[0].key == "Crypto:BTC/USDT@spot"
    assert 'context.set_metadata(direction_mode="long_only", market_type="spot")' in payload["code"]
    assert "DIRECTION" not in payload["code"]


def test_neutral_grid_generates_dual_leg_v2_and_resting_live_config():
    payload = build_executor_strategy_payload(
        _robot_payload("grid", side="neutral", dynamic_anchor=False),
        user_id=7,
    )

    assert payload["trade_direction"] == "neutral"
    assert payload["compatibility"]["sides"] == ["long", "short", "neutral"]
    assert payload["trading_config"]["bot_type"] == "grid"
    assert payload["trading_config"]["bot_params"]["gridDirection"] == "neutral"
    assert payload["trading_config"]["bot_params"]["gridCountUnit"] == "cells"
    assert payload["trading_config"]["bot_params"]["initialPositionPct"] == 0
    assert 'position_side="long"' in payload["code"]
    assert 'position_side="short"' in payload["code"]
    assert compile_strategy_v2(payload["code"]).manifest.direction_mode == "neutral"

    instrument = "Crypto:BTC/USDT@swap"
    index = pd.date_range("2026-01-01", periods=3, freq="15min")
    frame = pd.DataFrame({
        "open": [100.0, 100.0, 100.0],
        "high": [111.0, 111.0, 111.0],
        "low": [89.0, 89.0, 89.0],
        "close": [100.0, 100.0, 100.0],
        "volume": [100000.0, 100000.0, 100000.0],
    }, index=index)
    session = StrategyV2LiveSession(
        code=payload["code"],
        frames={instrument: frame.iloc[:2]},
        initial_capital=1000,
    )
    intents, _, _ = session.process({instrument: frame.iloc[:2]})

    assert {intent.position_side for intent in intents} == {"long", "short"}
    assert any(intent.position_side == "long" and intent.value > 0 for intent in intents)
    assert any(intent.position_side == "short" and intent.value < 0 for intent in intents)

    result = StrategyV2BacktestRunner(
        code=payload["code"],
        frames={instrument: frame},
        initial_capital=1000,
        commission=0,
        slippage=0,
        leverage_enabled=True,
        leverage=3,
    ).run()
    assert {row["position_side"] for row in result["executions"]} == {"long", "short"}
    assert result["audit"]["passed"] is True
