"""Persist strategy runtime lines for the strategy management UI (`qd_strategy_logs`)."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from app.data_sources.errors import MarketDataFailure
from app.utils.db import get_db_connection
from app.utils.logger import get_logger

logger = get_logger(__name__)
MARKET_DATA_LOG_PREFIX = "market-data|"


def format_market_data_log(failure: MarketDataFailure) -> str:
    """Serialize a typed market-data event without changing the log table schema."""
    return MARKET_DATA_LOG_PREFIX + json.dumps(
        failure.as_dict(), ensure_ascii=False, separators=(",", ":")
    )


def parse_market_data_log(message: Any) -> dict[str, Any] | None:
    raw = str(message or "")
    if not raw.startswith(MARKET_DATA_LOG_PREFIX):
        return None
    try:
        value = json.loads(raw[len(MARKET_DATA_LOG_PREFIX):])
    except (TypeError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def append_strategy_log(strategy_id: int, level: str, message: str) -> None:
    """Best-effort insert; never raises to caller."""
    try:
        sid = int(strategy_id)
        lv = (level or "info").strip().lower()[:20]
        msg = str(message or "").strip()
        if not msg:
            return
        msg = msg[:8000]
        with get_db_connection() as db:
            cur = db.cursor()
            cur.execute(
                """
                INSERT INTO qd_strategy_logs (strategy_id, level, message, timestamp)
                SELECT ?, ?, ?, ?
                WHERE EXISTS (
                    SELECT 1 FROM qd_strategies_trading WHERE id = ?
                )
                """,
                (sid, lv, msg, datetime.now(timezone.utc), sid),
            )
            db.commit()
            cur.close()
    except Exception as e:
        logger.debug("append_strategy_log skip: %s", e)
