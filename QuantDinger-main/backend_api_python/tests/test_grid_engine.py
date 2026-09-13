"""Tests for professional grid engine."""

from __future__ import annotations

import pytest

from app.services.grid.config import GridBotConfig
from app.services.grid.levels import generate_cells, generate_levels
from app.services.grid.validator import validate_grid_config


def test_generate_levels_arithmetic():
    levels = generate_levels(90000, 100000, 10, "arithmetic")
    assert len(levels) == 10
    assert levels[0] == 90000
    assert abs(levels[-1] - 100000) < 1e-6


def test_generate_cells_count():
    levels = generate_levels(100, 200, 5, "arithmetic")
    cells = generate_cells(levels)
    assert len(cells) == 4


def test_validate_long_grid_ok():
    cfg = GridBotConfig(
        upper_price=100000,
        lower_price=90000,
        grid_count=10,
        amount_per_grid=100,
        grid_mode="arithmetic",
        grid_direction="long",
        initial_position_pct=0.3,
        order_mode="maker",
        boundary_action="pause",
        leverage=5,
        market_type="swap",
        margin_mode="cross",
    )
    ok, msg, _ = validate_grid_config(cfg, initial_capital=10000)
    assert ok is True
    assert msg == ""


def test_validate_rejects_bad_bounds():
    cfg = GridBotConfig(
        upper_price=100,
        lower_price=200,
        grid_count=10,
        amount_per_grid=50,
        grid_mode="arithmetic",
        grid_direction="long",
        initial_position_pct=0,
        order_mode="maker",
        boundary_action="pause",
        leverage=1,
        market_type="swap",
        margin_mode="cross",
    )
    ok, msg, _ = validate_grid_config(cfg)
    assert ok is False
    assert "upperPrice" in msg


def test_config_from_trading_config_initial_pct():
    tc = {
        "leverage": 5,
        "market_type": "swap",
        "bot_params": {
            "upperPrice": 100000,
            "lowerPrice": 90000,
            "gridCount": 10,
            "amountPerGrid": 100,
            "gridDirection": "long",
            "initialPositionPct": 30,
        },
    }
    cfg = GridBotConfig.from_trading_config(tc)
    assert cfg.initial_position_pct == 0.3
    assert cfg.grid_direction == "long"


def test_grid_drift_cancels_same_side_entries_and_unsafe_exits(monkeypatch):
    from app.services.grid.engine import GridEngine

    engine = GridEngine(
        42,
        "BTC/USDT",
        {
            "market_type": "spot",
            "bot_params": {
                "upperPrice": 110,
                "lowerPrice": 90,
                "gridCount": 5,
                "amountPerGrid": 10,
                "gridDirection": "long",
            },
        },
        {"exchange_id": "binance", "credential_id": 7},
        create_client_fn=lambda: object(),
        enqueue_market=lambda *a, **k: False,
    )
    engine._bootstrapped = True
    cancelled = []
    monkeypatch.setattr(
        engine,
        "_grid_entry_ownership_allowed",
        lambda *_a, **_k: (False, {"reason": "account_below_protected_allocation"}),
    )
    monkeypatch.setattr(
        engine,
        "cancel_entry_orders_on_exchange",
        lambda *, pos_side="": cancelled.append(("entry", pos_side)),
    )
    monkeypatch.setattr(
        engine,
        "cancel_exit_orders_on_exchange",
        lambda *, pos_side="": cancelled.append(("exit", pos_side)),
    )

    assert engine.sync_grid_orders(100.0) == 0
    assert cancelled == [("entry", "long"), ("exit", "long")]


def test_grid_direct_resting_entry_cannot_bypass_ownership_guard(monkeypatch):
    from app.services.grid.engine import GridEngine
    from app.services.grid.levels import GridCellSpec

    engine = GridEngine(
        42,
        "BTC/USDT",
        {
            "market_type": "swap",
            "bot_params": {"gridCount": 5, "gridDirection": "long"},
        },
        {"exchange_id": "binance", "credential_id": 7},
        create_client_fn=lambda: object(),
        enqueue_market=lambda *a, **k: False,
    )
    cancelled = []
    monkeypatch.setattr(engine, "_normalize_grid_base_qty", lambda qty, _price: qty)
    monkeypatch.setattr(
        engine,
        "_grid_entry_ownership_allowed",
        lambda *_a, **_k: (False, {"reason": "unallocated_account_position"}),
    )
    monkeypatch.setattr(
        engine,
        "cancel_entry_orders_on_exchange",
        lambda *, pos_side="": cancelled.append(pos_side),
    )
    monkeypatch.setattr(
        "app.services.grid.engine.place_grid_limit_order",
        lambda *_a, **_k: pytest.fail("blocked grid entry must not reach exchange"),
    )

    placed = engine._place_limit(
        GridCellSpec(index=1, lower_price=99.0, upper_price=101.0),
        "long_entry",
        "buy",
        99.0,
        reduce_only=False,
        pos_side="long",
        quantity=0.01,
    )

    assert placed is False
    assert cancelled == ["long"]


def test_grid_entry_guard_uses_live_account_snapshot_and_shared_ownership_logic(monkeypatch):
    from types import SimpleNamespace

    from app.services.grid.engine import GridEngine

    engine = GridEngine(
        42,
        "BTC/USDT",
        {"market_type": "spot", "bot_params": {"gridCount": 5}},
        {"exchange_id": "binance", "credential_id": 7},
        user_id=3,
        create_client_fn=lambda: object(),
        enqueue_market=lambda *a, **k: False,
    )
    observed = {}

    def fake_query(**kwargs):
        observed["query"] = kwargs
        return 1.25

    def fake_guard(**kwargs):
        observed["guard"] = kwargs
        return SimpleNamespace(
            ownership={
                "status": "drift_blocked",
                "reason": "unallocated_account_position",
            },
            error="position_drift_detected",
            log_message="ownership drift",
            log_level="error",
        )

    monkeypatch.setattr(
        "app.services.live_trading.position_query.query_exchange_position_size",
        fake_query,
    )
    monkeypatch.setattr(
        "app.services.pending_orders.entry_position_guard.evaluate_entry_position_guard",
        fake_guard,
    )
    monkeypatch.setattr("app.services.grid.engine.append_strategy_log", lambda *_a, **_k: None)

    allowed, metadata = engine._grid_entry_ownership_allowed(
        object(),
        "long",
        force=True,
    )

    assert allowed is False
    assert metadata["reason"] == "unallocated_account_position"
    assert observed["query"]["strict"] is True
    assert observed["guard"]["account_qty"] == pytest.approx(1.25)
    assert observed["guard"]["credential_id"] == 7
    assert observed["guard"]["strategy_config"]["bot_type"] == "grid"


