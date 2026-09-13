"""Runtime overview and strategy control endpoints for Agent Gateway."""
from __future__ import annotations

from app.routes.agent_v1 import agent_v1_bp
from app.routes.agent_v1._helpers import envelope, error
from app.services.strategy import StrategyService
from app.utils.agent_auth import SCOPE_R, SCOPE_T, agent_required, current_user_id
from app.utils.db import get_db_connection
from app.utils.logger import get_logger

logger = get_logger(__name__)
_strategy_service = StrategyService()


@agent_v1_bp.route("/runtime/overview", methods=["GET"])
@agent_required(SCOPE_R)
def runtime_overview():
    """Compact tenant runtime overview for external agents."""
    user_id = current_user_id()
    try:
        with get_db_connection() as db:
            cur = db.cursor()
            cur.execute(
                """
                SELECT id, strategy_name, strategy_type,
                       execution_mode, status, market_category, symbol,
                       timeframe, initial_capital, market_type, updated_at
                FROM qd_strategies_trading
                WHERE user_id = %s
                ORDER BY updated_at DESC, id DESC
                """,
                (user_id,),
            )
            strategies = cur.fetchall() or []

            cur.execute(
                """
                SELECT COUNT(*) AS count,
                       COALESCE(SUM(COALESCE(unrealized_pnl, 0)), 0) AS unrealized_pnl
                FROM qd_strategy_positions
                WHERE user_id = %s
                """,
                (user_id,),
            )
            position_summary = cur.fetchone() or {}

            cur.execute(
                """
                SELECT COUNT(*) AS count
                FROM pending_orders
                WHERE user_id = %s
                  AND status IN ('pending', 'processing', 'submitted', 'syncing')
                """,
                (user_id,),
            )
            pending_summary = cur.fetchone() or {}

            cur.execute(
                """
                SELECT COUNT(*) AS count
                FROM qd_agent_paper_orders
                WHERE user_id = %s
                """,
                (user_id,),
            )
            paper_summary = cur.fetchone() or {}
            cur.close()
    except Exception as exc:
        logger.error(f"agent_v1/runtime overview failed: {exc}", exc_info=True)
        return error(500, "runtime overview failed", details=str(exc), http=500)

    running = [s for s in strategies if str(s.get("status") or "").lower() == "running"]
    counts = {
        "strategies_total": len(strategies),
        "running_total": len(running),
        "running_live": sum(1 for s in running if str(s.get("execution_mode") or "").lower() == "live"),
        "running_signal_mode": sum(1 for s in running if str(s.get("execution_mode") or "").lower() == "signal"),
        "positions": int(position_summary.get("count") or 0),
        "pending_orders": int(pending_summary.get("count") or 0),
        "agent_paper_orders": int(paper_summary.get("count") or 0),
    }

    items = []
    for row in running[:50]:
        items.append({
            "id": row.get("id"),
            "name": row.get("strategy_name"),
            "type": row.get("strategy_type"),
            "execution_mode": row.get("execution_mode"),
            "market": row.get("market_category"),
            "symbol": row.get("symbol"),
            "timeframe": row.get("timeframe"),
            "market_type": row.get("market_type"),
            "initial_capital": row.get("initial_capital"),
            "updated_at": row.get("updated_at"),
        })

    return envelope({
        "counts": counts,
        "unrealized_pnl": float(position_summary.get("unrealized_pnl") or 0),
        "running_strategies": items,
    })


@agent_v1_bp.route("/strategies/<int:strategy_id>/stop", methods=["POST"])
@agent_required(SCOPE_T)
def stop_strategy(strategy_id: int):
    """Stop one tenant strategy and verify persisted stopped status."""
    user_id = current_user_id()
    strategy = _strategy_service.get_strategy(strategy_id, user_id=user_id)
    if not strategy:
        return error(404, "Strategy not found", http=404)

    if str(strategy.get("strategy_type") or "") == "PromptBasedStrategy":
        return error(400, "PromptBasedStrategy is not supported in local runtime")

    if not _strategy_service.update_strategy_status(strategy_id, "stopped", user_id=user_id):
        return error(500, "Failed to persist stopped status", http=500)

    executor_ok = True
    try:
        from app.routes.strategy_services import get_trading_executor

        executor_ok = bool(get_trading_executor().stop_strategy(strategy_id, persist_status=False))
    except Exception as exc:
        logger.warning(f"agent_v1 stop executor failed for strategy {strategy_id}: {exc}")
        executor_ok = False

    latest = _strategy_service.get_strategy(strategy_id, user_id=user_id)
    status = str((latest or {}).get("status") or "").lower()
    if status != "stopped":
        return error(
            500,
            "Stop verification failed; strategy status is not stopped",
            details={"status": status},
            http=500,
        )

    return envelope({
        "strategy_id": strategy_id,
        "status": "stopped",
        "executor_stopped": executor_ok,
    }, message="stopped")
