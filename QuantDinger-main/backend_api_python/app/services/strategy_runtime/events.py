"""Runtime event ledger helpers."""

from __future__ import annotations

import json
from typing import Any, Dict

from app.utils.db import get_db_connection
from app.utils.logger import get_logger

logger = get_logger(__name__)


def append_runtime_event(
    *,
    strategy_id: int,
    strategy_run_id: int = 0,
    event_type: str,
    severity: str = "info",
    message: str = "",
    payload: Dict[str, Any] | None = None,
) -> None:
    try:
        safe_payload = json.loads(json.dumps(payload or {}, default=str))
    except Exception:
        safe_payload = {}
    try:
        with get_db_connection() as db:
            cur = db.cursor()
            cur.execute(
                """
                INSERT INTO strategy_runtime_events
                (strategy_run_id, strategy_id, event_type, severity, message, payload_json, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, NOW())
                """,
                (
                    int(strategy_run_id or 0),
                    int(strategy_id or 0),
                    str(event_type or "")[:64],
                    str(severity or "info")[:16],
                    str(message or ""),
                    json.dumps(safe_payload, ensure_ascii=False),
                ),
            )
            db.commit()
            cur.close()
    except Exception as exc:
        logger.debug("append runtime event skipped: %s", exc)