def test_grid_exit_fails_closed_when_protected_inventory_lookup_fails(monkeypatch):
    from app.services.grid.engine import GridEngine

    engine = GridEngine(
        42,
        "BTC/USDT",
        {"market_type": "swap", "bot_params": {"gridCount": 5}},
        {"exchange_id": "binance", "credential_id": 7},
        create_client_fn=lambda: object(),
        enqueue_market=lambda *a, **k: False,
    )
    logs = []
    monkeypatch.setattr(
        "app.services.live_trading.position_query.resolve_reduce_only_quantity",
        lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("ownership database unavailable")),
    )
    monkeypatch.setattr(
        "app.services.grid.engine.append_strategy_log",
        lambda *args, **_kwargs: logs.append(args),
    )

    assert engine._resolve_grid_exit_quantity(
        object(),
        pos_side="long",
        requested_qty=0.5,
    ) == 0.0
    assert any("protected inventory could not be verified" in str(row[-1]) for row in logs)


def test_grid_exit_budget_subtracts_existing_resting_exits(monkeypatch):
    from types import SimpleNamespace

    from app.services.grid.engine import GridEngine

    engine = GridEngine(
        42,
        "BTC/USDT",
        {"market_type": "swap", "bot_params": {"gridCount": 5}},
        {"exchange_id": "binance", "credential_id": 7},
        create_client_fn=lambda: object(),
        enqueue_market=lambda *a, **k: False,
    )
    monkeypatch.setattr(
        "app.services.live_trading.position_query.resolve_reduce_only_quantity",
        lambda **_kwargs: (
            0.8,
            {
                "db_size": 1.0,
                "exchange_size": 1.4,
                "exchange_strategy_available": 0.9,
            },
        ),
    )
    monkeypatch.setattr(
        engine._orders,
        "list_open",
        lambda _strategy_id: [
            SimpleNamespace(
                reduce_only=True,
                purpose="long_exit",
                pos_side="long",
                quantity=0.4,
                processed_fill_qty=0.0,
            ),
        ],
    )

    amount = engine._resolve_grid_exit_quantity(
        object(),
        pos_side="long",
        requested_qty=0.8,
    )

    assert amount == pytest.approx(0.5)


def test_grid_count_unit_preserves_legacy_bots_and_supports_exact_cell_counts():
    legacy = GridBotConfig.from_trading_config({
        "bot_params": {
            "upperPrice": 200,
            "lowerPrice": 100,
            "gridCount": 10,
            "amountPerGrid": 10,
        },
    })
    current = GridBotConfig.from_trading_config({
        "bot_params": {
            "upperPrice": 200,
            "lowerPrice": 100,
            "gridCount": 10,
            "gridCountUnit": "cells",
            "amountPerGrid": 10,
        },
    })

    assert legacy.grid_line_count == 10
    assert legacy.tradable_cell_count == 9
    assert current.grid_line_count == 11
    assert current.tradable_cell_count == 10


def test_initial_market_target_qty_100u_20pct_20x():
    """100 USDT * 20% margin * 20x leverage ≈ 400 USDT notional at 72710."""
    from app.services.grid.engine import GridEngine
    from app.services.grid.exchange_orders import make_grid_initial_client_order_id

    tc = {
        "initial_capital": 100,
        "leverage": 20,
        "market_type": "swap",
        "bot_params": {
            "upperPrice": 80200,
            "lowerPrice": 69800,
            "gridCount": 24,
            "amountPerGrid": 4,
            "gridDirection": "long",
            "initialPositionPct": 20,
        },
    }
    engine = GridEngine(
        42,
        "BTC/USDT",
        tc,
        {},
        create_client_fn=lambda: None,
        enqueue_market=lambda *a, **k: False,
    )
    qty = engine._target_initial_base_qty(72710.0)
    assert qty == pytest.approx(400.0 / 72710.0, rel=1e-4)
    assert make_grid_initial_client_order_id(42, leg="long") == make_grid_initial_client_order_id(42, leg="long")
    assert make_grid_initial_client_order_id(42, leg="long") != make_grid_initial_client_order_id(42, leg="short")


def test_grid_resting_client_order_ids_do_not_collide_within_same_second():
    from app.services.grid.exchange_orders import make_grid_client_order_id

    order_ids = {make_grid_client_order_id(42, 58, "long_exit") for _ in range(100)}

    assert len(order_ids) == 100
    assert all(len(order_id) <= 32 and order_id.isalnum() for order_id in order_ids)


def test_grid_line_qty_uses_quote_amount_times_leverage():
    from app.services.grid.engine import GridEngine

    tc = {
        "initial_capital": 100,
        "leverage": 20,
        "market_type": "swap",
        "bot_params": {
            "upperPrice": 80200,
            "lowerPrice": 69800,
            "gridCount": 24,
            "amountPerGrid": 4,
            "gridDirection": "long",
            "initialPositionPct": 0,
        },
    }
    engine = GridEngine(
        42,
        "BTC/USDT",
        tc,
        {},
        create_client_fn=lambda: None,
        enqueue_market=lambda *a, **k: False,
    )

    assert engine._grid_base_qty(72710.0) == pytest.approx(4.0 * 20.0 / 72710.0, rel=1e-4)


def test_boundary_stop_loss_auto_stops_neutral_grid(monkeypatch):
    from app.services.grid.engine import GridEngine

    tc = {
        "initial_capital": 100,
        "leverage": 5,
        "market_type": "swap",
        "bot_params": {
            "upperPrice": 81200,
            "lowerPrice": 70200,
            "gridCount": 28,
            "amountPerGrid": 3,
            "gridDirection": "neutral",
            "boundaryAction": "stop_loss",
        },
    }
    enqueued = []
    stopped = []
    logs = []

    monkeypatch.setattr("app.services.grid.engine.append_strategy_log", lambda *args: logs.append(args))
    monkeypatch.setattr("app.services.grid.engine.GridEngine.cancel_entry_orders_on_exchange", lambda self: None)
    monkeypatch.setattr(
        "app.services.strategy_lifecycle.auto_stop_live_strategy",
        lambda sid, reason, source="": stopped.append((sid, reason, source)) or True,
    )

    engine = GridEngine(
        77,
        "BTC/USDT",
        tc,
        {},
        create_client_fn=lambda: object(),
        enqueue_market=lambda *args: enqueued.append(args) or True,
    )

    assert engine.handle_boundary(69000.0) is True
    assert engine.stop_requested is True
    assert "out of bounds" in engine.stop_reason
    assert enqueued == [
        ("close_long", 0, 69000.0, "grid_boundary_stop"),
        ("close_short", 0, 69000.0, "grid_boundary_stop"),
    ]
    assert stopped and stopped[0][0] == 77
    assert stopped[0][2] == "grid_boundary"
    assert any("69000.0000" in str(row[-1]) and "70200.0000" in str(row[-1]) for row in logs)


