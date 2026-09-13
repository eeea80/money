"""Persistence helpers for AI Copilot sessions, messages, and memories."""
from __future__ import annotations

import json
import re
from datetime import date, datetime, timezone
from typing import Any

from app.utils.logger import get_logger

logger = get_logger(__name__)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def json_dumps(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        default=_json_default,
    )


def _json_default(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def row_to_dict(row: Any) -> dict:
    return dict(row or {})


def json_loads(value: Any, default: Any = None) -> Any:
    if value is None or value == "":
        return default
    try:
        return json.loads(value)
    except Exception:
        return default


def get_user_memories(cur, user_id: int, limit: int = 12) -> list[dict]:
    try:
        cur.execute(
            """
            SELECT id, category, title, content, confidence, updated_at
            FROM qd_ai_user_memories
            WHERE user_id = ? AND is_active = TRUE
            ORDER BY updated_at DESC, id DESC
            LIMIT ?
            """,
            (user_id, int(limit)),
        )
        return [row_to_dict(r) for r in (cur.fetchall() or [])]
    except Exception as exc:
        logger.debug("Failed to load user memories: %s", exc)
        return []


def detect_memory_candidates(message: str, language: str) -> list[dict]:
    text = (message or "").strip()
    if len(text) < 8:
        return []
    lower = text.lower()
    zh = (language or "").lower().startswith("zh")
    markers = [
        "我偏好", "我的偏好", "我喜欢", "我不喜欢", "不要", "不希望", "风险偏好", "交易周期",
        "timeframe", "risk profile", "i prefer", "i like", "i don't want", "avoid", "do not",
    ]
    if not any(m.lower() in lower for m in markers):
        return []
    title = "交易偏好" if zh else "Trading preference"
    if any(m in lower for m in ("不要", "不希望", "avoid", "don't want", "do not")):
        title = "交易限制" if zh else "Trading constraint"
    return [{
        "category": "preference",
        "title": title,
        "content": text[:500],
        "confidence": 75,
    }]


def ensure_tables(cur) -> None:
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS qd_ai_copilot_sessions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            title VARCHAR(160),
            context_symbol VARCHAR(64),
            context_market VARCHAR(32),
            context_strategy_id INTEGER,
            summary_json TEXT,
            summary_until_message_id INTEGER,
            summary_version INTEGER DEFAULT 0,
            summary_updated_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS qd_ai_copilot_messages (
            id SERIAL PRIMARY KEY,
            session_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            role VARCHAR(16) NOT NULL,
            content TEXT NOT NULL,
            attachments_json TEXT,
            actions_json TEXT,
            report_json TEXT,
            report_target_json TEXT,
            report_error TEXT,
            report_error_tone VARCHAR(32),
            referenced_report_id INTEGER,
            intent VARCHAR(48),
            created_at TIMESTAMP DEFAULT NOW()
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS qd_ai_copilot_requests (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            session_id INTEGER NOT NULL,
            message_id INTEGER,
            input_chars INTEGER DEFAULT 0,
            estimated_input_tokens INTEGER DEFAULT 0,
            estimated_output_tokens INTEGER DEFAULT 0,
            history_message_count INTEGER DEFAULT 0,
            summary_version INTEGER DEFAULT 0,
            memory_count INTEGER DEFAULT 0,
            report_message_id INTEGER,
            context_truncated BOOLEAN DEFAULT FALSE,
            finish_reason VARCHAR(32),
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS qd_ai_copilot_tool_calls (
            id SERIAL PRIMARY KEY,
            session_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            tool_name VARCHAR(64) NOT NULL,
            status VARCHAR(24) NOT NULL,
            input_json TEXT,
            output_json TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS qd_ai_user_memories (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            category VARCHAR(48) NOT NULL DEFAULT 'preference',
            title VARCHAR(160) NOT NULL,
            content TEXT NOT NULL,
            source VARCHAR(48) DEFAULT 'copilot',
            confidence INTEGER DEFAULT 70,
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS qd_ai_saved_prompts (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            title VARCHAR(160) NOT NULL,
            prompt TEXT NOT NULL,
            category VARCHAR(48) NOT NULL DEFAULT 'research',
            context_market VARCHAR(32),
            context_symbol VARCHAR(64),
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS qd_ai_copilot_events (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            event_type VARCHAR(48) NOT NULL,
            task_key VARCHAR(64),
            context_json TEXT,
            metadata_json TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        )
        """
    )
    for ddl in (
        "ALTER TABLE qd_ai_copilot_sessions ADD COLUMN IF NOT EXISTS summary_json TEXT",
        "ALTER TABLE qd_ai_copilot_sessions ADD COLUMN IF NOT EXISTS summary_until_message_id INTEGER",
        "ALTER TABLE qd_ai_copilot_sessions ADD COLUMN IF NOT EXISTS summary_version INTEGER DEFAULT 0",
        "ALTER TABLE qd_ai_copilot_sessions ADD COLUMN IF NOT EXISTS summary_updated_at TIMESTAMP",
        "ALTER TABLE qd_ai_copilot_messages ADD COLUMN IF NOT EXISTS actions_json TEXT",
        "ALTER TABLE qd_ai_copilot_messages ADD COLUMN IF NOT EXISTS report_json TEXT",
        "ALTER TABLE qd_ai_copilot_messages ADD COLUMN IF NOT EXISTS report_target_json TEXT",
        "ALTER TABLE qd_ai_copilot_messages ADD COLUMN IF NOT EXISTS report_error TEXT",
        "ALTER TABLE qd_ai_copilot_messages ADD COLUMN IF NOT EXISTS report_error_tone VARCHAR(32)",
        "ALTER TABLE qd_ai_copilot_messages ADD COLUMN IF NOT EXISTS referenced_report_id INTEGER",
    ):
        try:
            cur.execute(ddl)
        except Exception:
            try:
                cur.execute(ddl.replace(" IF NOT EXISTS", ""))
            except Exception:
                pass
    for ddl in (
        "CREATE INDEX IF NOT EXISTS idx_qd_ai_copilot_sessions_user ON qd_ai_copilot_sessions(user_id, updated_at)",
        "CREATE INDEX IF NOT EXISTS idx_qd_ai_copilot_messages_session ON qd_ai_copilot_messages(session_id, id)",
        "CREATE INDEX IF NOT EXISTS idx_qd_ai_user_memories_user ON qd_ai_user_memories(user_id, is_active, updated_at)",
        "CREATE INDEX IF NOT EXISTS idx_qd_ai_saved_prompts_user ON qd_ai_saved_prompts(user_id, updated_at)",
        "CREATE INDEX IF NOT EXISTS idx_qd_ai_copilot_events_user ON qd_ai_copilot_events(user_id, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_qd_ai_copilot_events_task ON qd_ai_copilot_events(user_id, task_key, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_qd_ai_copilot_requests_session ON qd_ai_copilot_requests(user_id, session_id, created_at)",
    ):
        try:
            cur.execute(ddl)
        except Exception:
            pass


def title_from_message(message: str) -> str:
    title = re.sub(r"\s+", " ", (message or "").strip())
    return title[:60] if title else "New Copilot Chat"


def get_session(cur, user_id: int, session_id: int | None) -> dict | None:
    if not session_id:
        return None
    cur.execute(
        "SELECT * FROM qd_ai_copilot_sessions WHERE id = ? AND user_id = ?",
        (session_id, user_id),
    )
    row = cur.fetchone()
    return row_to_dict(row) if row else None


def create_session(cur, user_id: int, title: str, context: dict) -> int:
    context_symbol = str((context or {}).get("symbol") or "")[:64]
    context_market = str((context or {}).get("market") or "")[:32]
    context_strategy_id = (context or {}).get("strategy_id")
    cur.execute(
        """
        INSERT INTO qd_ai_copilot_sessions
        (user_id, title, context_symbol, context_market, context_strategy_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, NOW(), NOW())
        RETURNING id
        """,
        (user_id, title, context_symbol, context_market, context_strategy_id),
    )
    row = cur.fetchone()
    return int(row["id"] if isinstance(row, dict) else row[0])


def insert_message(
    cur,
    *,
    session_id: int,
    user_id: int,
    role: str,
    content: str,
    attachments: list[dict] | None = None,
    actions: list[dict] | None = None,
    report: dict | None = None,
    report_target: dict | None = None,
    report_error: str | None = None,
    report_error_tone: str | None = None,
    referenced_report_id: int | None = None,
    intent: str | None = None,
) -> int:
    cur.execute(
        """
        INSERT INTO qd_ai_copilot_messages
        (session_id, user_id, role, content, attachments_json, actions_json,
         report_json, report_target_json, report_error, report_error_tone,
         referenced_report_id, intent, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        RETURNING id
        """,
        (
            session_id,
            user_id,
            role,
            content or "",
            json_dumps(attachments or []),
            json_dumps(actions or []),
            json_dumps(report) if report else None,
            json_dumps(report_target) if report_target else None,
            report_error,
            report_error_tone,
            referenced_report_id,
            intent,
        ),
    )
    row = cur.fetchone()
    return int(row["id"] if isinstance(row, dict) else row[0])


def load_recent_messages(cur, session_id: int, limit: int = 12) -> list[dict]:
    cur.execute(
        """
        SELECT id, role, content, attachments_json, actions_json, report_json,
               report_target_json, report_error, report_error_tone,
               referenced_report_id, intent, created_at
        FROM qd_ai_copilot_messages
        WHERE session_id = ?
        ORDER BY id DESC
        LIMIT ?
        """,
        (session_id, int(limit)),
    )
    rows = [row_to_dict(r) for r in (cur.fetchall() or [])]
    return list(reversed(rows))


def get_session_summary(cur, user_id: int, session_id: int) -> dict:
    cur.execute(
        """
        SELECT summary_json, summary_until_message_id, summary_version, summary_updated_at
        FROM qd_ai_copilot_sessions
        WHERE id = ? AND user_id = ?
        """,
        (int(session_id), int(user_id)),
    )
    row = row_to_dict(cur.fetchone())
    return {
        "summary": json_loads(row.get("summary_json"), {}) or {},
        "until_message_id": int(row.get("summary_until_message_id") or 0),
        "version": int(row.get("summary_version") or 0),
        "updated_at": row.get("summary_updated_at"),
    }


def update_session_summary(
    cur,
    *,
    user_id: int,
    session_id: int,
    summary: dict,
    until_message_id: int,
) -> int:
    cur.execute(
        """
        UPDATE qd_ai_copilot_sessions
        SET summary_json = ?, summary_until_message_id = ?,
            summary_version = COALESCE(summary_version, 0) + 1,
            summary_updated_at = NOW(), updated_at = NOW()
        WHERE id = ? AND user_id = ?
        """,
        (json_dumps(summary or {}), int(until_message_id or 0), int(session_id), int(user_id)),
    )
    cur.execute(
        "SELECT summary_version FROM qd_ai_copilot_sessions WHERE id = ? AND user_id = ?",
        (int(session_id), int(user_id)),
    )
    row = row_to_dict(cur.fetchone())
    return int(row.get("summary_version") or 0)


def clear_session_summary(cur, user_id: int, session_id: int) -> bool:
    cur.execute(
        """
        UPDATE qd_ai_copilot_sessions
        SET summary_json = NULL, summary_until_message_id = NULL,
            summary_version = COALESCE(summary_version, 0) + 1,
            summary_updated_at = NOW(), updated_at = NOW()
        WHERE id = ? AND user_id = ?
        """,
        (int(session_id), int(user_id)),
    )
    return int(getattr(cur, "rowcount", 0) or 0) > 0


def get_report_message(cur, user_id: int, session_id: int, message_id: int) -> dict | None:
    cur.execute(
        """
        SELECT id, session_id, user_id, report_json, report_target_json, created_at
        FROM qd_ai_copilot_messages
        WHERE id = ? AND session_id = ? AND user_id = ? AND report_json IS NOT NULL
        """,
        (int(message_id), int(session_id), int(user_id)),
    )
    row = row_to_dict(cur.fetchone())
    if not row:
        return None
    row["report"] = json_loads(row.get("report_json"), {}) or {}
    row["report_target"] = json_loads(row.get("report_target_json"), {}) or {}
    return row


def insert_request_usage(cur, **values: Any) -> int:
    cur.execute(
        """
        INSERT INTO qd_ai_copilot_requests
        (user_id, session_id, message_id, input_chars, estimated_input_tokens,
         estimated_output_tokens, history_message_count, summary_version,
         memory_count, report_message_id, context_truncated, finish_reason,
         created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        RETURNING id
        """,
        (
            int(values.get("user_id") or 0),
            int(values.get("session_id") or 0),
            values.get("message_id"),
            int(values.get("input_chars") or 0),
            int(values.get("estimated_input_tokens") or 0),
            int(values.get("estimated_output_tokens") or 0),
            int(values.get("history_message_count") or 0),
            int(values.get("summary_version") or 0),
            int(values.get("memory_count") or 0),
            values.get("report_message_id"),
            bool(values.get("context_truncated")),
            str(values.get("finish_reason") or "accepted")[:32],
        ),
    )
    row = cur.fetchone()
    return int(row["id"] if isinstance(row, dict) else row[0])


def update_request_usage(cur, request_id: int, **values: Any) -> None:
    cur.execute(
        """
        UPDATE qd_ai_copilot_requests
        SET estimated_output_tokens = ?, finish_reason = ?, updated_at = NOW()
        WHERE id = ?
        """,
        (
            int(values.get("estimated_output_tokens") or 0),
            str(values.get("finish_reason") or "stop")[:32],
            int(request_id),
        ),
    )
