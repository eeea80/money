from app.routes import strategy as strategy_routes
from app.services.strategy_runtime import health


def test_strategy_rows_include_runtime_health(monkeypatch):
    captured = {}

    def load(strategy_ids, *, strategy_statuses=None):
        captured["ids"] = list(strategy_ids)
        captured["statuses"] = dict(strategy_statuses or {})
        return {
            20: {
                "health": "healthy",
                "last_heartbeat_at": 1784434455,
                "loop_latency_ms": 37,
            }
        }

    monkeypatch.setattr(strategy_routes, "load_runtime_health", load)

    rows = strategy_routes._attach_runtime_health([
        {"id": 20, "status": "running", "strategy_name": "Momentum"}
    ])

    assert captured == {"ids": [20], "statuses": {20: "running"}}
    assert rows[0]["runtime_health"]["health"] == "healthy"
    assert rows[0]["runtime_health"]["loop_latency_ms"] == 37


def test_strategy_rows_include_daily_pnl_metrics(monkeypatch):
    captured = {}

    monkeypatch.setattr(strategy_routes, "load_runtime_health", lambda *_args, **_kwargs: {})

    def load_metrics(rows, *, user_id, client_timezone=""):
        captured["rows"] = list(rows)
        captured["user_id"] = user_id
        captured["timezone"] = client_timezone
        return {20: {"today_pnl": 23.0, "today_pnl_estimated": False}}

    monkeypatch.setattr(strategy_routes, "load_strategy_daily_metrics", load_metrics)
    rows = strategy_routes._attach_runtime_health(
        [{"id": 20, "status": "running", "strategy_name": "Momentum"}],
        user_id=7,
        client_timezone="Asia/Shanghai",
    )

    assert captured["user_id"] == 7
    assert captured["timezone"] == "Asia/Shanghai"
    assert rows[0]["today_pnl"] == 23.0
    assert rows[0]["today_pnl_estimated"] is False


def test_runtime_heartbeat_persists_loop_latency(monkeypatch):
    saved = {}
    health.reset_runtime_heartbeat_coalescer()

    class Store:
        def __init__(self, **kwargs):
            saved["identity"] = kwargs

        def save(self, values):
            saved["values"] = values

    from app.services.strategy_runtime import state

    monkeypatch.setattr(state, "RuntimeStateStore", Store)
    monkeypatch.setattr(health.time, "time", lambda: 1784434455)

    health.record_runtime_heartbeat(
        strategy_id=20,
        strategy_run_id=7,
        symbol="BTC/USDT",
        price=64655.9,
        pending_signal_count=2,
        loop_latency_ms=41,
    )

    assert saved["identity"] == {
        "strategy_id": 20,
        "strategy_run_id": 7,
        "state_key": "health",
    }
    assert saved["values"]["last_heartbeat_at"] == 1784434455
    assert saved["values"]["loop_latency_ms"] == 41
    assert saved["values"]["latency_ms"] == 41


def test_runtime_heartbeat_coalesces_repeated_writes_but_persists_status_changes(monkeypatch):
    writes = []
    health.reset_runtime_heartbeat_coalescer()

    class Store:
        def __init__(self, **_kwargs):
            pass

        def save(self, values):
            writes.append(values)

    from app.services.strategy_runtime import state
    from app.services import strategy_daily_pnl

    clock = iter([100.0, 101.0, 102.0])
    monkeypatch.setattr(state, "RuntimeStateStore", Store)
    monkeypatch.setattr(health.time, "time", lambda: next(clock))
    monkeypatch.setattr(strategy_daily_pnl, "maybe_capture_strategy_equity_snapshot", lambda _id: None)

    common = {
        "strategy_id": 20,
        "strategy_run_id": 7,
        "symbol": "BTC/USDT",
        "pending_signal_count": 0,
    }
    health.record_runtime_heartbeat(**common, price=100.0)
    health.record_runtime_heartbeat(**common, price=101.0)
    health.record_runtime_heartbeat(
        **common,
        price=101.0,
        status="degraded",
        last_error="quote stale",
    )

    assert len(writes) == 2
    assert writes[-1]["status"] == "degraded"


def test_historical_failed_order_does_not_degrade_current_run(monkeypatch):
    snapshots = {
        20: {
            **health._empty_snapshot(),
            "run_id": 7,
        }
    }

    monkeypatch.setattr(
        health,
        "_query",
        lambda _sql, _params: [
            {
                "strategy_id": 20,
                "strategy_run_id": 6,
                "pending_orders": 0,
                "failed_orders": 1,
                "historical_failed_orders": 3,
            },
            {
                "strategy_id": 20,
                "strategy_run_id": 7,
                "pending_orders": 0,
                "failed_orders": 0,
                "historical_failed_orders": 1,
            },
        ],
    )

    health._load_pending_orders(snapshots, "%s", [20])

    assert snapshots[20]["failed_orders"] == 0
    assert snapshots[20]["historical_failed_orders"] == 1


def test_recent_failed_order_degrades_until_attention_window_expires():
    snapshot = {
        **health._empty_snapshot(),
        "run_id": 7,
        "last_heartbeat_at": 1_000,
        "failed_orders": 1,
    }

    assert health._health_state(snapshot, strategy_status="running", now=1_010) == "degraded"

    snapshot["failed_orders"] = 0
    assert health._health_state(snapshot, strategy_status="running", now=1_010) == "healthy"


def test_position_drift_degrades_running_strategy_health():
    snapshot = {
        **health._empty_snapshot(),
        "run_id": 7,
        "last_heartbeat_at": 1_000,
        "position_drift_blocked": True,
        "position_drift_count": 1,
    }

    assert health._health_state(snapshot, strategy_status="running", now=1_010) == "degraded"


def test_position_ownership_loader_attaches_matching_okx_drift(monkeypatch):
    snapshots = {
        20: {
            **health._empty_snapshot(),
            "_ownership_context": {
                "user_id": 7,
                "exchange_id": "okx",
                "credential_id": 12,
                "symbol": "BTC/USDT",
                "market_type": "swap",
            },
        },
        21: {
            **health._empty_snapshot(),
            "_ownership_context": {
                "user_id": 7,
                "exchange_id": "bitget",
                "credential_id": 13,
                "symbol": "BTC/USDT",
                "market_type": "swap",
            },
        },
    }
    monkeypatch.setattr(
        health,
        "_query",
        lambda _sql, params: [
            {
                "user_id": 7,
                "credential_id": 12,
                "exchange_id": "okx",
                "market_type": "swap",
                "symbol_canonical": "BTC/USDT",
                "side": "long",
                "coexistence_mode": "strict",
                "manual_reserved_qty": 0,
                "observed_account_qty": 0.0145,
                "allocated_qty": 0,
                "status": "drift_blocked",
                "drift_reason": "unallocated_account_position",
            }
        ],
    )

    health._load_position_ownership(snapshots)

    assert snapshots[20]["position_drift_blocked"] is True
    assert snapshots[20]["position_drift_count"] == 1
    assert snapshots[20]["position_drift_sides"] == ["long"]
    assert snapshots[20]["position_drift_details"][0]["account_qty"] == 0.0145
    assert snapshots[21]["position_drift_blocked"] is False