def test_boundary_pause_does_not_auto_stop(monkeypatch):
    from app.services.grid.engine import GridEngine

    tc = {
        "initial_capital": 100,
        "leverage": 5,
        "market_type": "swap",
        "bot_params": {
            "upperPrice": 81200,
            "lowerPrice": 70200,
            "gridCount": 28,
            "amountPerGrid": 3,
            "gridDirection": "neutral",
            "boundaryAction": "pause",
        },
    }
    enqueued = []
    stopped = []

    monkeypatch.setattr("app.services.grid.engine.append_strategy_log", lambda *a: None)
    monkeypatch.setattr("app.services.grid.engine.GridEngine.cancel_entry_orders_on_exchange", lambda self: None)
    monkeypatch.setattr(
        "app.services.strategy_lifecycle.auto_stop_live_strategy",
        lambda *args, **kwargs: stopped.append((args, kwargs)) or True,
    )

    engine = GridEngine(
        78,
        "BTC/USDT",
        tc,
        {},
        create_client_fn=lambda: object(),
        enqueue_market=lambda *args: enqueued.append(args) or True,
    )

    assert engine.handle_boundary(69000.0) is True
    assert engine.stop_requested is False
    assert engine._paused_entries is True
    assert enqueued == []
    assert stopped == []


def test_neutral_grid_rehangs_held_cell_exits(monkeypatch):
    from types import SimpleNamespace

    from app.services.grid.engine import GridEngine
    from app.services.grid.levels import generate_cells, generate_levels
    from app.services.live_trading.grid_cells import GridCellState

    tc = {
        "initial_capital": 100,
        "leverage": 5,
        "market_type": "swap",
        "bot_params": {
            "upperPrice": 96,
            "lowerPrice": 72,
            "gridCount": 5,
            "amountPerGrid": 5,
            "gridDirection": "neutral",
        },
    }
    levels = generate_levels(72, 96, 5, "arithmetic")
    cells = generate_cells(levels)
    placed = []

    engine = GridEngine(
        79,
        "SOL/USDT",
        tc,
        {},
        create_client_fn=lambda: object(),
        enqueue_market=lambda *args: True,
    )
    engine._bootstrapped = True

    monkeypatch.setattr("app.services.grid.engine.append_strategy_log", lambda *a: None)
    monkeypatch.setattr("app.services.grid.engine.GridEngine._levels_and_cells", lambda self: (levels, cells))
    monkeypatch.setattr("app.services.grid.engine.GridEngine._normalize_grid_base_qty", lambda self, qty, px: qty)
    monkeypatch.setattr(
        engine._cells,
        "list_cells",
        lambda sid, symbol: [
            SimpleNamespace(cell_index=1, state=GridCellState.LONG_HELD, leg_size=1.2),
            SimpleNamespace(cell_index=2, state=GridCellState.SHORT_HELD, leg_size=0.8),
        ],
    )
    monkeypatch.setattr(engine._orders, "has_open_for_cell", lambda *args: False)

    def fake_place(self, cell, purpose, side, price, *, reduce_only, pos_side, quantity=None):
        placed.append((cell.index, purpose, side, price, reduce_only, pos_side, quantity))
        return True

    monkeypatch.setattr("app.services.grid.engine.GridEngine._place_limit", fake_place)

    assert engine.sync_held_cell_exits(80.0) == 2
    assert placed == [
        (1, "long_exit", "sell", cells[1].upper_price, True, "long", 1.2),
        (2, "short_exit", "buy", cells[2].lower_price, True, "short", 0.8),
    ]


def test_grid_shutdown_releases_cancelled_cell_states(monkeypatch):
    from app.services.grid.engine import GridEngine

    tc = {
        "initial_capital": 100,
        "leverage": 5,
        "market_type": "swap",
        "bot_params": {
            "upperPrice": 96,
            "lowerPrice": 72,
            "gridCount": 5,
            "amountPerGrid": 5,
            "gridDirection": "neutral",
        },
    }
    calls = []
    engine = GridEngine(
        80,
        "SOL/USDT",
        tc,
        {},
        create_client_fn=lambda: object(),
        enqueue_market=lambda *args: True,
    )
    monkeypatch.setattr("app.services.grid.engine.append_strategy_log", lambda *a: None)
    monkeypatch.setattr(engine, "cancel_all_orders_on_exchange", lambda: calls.append("exchange_cancel"))
    monkeypatch.setattr(engine._orders, "cancel_all", lambda sid, symbol: calls.append(("orders_cancel", sid, symbol)) or 3)
    monkeypatch.setattr(engine._cells, "release_cancelled_working_orders", lambda sid, symbol: calls.append(("cells_release", sid, symbol)) or 4)

    engine.shutdown()

    assert calls == [
        "exchange_cancel",
        ("cells_release", 80, "SOL/USDT"),
    ]


def test_initial_market_recovers_from_exchange_without_new_order(monkeypatch):
    from app.services.grid.engine import GridEngine

    tc = {
        "initial_capital": 100,
        "leverage": 20,
        "market_type": "swap",
        "bot_params": {
            "upperPrice": 80200,
            "lowerPrice": 69800,
            "gridCount": 24,
            "amountPerGrid": 4,
            "gridDirection": "long",
            "initialPositionPct": 20,
        },
    }
    recorded = {"calls": 0}

    def fake_record(*args, **kwargs):
        recorded["calls"] += 1

    monkeypatch.setattr("app.services.grid.engine.record_grid_market_fill", fake_record)
    monkeypatch.setattr("app.services.grid.engine.append_strategy_log", lambda *a, **k: None)
    monkeypatch.setattr("app.services.grid.engine.persist_grid_resting_state", lambda *a, **k: None)
    monkeypatch.setattr("app.services.grid.engine.GridEngine._has_initial_market_trade", lambda self: False)

    engine = GridEngine(
        7,
        "BTC/USDT",
        tc,
        {},
        create_client_fn=lambda: object(),
        enqueue_market=lambda *a, **k: False,
    )
    target = engine._target_initial_base_qty(72710.0)
    monkeypatch.setattr("app.services.grid.engine.GridEngine._leg_position_qty", lambda self, side: target)

    ok = engine.run_initial_market_position(72710.0)
    assert ok is True
    assert engine._initial_done is True
    assert recorded["calls"] == 1


