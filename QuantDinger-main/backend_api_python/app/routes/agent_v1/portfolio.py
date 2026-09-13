"""Portfolio (read-only summary, class R).

Surfaces the calling tenant's manual positions in a stable shape suitable
for agent reasoning.  We only read from `qd_user_positions`-style tables that
already exist; we do NOT expose alerts/monitors here (those are a separate W
class addition for a future phase).
"""
from __future__ import annotations

from app.utils.agent_auth import SCOPE_R, agent_required, current_user_id
from app.utils.db import get_db_connection
from app.utils.logger import get_logger

from . import agent_v1_bp
from ._helpers import envelope, error

logger = get_logger(__name__)


@agent_v1_bp.route("/portfolio/positions", methods=["GET"])
@agent_required(SCOPE_R)
def positions():
    """Manual portfolio positions for the calling tenant."""
    try:
        with get_db_connection() as db:
            cur = db.cursor()
            cur.execute(
                """
                SELECT id, market, symbol, quantity, avg_price, currency,
                       notes, created_at, updated_at
                FROM qd_user_positions
                WHERE user_id = %s
                ORDER BY id DESC
                """,
                (current_user_id(),),
            )
            rows = cur.fetchall() or []
            cur.close()
        return envelope(rows)
    except Exception as exc:
        # Tenants without the table get an empty list rather than a 500.
        msg = str(exc).lower()
        if "does not exist" in msg or "undefinedtable" in msg:
            return envelope([])
        logger.error(f"agent_v1/portfolio failed: {exc}", exc_info=True)
        return error(500, "portfolio query failed", details=str(exc), http=500)


@agent_v1_bp.route("/portfolio/paper-orders", methods=["GET"])
@agent_required(SCOPE_R)
def paper_orders():
    """List recent paper orders the agent has submitted (per tenant)."""
    try:
        with get_db_connection() as db:
            cur = db.cursor()
            cur.execute(
                """
                SELECT order_uid, market, symbol, side, order_type, qty,
                       limit_price, fill_price, fill_value, status, note, created_at
                FROM qd_agent_paper_orders
                WHERE user_id = %s
                ORDER BY id DESC LIMIT 200
                """,
                (current_user_id(),),
            )
            rows = cur.fetchall() or []
            cur.close()
        return envelope(rows)
    except Exception as exc:
        logger.error(f"agent_v1/paper_orders failed: {exc}", exc_info=True)
        return error(500, "paper orders query failed", details=str(exc), http=500)