def test_sync_exit_coverage_places_long_exit_for_uncovered_position(monkeypatch):
    from app.services.grid.engine import GridEngine
    from app.services.grid.levels import generate_cells, generate_levels

    tc = {
        "initial_capital": 1000,
        "leverage": 2,
        "market_type": "swap",
        "bot_params": {
            "upperPrice": 758,
            "lowerPrice": 588,
            "gridCount": 23,
            "amountPerGrid": 20,
            "gridDirection": "long",
            "initialPositionPct": 20,
        },
    }
    placed = []

    def fake_place(self, cell, purpose, side, price, *, reduce_only, pos_side, quantity=None):
        placed.append(
            {
                "purpose": purpose,
                "side": side,
                "price": price,
                "reduce_only": reduce_only,
                "quantity": quantity,
                "cell": cell.index,
            }
        )
        return True

    monkeypatch.setattr("app.services.grid.engine.append_strategy_log", lambda *a, **k: None)
    monkeypatch.setattr("app.services.grid.engine.GridEngine._place_limit", fake_place)
    monkeypatch.setattr(
        "app.services.grid.engine.GridEngine._strategy_leg_position_qty",
        lambda self, side: 0.059111,
    )
    monkeypatch.setattr("app.services.grid.engine.GridEngine._dedupe_open_exit_orders", lambda self, p: None)
    monkeypatch.setattr("app.services.grid.engine.GridEngine.sync_held_cell_exits", lambda self, px: 0)
    monkeypatch.setattr(
        "app.services.grid.engine.GridEngine._persist_initial_seeded_cells",
        lambda self: None,
    )
    monkeypatch.setattr(
        "app.services.grid.engine.GridEngine._grid_base_qty",
        lambda self, px: 0.059111,
    )
    monkeypatch.setattr(
        "app.services.grid.engine.GridEngine._levels_and_cells",
        lambda self: (
            generate_levels(588, 758, 23, "arithmetic"),
            generate_cells(generate_levels(588, 758, 23, "arithmetic")),
        ),
    )

    class FakeOrders:
        def list_open(self, strategy_id):
            return []

        def has_open_for_cell(self, strategy_id, cell_index, purpose):
            return False

    engine = GridEngine(
        9,
        "BNB/USDT",
        tc,
        {},
        create_client_fn=lambda: object(),
        enqueue_market=lambda *a, **k: False,
    )
    engine._bootstrapped = True
    engine._orders = FakeOrders()

    n = engine.sync_exit_coverage(676.8)
    assert n == 1
    assert len(placed) == 1
    assert placed[0]["purpose"] == "long_exit"
    assert placed[0]["side"] == "sell"
    assert placed[0]["reduce_only"] is True
    assert placed[0]["quantity"] == pytest.approx(0.059111)
    assert placed[0]["price"] > 676.8  # seed exits never cross below the current market


def test_sync_exit_coverage_distributes_initial_inventory_across_distinct_future_cells(monkeypatch):
    from app.services.grid.engine import GridEngine
    from app.services.grid.levels import generate_cells, generate_levels
    from app.services.live_trading.grid_cells import GridCell, GridCellState

    levels = generate_levels(90, 110, 10, "arithmetic")
    cells = generate_cells(levels)
    rows = [
        GridCell(
            strategy_id=19,
            symbol="BTC/USDT",
            cell_index=cell.index,
            lower_price=cell.lower_price,
            upper_price=cell.upper_price,
            state=GridCellState.IDLE,
        )
        for cell in cells
    ]
    placed = []

    class FakeOrders:
        def list_open(self, strategy_id):
            return []

        def has_open_for_cell(self, strategy_id, cell_index, purpose):
            # The nearest future cell already owns a working entry and cannot
            # also be used to sell initial inventory.
            return int(cell_index) == 5 and purpose == "long_entry"

    class FakeCells:
        def list_cells(self, strategy_id, symbol=None):
            return rows

    def fake_place(self, cell, purpose, side, price, *, reduce_only, pos_side, quantity=None):
        placed.append((cell.index, purpose, price, quantity))
        return True

    monkeypatch.setattr("app.services.grid.engine.append_strategy_log", lambda *a, **k: None)
    monkeypatch.setattr("app.services.grid.engine.GridEngine._place_limit", fake_place)
    monkeypatch.setattr(
        "app.services.grid.engine.GridEngine._strategy_leg_position_qty",
        lambda self, side: 3.0,
    )
    monkeypatch.setattr("app.services.grid.engine.GridEngine._grid_base_qty", lambda self, px: 1.0)
    monkeypatch.setattr("app.services.grid.engine.GridEngine._dedupe_open_exit_orders", lambda self, p: None)
    monkeypatch.setattr("app.services.grid.engine.GridEngine.sync_held_cell_exits", lambda self, px: 0)
    monkeypatch.setattr(
        "app.services.grid.engine.GridEngine._levels_and_cells",
        lambda self: (levels, cells),
    )
    monkeypatch.setattr(
        "app.services.grid.engine.GridEngine._persist_initial_seeded_cells",
        lambda self: None,
    )

    engine = GridEngine(
        19,
        "BTC/USDT",
        {
            "initial_capital": 100,
            "market_type": "swap",
            "bot_params": {
                "upperPrice": 110,
                "lowerPrice": 90,
                "gridCount": 10,
                "amountPerGrid": 10,
                "gridDirection": "long",
                "initialPositionPct": 30,
            },
        },
        {},
        create_client_fn=lambda: object(),
        enqueue_market=lambda *a, **k: False,
    )
    engine._bootstrapped = True
    engine._orders = FakeOrders()
    engine._cells = FakeCells()

    assert engine.sync_exit_coverage(100.0) == 3
    assert len({cell_index for cell_index, *_ in placed}) == 3
    assert all(price > 100.0 for _, _, price, _ in placed)
    assert all(cell_index != 5 for cell_index, *_ in placed)


def test_initial_recovery_uses_post_start_exchange_delta_only(monkeypatch):
    from app.services.grid.engine import GridEngine

    monkeypatch.setattr(
        "app.services.grid.engine.persist_grid_resting_state",
        lambda *a, **k: None,
    )
    engine = GridEngine(
        20,
        "BTC/USDT",
        {
            "initial_capital": 100,
            "market_type": "swap",
            "bot_params": {
                "upperPrice": 1.1,
                "lowerPrice": 0.9,
                "gridCount": 10,
                "amountPerGrid": 10,
                "gridDirection": "long",
                "initialPositionPct": 60,
            },
        },
        {},
        create_client_fn=lambda: object(),
        enqueue_market=lambda *a, **k: False,
    )
    engine.set_initial_exchange_baseline(long_size=0.5, short_size=0.2)
    monkeypatch.setattr(
        "app.services.grid.engine.GridEngine._leg_position_qty",
        lambda self, side: 0.6 if side == "long" else 0.2,
    )

    assert engine._initial_exchange_delta("long") == pytest.approx(0.1)
    assert engine._initial_exchange_delta("short") == pytest.approx(0.0)


def test_sync_exit_coverage_skips_when_exits_already_cover_position(monkeypatch):
    from app.services.grid.engine import GridEngine
    from app.services.grid.resting_orders_repo import GridRestingOrder

    tc = {
        "initial_capital": 1000,
        "leverage": 2,
        "market_type": "swap",
        "bot_params": {
            "upperPrice": 758,
            "lowerPrice": 588,
            "gridCount": 23,
            "amountPerGrid": 20,
            "gridDirection": "long",
            "initialPositionPct": 20,
        },
    }
    monkeypatch.setattr("app.services.grid.engine.GridEngine._leg_position_qty", lambda self, side: 4.08)
    monkeypatch.setattr(
        "app.services.grid.engine.GridEngine._levels_and_cells",
        lambda self: ([], []),
    )

    open_exit = GridRestingOrder(
        id=1,
        strategy_id=9,
        symbol="BNB/USDT",
        cell_index=11,
        purpose="long_exit",
        side="sell",
        pos_side="long",
        reduce_only=True,
        price=676.7,
        quantity=4.08,
        quote_amount=20,
        client_order_id="x",
        exchange_order_id="y",
        status="open",
        filled_quantity=0,
        processed_fill_qty=0,
    )

    class FakeOrders:
        def list_open(self, strategy_id):
            return [open_exit]

        def has_open_for_cell(self, strategy_id, cell_index, purpose):
            return True

    engine = GridEngine(
        9,
        "BNB/USDT",
        tc,
        {},
        create_client_fn=lambda: object(),
        enqueue_market=lambda *a, **k: False,
    )
    engine._bootstrapped = True
    engine._orders = FakeOrders()

    assert engine.sync_exit_coverage(676.8) == 0


def test_binance_exchange_open_exits_reserve_restart_quantity(monkeypatch):
    from app.services.grid.engine import GridEngine

    class FakeOrders:
        def list_open(self, strategy_id):
            return []

    class FakeBinance:
        def __init__(self):
            self.calls = 0

        def get_open_orders(self, *, symbol):
            self.calls += 1
            return [
                {
                    "symbol": "SOLUSDT",
                    "side": "SELL",
                    "positionSide": "LONG",
                    "reduceOnly": False,
                    "status": "NEW",
                    "origQty": "0.80",
                    "executedQty": "0.20",
                },
                {
                    "symbol": "SOLUSDT",
                    "side": "SELL",
                    "positionSide": "BOTH",
                    "reduceOnly": False,
                    "status": "NEW",
                    "origQty": "99",
                    "executedQty": "0",
                },
            ]

    client = FakeBinance()
    engine = GridEngine(
        574,
        "SOL/USDT",
        {"initial_capital": 1000, "market_type": "swap"},
        {"exchange_id": "binance", "credential_id": 7},
        create_client_fn=lambda: client,
        enqueue_market=lambda *a, **k: False,
    )
    engine._orders = FakeOrders()
    monkeypatch.setattr(
        "app.services.live_trading.position_query.resolve_reduce_only_quantity",
        lambda **kwargs: (
            1.0,
            {"db_size": 1.0, "exchange_strategy_available": 1.0},
        ),
    )
    monkeypatch.setattr("app.services.grid.engine.append_strategy_log", lambda *a, **k: None)

    assert engine._resolve_grid_exit_quantity(
        client,
        pos_side="long",
        requested_qty=1.0,
    ) == pytest.approx(0.4)
    assert engine._resolve_grid_exit_quantity(
        client,
        pos_side="long",
        requested_qty=1.0,
    ) == pytest.approx(0.4)
    assert client.calls == 1


def test_binance_reduce_only_conflict_does_not_auto_stop_grid(monkeypatch):
    from app.services.grid.engine import GridEngine

    engine = GridEngine(
        574,
        "SOL/USDT",
        {"initial_capital": 1000, "market_type": "swap"},
        {"exchange_id": "binance", "credential_id": 7},
        create_client_fn=lambda: object(),
        enqueue_market=lambda *a, **k: False,
    )
    monkeypatch.setattr("app.services.grid.engine.append_strategy_log", lambda *a, **k: None)

    error = RuntimeError(
        'Binance HTTP 400: {"code":-2022,"msg":"ReduceOnly Order is rejected."}'
    )
    for _ in range(6):
        engine._record_order_error("long_exit", error)

    assert engine.stop_requested is False
    assert engine._consecutive_order_errors == 0
    assert engine._last_reduce_only_conflict_ts > 0


def test_sync_exit_coverage_uses_a_distinct_cell_when_one_exit_is_already_open(monkeypatch):
    from app.services.grid.engine import GridEngine
    from app.services.grid.levels import generate_cells, generate_levels
    from app.services.grid.resting_orders_repo import GridRestingOrder

    tc = {
        "initial_capital": 1000,
        "leverage": 10,
        "market_type": "swap",
        "bot_params": {
            "upperPrice": 758,
            "lowerPrice": 588,
            "gridCount": 24,
            "amountPerGrid": 4,
            "gridDirection": "long",
            "initialPositionPct": 35,
        },
    }
    placed = []

    def fake_place(self, cell, purpose, side, price, *, reduce_only, pos_side, quantity=None):
        placed.append({"cell": cell.index, "quantity": quantity})
        return True

    levels = generate_levels(588, 758, 24, "arithmetic")
    cells = generate_cells(levels)

    open_exit = GridRestingOrder(
        id=1,
        strategy_id=9,
        symbol="BNB/USDT",
        cell_index=13,
        purpose="long_exit",
        side="sell",
        pos_side="long",
        reduce_only=True,
        price=691.47,
        quantity=0.51,
        quote_amount=4,
        client_order_id="x",
        exchange_order_id="y",
        status="open",
        filled_quantity=0,
        processed_fill_qty=0,
    )

    class FakeOrders:
        def list_open(self, strategy_id):
            return [open_exit]

        def has_open_for_cell(self, strategy_id, cell_index, purpose):
            return int(cell_index) == 13 and purpose == "long_exit"

    target = next(c for c in cells if c.index == 13)

    monkeypatch.setattr("app.services.grid.engine.append_strategy_log", lambda *a, **k: None)
    monkeypatch.setattr("app.services.grid.engine.GridEngine._place_limit", fake_place)
    monkeypatch.setattr(
        "app.services.grid.engine.GridEngine._strategy_leg_position_qty",
        lambda self, side: 0.62,
    )
    monkeypatch.setattr("app.services.grid.engine.GridEngine._dedupe_open_exit_orders", lambda self, p: None)
    monkeypatch.setattr("app.services.grid.engine.GridEngine.sync_held_cell_exits", lambda self, px: 0)
    monkeypatch.setattr(
        "app.services.grid.engine.GridEngine._active_cell_for_price",
        lambda self, _cells, _price, _direction: target,
    )
    monkeypatch.setattr(
        "app.services.grid.engine.GridEngine._levels_and_cells",
        lambda self: (levels, cells),
    )
    monkeypatch.setattr(
        "app.services.grid.engine.GridEngine._grid_base_qty",
        lambda self, px: 0.059111,
    )
    monkeypatch.setattr(
        "app.services.grid.engine.GridEngine._persist_initial_seeded_cells",
        lambda self: None,
    )

    engine = GridEngine(
        9,
        "BNB/USDT",
        tc,
        {},
        create_client_fn=lambda: object(),
        enqueue_market=lambda *a, **k: False,
    )
    engine._bootstrapped = True
    engine._orders = FakeOrders()

    assert engine.sync_exit_coverage(684.0) == 1
    assert len(placed) == 1
    assert placed[0]["cell"] != 13


def test_sync_exit_coverage_skips_when_position_below_one_grid(monkeypatch):
    from app.services.grid.engine import GridEngine
    from app.services.grid.levels import generate_cells, generate_levels

    tc = {
        "initial_capital": 100,
        "leverage": 10,
        "market_type": "swap",
        "bot_params": {
            "upperPrice": 758,
            "lowerPrice": 588,
            "gridCount": 24,
            "amountPerGrid": 4,
            "gridDirection": "long",
            "initialPositionPct": 35,
        },
    }
    placed = []

    def fake_place(self, *args, **kwargs):
        placed.append(1)
        return True

    levels = generate_levels(588, 758, 24, "arithmetic")
    cells = generate_cells(levels)

    class FakeOrders:
        def list_open(self, strategy_id):
            return []

        def has_open_for_cell(self, strategy_id, cell_index, purpose):
            return False

    monkeypatch.setattr("app.services.grid.engine.append_strategy_log", lambda *a, **k: None)
    monkeypatch.setattr("app.services.grid.engine.GridEngine._place_limit", fake_place)
    monkeypatch.setattr(
        "app.services.grid.engine.GridEngine._strategy_leg_position_qty",
        lambda self, side: 0.005,
    )
    monkeypatch.setattr("app.services.grid.engine.GridEngine._dedupe_open_exit_orders", lambda self, p: None)
    monkeypatch.setattr("app.services.grid.engine.GridEngine.sync_held_cell_exits", lambda self, px: 0)
    monkeypatch.setattr(
        "app.services.grid.engine.GridEngine._grid_base_qty",
        lambda self, px: 0.059111,
    )
    monkeypatch.setattr(
        "app.services.grid.engine.GridEngine._levels_and_cells",
        lambda self: (levels, cells),
    )

    engine = GridEngine(
        9,
        "BNB/USDT",
        tc,
        {},
        create_client_fn=lambda: object(),
        enqueue_market=lambda *a, **k: False,
    )
    engine._bootstrapped = True
    engine._orders = FakeOrders()

    assert engine.sync_exit_coverage(684.0) == 0
    assert placed == []


def test_sync_exit_coverage_does_not_cover_held_cell_with_active_price_cell(monkeypatch):
    from app.services.grid.engine import GridEngine
    from app.services.grid.levels import generate_cells, generate_levels
    from app.services.live_trading.grid_cells import GridCell, GridCellState

    tc = {
        "initial_capital": 1000,
        "leverage": 2,
        "market_type": "swap",
        "bot_params": {
            "upperPrice": 758,
            "lowerPrice": 588,
            "gridCount": 24,
            "amountPerGrid": 20,
            "gridDirection": "long",
            "initialPositionPct": 20,
        },
    }
    placed = []
    levels = generate_levels(588, 758, 24, "arithmetic")
    cells = generate_cells(levels)
    held = GridCell(
        strategy_id=9,
        symbol="BNB/USDT",
        cell_index=11,
        lower_price=cells[11].lower_price,
        upper_price=cells[11].upper_price,
        state=GridCellState.LONG_HELD,
        leg_size=0.05,
        leg_entry_price=669.3,
    )

    class FakeOrders:
        def list_open(self, strategy_id):
            return []

        def has_open_for_cell(self, strategy_id, cell_index, purpose):
            return False

    class FakeCells:
        def list_cells(self, strategy_id, symbol=None):
            return [held]

    def fake_place(self, *args, **kwargs):
        placed.append((args, kwargs))
        return True

    monkeypatch.setattr("app.services.grid.engine.append_strategy_log", lambda *a, **k: None)
    monkeypatch.setattr("app.services.grid.engine.GridEngine._place_limit", fake_place)
    monkeypatch.setattr(
        "app.services.grid.engine.GridEngine._strategy_leg_position_qty",
        lambda self, side: 0.05,
    )
    monkeypatch.setattr("app.services.grid.engine.GridEngine._dedupe_open_exit_orders", lambda self, p: None)
    monkeypatch.setattr(
        "app.services.grid.engine.GridEngine._levels_and_cells",
        lambda self: (levels, cells),
    )

    engine = GridEngine(
        9,
        "BNB/USDT",
        tc,
        {},
        create_client_fn=lambda: object(),
        enqueue_market=lambda *a, **k: False,
    )
    engine._bootstrapped = True
    engine._orders = FakeOrders()
    engine._cells = FakeCells()

    assert engine.sync_exit_coverage(669.3) == 1
    assert len(placed) == 1
    # The only allowed action is to repair the held cell's own TP, not to
    # sell the position at the current price's lower active cell.
    assert placed[0][0][1] == "long_exit"
    assert placed[0][0][0].index == 11
    assert placed[0][0][3] == pytest.approx(cells[11].upper_price)


def test_run_initial_market_stops_when_okx_net_position_exists(monkeypatch):
    from app.services.grid.engine import GridEngine

    tc = {
        "initial_capital": 1000,
        "leverage": 2,
        "market_type": "swap",
        "bot_params": {
            "upperPrice": 758,
            "lowerPrice": 588,
            "gridCount": 23,
            "amountPerGrid": 20,
            "gridDirection": "long",
            "initialPositionPct": 20,
        },
    }
    recorded = {"calls": 0, "market": 0}

    def fake_record(*args, **kwargs):
        recorded["calls"] += 1

    def fake_market(*args, **kwargs):
        recorded["market"] += 1
        return False, 0.0, 0.0

    monkeypatch.setattr("app.services.grid.engine.record_grid_market_fill", fake_record)
    monkeypatch.setattr("app.services.grid.engine.append_strategy_log", lambda *a, **k: None)
    monkeypatch.setattr("app.services.grid.engine.persist_grid_resting_state", lambda *a, **k: None)
    monkeypatch.setattr("app.services.grid.engine.GridEngine._has_initial_market_trade", lambda self: False)
    monkeypatch.setattr("app.services.grid.engine.execute_grid_market_order", fake_market)

    engine = GridEngine(
        11,
        "BNB/USDT",
        tc,
        {},
        create_client_fn=lambda: object(),
        enqueue_market=lambda *a, **k: False,
    )
    target = engine._target_initial_base_qty(679.0)
    monkeypatch.setattr("app.services.grid.engine.GridEngine._leg_position_qty", lambda self, side: target)

    ok = engine.run_initial_market_position(679.0)
    assert ok is True
    assert engine._initial_done is True
    assert recorded["calls"] == 1
    assert recorded["market"] == 0


def test_sync_grid_orders_skips_non_idle_cell(monkeypatch):
    from app.services.grid.engine import GridEngine
    from app.services.grid.levels import generate_cells, generate_levels
    from app.services.live_trading.grid_cells import GridCellState

    tc = {
        "initial_capital": 100,
        "leverage": 10,
        "market_type": "swap",
        "bot_params": {
            "upperPrice": 700,
            "lowerPrice": 680,
            "gridCount": 5,
            "amountPerGrid": 4,
            "gridDirection": "long",
        },
    }
    placed = []

    def fake_place(self, *args, **kwargs):
        placed.append(args)
        return True

    levels = generate_levels(680, 700, 5, "arithmetic")
    cells = generate_cells(levels)

    class FakeOrders:
        def list_open(self, strategy_id):
            return []

        def has_open_for_cell(self, strategy_id, cell_index, purpose):
            return False

        def update_status(self, *a, **k):
            return True

    monkeypatch.setattr("app.services.grid.engine.append_strategy_log", lambda *a, **k: None)
    monkeypatch.setattr("app.services.grid.engine.GridEngine._place_limit", fake_place)
    monkeypatch.setattr("app.services.grid.engine.GridEngine._dedupe_open_entry_orders", lambda self, p: None)
    monkeypatch.setattr(
        "app.services.grid.engine.GridEngine._levels_and_cells",
        lambda self: (levels, cells),
    )
    monkeypatch.setattr(
        "app.services.grid.engine.GridEngine._cell_state_by_index",
        lambda self: {3: GridCellState.LONG_HELD},
    )

    engine = GridEngine(
        9,
        "BNB/USDT",
        tc,
        {},
        create_client_fn=lambda: object(),
        enqueue_market=lambda *a, **k: False,
    )
    engine._bootstrapped = True
    engine._orders = FakeOrders()

    n = engine.sync_grid_orders(691.5)
    assert n == len(cells) - 1
    assert all(int(p[0].index) != 3 for p in placed)


def test_sync_grid_orders_skips_when_exit_open(monkeypatch):
    from app.services.grid.engine import GridEngine
    from app.services.grid.levels import generate_cells, generate_levels
    from app.services.live_trading.grid_cells import GridCellState

    tc = {
        "initial_capital": 100,
        "leverage": 10,
        "market_type": "swap",
        "bot_params": {
            "upperPrice": 700,
            "lowerPrice": 680,
            "gridCount": 5,
            "amountPerGrid": 4,
            "gridDirection": "long",
        },
    }
    placed = []

    def fake_place(self, *args, **kwargs):
        placed.append(args)
        return True

    levels = generate_levels(680, 700, 5, "arithmetic")
    cells = generate_cells(levels)
    target_idx = 2

    class FakeOrders:
        def list_open(self, strategy_id):
            return []

        def has_open_for_cell(self, strategy_id, cell_index, purpose):
            return int(cell_index) == target_idx and purpose == "long_exit"

        def update_status(self, *a, **k):
            return True

    monkeypatch.setattr("app.services.grid.engine.append_strategy_log", lambda *a, **k: None)
    monkeypatch.setattr("app.services.grid.engine.GridEngine._place_limit", fake_place)
    monkeypatch.setattr("app.services.grid.engine.GridEngine._dedupe_open_entry_orders", lambda self, p: None)
    monkeypatch.setattr(
        "app.services.grid.engine.GridEngine._levels_and_cells",
        lambda self: (levels, cells),
    )
    monkeypatch.setattr(
        "app.services.grid.engine.GridEngine._cell_state_by_index",
        lambda self: {target_idx: GridCellState.IDLE},
    )

    engine = GridEngine(
        9,
        "BNB/USDT",
        tc,
        {},
        create_client_fn=lambda: object(),
        enqueue_market=lambda *a, **k: False,
    )
    engine._bootstrapped = True
    engine._orders = FakeOrders()

    engine.sync_grid_orders(691.5)
    assert all(int(p[0].index) != target_idx for p in placed)


def test_on_order_filled_long_entry_marks_held_even_if_exit_hangs(monkeypatch):
    from app.services.grid.engine import GridEngine
    from app.services.grid.levels import GridCellSpec
    from app.services.grid.resting_orders_repo import GridRestingOrder
    from app.services.live_trading.grid_cells import GridCellState

    tc = {"market_type": "swap", "bot_params": {"gridDirection": "long", "gridCount": 5}}
    updates = []

    class FakeOrders:
        def has_open_for_cell(self, strategy_id, cell_index, purpose):
            return False

    class FakeCells:
        def update_state(self, *args, **kwargs):
            updates.append(kwargs)

    cell = GridCellSpec(index=1, lower_price=691.4, upper_price=691.5)
    order = GridRestingOrder(
        strategy_id=1,
        symbol="BNB/USDT",
        cell_index=1,
        purpose="long_entry",
        side="buy",
        pos_side="long",
        price=691.4,
        quantity=0.05,
    )

    monkeypatch.setattr("app.services.grid.engine.append_strategy_log", lambda *a, **k: None)
    monkeypatch.setattr(
        "app.services.grid.fill_handler.apply_grid_fill_to_local_state",
        lambda *a, **k: None,
    )
    monkeypatch.setattr(
        "app.services.grid.engine.GridEngine._levels_and_cells",
        lambda self: ([], [cell]),
    )
    monkeypatch.setattr("app.services.grid.engine.GridEngine._place_limit", lambda *a, **k: False)

    engine = GridEngine(
        1,
        "BNB/USDT",
        tc,
        {},
        create_client_fn=lambda: object(),
        enqueue_market=lambda *a, **k: False,
    )
    engine._orders = FakeOrders()
    engine._cells = FakeCells()

    engine.on_order_filled(order, 0.05, 691.4)
    assert len(updates) == 1
    assert updates[0]["state"] == GridCellState.LONG_HELD


def test_on_order_filled_long_exit_rehangs_entry_immediately(monkeypatch):
    from app.services.grid.engine import GridEngine
    from app.services.grid.levels import GridCellSpec
    from app.services.grid.resting_orders_repo import GridRestingOrder
    from app.services.live_trading.grid_cells import GridCellState

    tc = {"market_type": "swap", "bot_params": {"gridDirection": "long", "gridCount": 5}}
    placed = []
    state = {"value": GridCellState.LONG_HELD}

    class FakeOrders:
        def has_open_for_cell(self, strategy_id, cell_index, purpose):
            return False

    class FakeCells:
        def update_state(self, *args, **kwargs):
            state["value"] = kwargs["state"]

    cell = GridCellSpec(index=1, lower_price=691.4, upper_price=691.5)
    order = GridRestingOrder(
        strategy_id=1,
        symbol="BNB/USDT",
        cell_index=1,
        purpose="long_exit",
        side="sell",
        pos_side="long",
        price=691.5,
        quantity=0.05,
    )

    def fake_place(self, cell, purpose, side, price, *, reduce_only, pos_side, quantity=None):
        placed.append(
            {
                "purpose": purpose,
                "side": side,
                "price": price,
                "reduce_only": reduce_only,
                "pos_side": pos_side,
                "quantity": quantity,
            }
        )
        state["value"] = GridCellState.BUY_OPEN
        return True

    monkeypatch.setattr("app.services.grid.engine.append_strategy_log", lambda *a, **k: None)
    monkeypatch.setattr(
        "app.services.grid.fill_handler.apply_grid_fill_to_local_state",
        lambda *a, **k: None,
    )
    monkeypatch.setattr(
        "app.services.grid.engine.GridEngine._levels_and_cells",
        lambda self: ([], [cell]),
    )
    monkeypatch.setattr(
        "app.services.grid.engine.GridEngine._cell_state_by_index",
        lambda self: {1: state["value"]},
    )
    monkeypatch.setattr("app.services.grid.engine.GridEngine._place_limit", fake_place)

    engine = GridEngine(
        1,
        "BNB/USDT",
        tc,
        {},
        create_client_fn=lambda: object(),
        enqueue_market=lambda *a, **k: False,
    )
    engine._orders = FakeOrders()
    engine._cells = FakeCells()

    engine.on_order_filled(order, 0.05, 691.5)
    assert placed == [
        {
            "purpose": "long_entry",
            "side": "buy",
            "price": 691.4,
            "reduce_only": False,
            "pos_side": "long",
            "quantity": 0.05,
        }
    ]
    assert state["value"] == GridCellState.BUY_OPEN


def test_on_order_filled_short_exit_rehangs_entry_immediately(monkeypatch):
    from app.services.grid.engine import GridEngine
    from app.services.grid.levels import GridCellSpec
    from app.services.grid.resting_orders_repo import GridRestingOrder
    from app.services.live_trading.grid_cells import GridCellState

    tc = {"market_type": "swap", "bot_params": {"gridDirection": "short", "gridCount": 5}}
    placed = []
    state = {"value": GridCellState.SHORT_HELD}

    class FakeOrders:
        def has_open_for_cell(self, strategy_id, cell_index, purpose):
            return False

    class FakeCells:
        def update_state(self, *args, **kwargs):
            state["value"] = kwargs["state"]

    cell = GridCellSpec(index=1, lower_price=691.4, upper_price=691.5)
    order = GridRestingOrder(
        strategy_id=1,
        symbol="BNB/USDT",
        cell_index=1,
        purpose="short_exit",
        side="buy",
        pos_side="short",
        price=691.4,
        quantity=0.05,
    )

    def fake_place(self, cell, purpose, side, price, *, reduce_only, pos_side, quantity=None):
        placed.append(
            {
                "purpose": purpose,
                "side": side,
                "price": price,
                "reduce_only": reduce_only,
                "pos_side": pos_side,
                "quantity": quantity,
            }
        )
        state["value"] = GridCellState.SELL_OPEN
        return True

    monkeypatch.setattr("app.services.grid.engine.append_strategy_log", lambda *a, **k: None)
    monkeypatch.setattr(
        "app.services.grid.fill_handler.apply_grid_fill_to_local_state",
        lambda *a, **k: None,
    )
    monkeypatch.setattr(
        "app.services.grid.engine.GridEngine._levels_and_cells",
        lambda self: ([], [cell]),
    )
    monkeypatch.setattr(
        "app.services.grid.engine.GridEngine._cell_state_by_index",
        lambda self: {1: state["value"]},
    )
    monkeypatch.setattr("app.services.grid.engine.GridEngine._place_limit", fake_place)

    engine = GridEngine(
        1,
        "BNB/USDT",
        tc,
        {},
        create_client_fn=lambda: object(),
        enqueue_market=lambda *a, **k: False,
    )
    engine._orders = FakeOrders()
    engine._cells = FakeCells()

    engine.on_order_filled(order, 0.05, 691.4)
    assert placed == [
        {
            "purpose": "short_entry",
            "side": "sell",
            "price": 691.5,
            "reduce_only": False,
            "pos_side": "short",
            "quantity": 0.05,
        }
    ]
    assert state["value"] == GridCellState.SELL_OPEN


def test_grid_fill_profit_uses_cell_entry_price(monkeypatch):
    from app.services.grid import fill_handler
    from app.services.grid.resting_orders_repo import GridRestingOrder
    from app.services.live_trading.grid_cells import GridCell, GridCellState

    cell = GridCell(
        strategy_id=1,
        symbol="BNB/USDT",
        cell_index=11,
        lower_price=669.3043,
        upper_price=676.6957,
        state=GridCellState.LONG_HELD,
        leg_size=0.05,
        leg_entry_price=669.3,
    )
    captured = {}

    class FakeCellRepo:
        def list_cells(self, strategy_id, symbol=None):
            return [cell]

    monkeypatch.setattr(fill_handler, "GridCellRepository", lambda: FakeCellRepo())
    monkeypatch.setattr(fill_handler, "resolve_leg_context", lambda **kwargs: None)
    monkeypatch.setattr(
        fill_handler,
        "apply_fill_to_local_position",
        lambda **kwargs: (-0.99, None, 690.0),
    )
    monkeypatch.setattr(fill_handler, "record_trade", lambda **kwargs: captured.update(kwargs))

    order = GridRestingOrder(
        strategy_id=1,
        symbol="BNB/USDT",
        cell_index=11,
        purpose="long_exit",
        side="sell",
        pos_side="long",
        price=676.6957,
        quantity=0.05,
    )

    fill_handler.apply_grid_fill_to_local_state(
        1,
        "BNB/USDT",
        order,
        0.05,
        676.7,
        {"market_type": "swap", "commission": 0},
    )

    expected = (676.7 - 669.3) * 0.05
    assert captured["profit"] == pytest.approx(expected)
    assert captured["grid_matched_profit"] == pytest.approx(expected)
    assert captured["matched_entry_price"] == pytest.approx(669.3)


def test_grid_fill_ledger_failure_is_not_silently_marked_processed(monkeypatch):
    from app.services.grid import fill_handler
    from app.services.grid.resting_orders_repo import GridRestingOrder

    monkeypatch.setattr(fill_handler, "resolve_leg_context", lambda **kwargs: None)
    monkeypatch.setattr(
        fill_handler,
        "apply_fill_to_local_position",
        lambda **kwargs: (_ for _ in ()).throw(RuntimeError("ledger unavailable")),
    )

    order = GridRestingOrder(
        id=99,
        strategy_id=1,
        symbol="BNB/USDT",
        cell_index=11,
        purpose="long_entry",
        side="buy",
        pos_side="long",
        price=676.7,
        quantity=0.05,
    )

    with pytest.raises(RuntimeError, match="ledger unavailable"):
        fill_handler.apply_grid_fill_to_local_state(
            1,
            "BNB/USDT",
            order,
            0.05,
            676.7,
            {"market_type": "swap"},
        )


def test_grid_market_fill_ledger_failure_is_not_silently_accepted(monkeypatch):
    from app.services.grid import fill_handler

    monkeypatch.setattr(fill_handler, "resolve_leg_context", lambda **kwargs: None)
    monkeypatch.setattr(
        fill_handler,
        "apply_fill_to_local_position",
        lambda **kwargs: (_ for _ in ()).throw(RuntimeError("ledger unavailable")),
    )

    with pytest.raises(RuntimeError, match="ledger unavailable"):
        fill_handler.record_grid_market_fill(
            1,
            "BNB/USDT",
            "open_long",
            0.05,
            676.7,
            {"market_type": "swap"},
        )
