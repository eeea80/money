"""Persistent, bounded AI authoring context for one saved indicator.

The workspace stores conversation summaries and code candidates separately from
the canonical indicator/version tables.  A candidate never mutates the saved
indicator until the user explicitly applies it in the IDE and saves normally.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from app.services.ai_copilot_context import merge_session_summary
from app.utils.db import get_db_connection


ASSET_TYPE = "indicator"
RECENT_MESSAGE_LIMIT = 8
WORKSPACE_MESSAGE_LIMIT = 60


_MUTATION_RE = re.compile(
    r"(?:生成|创建|新增|添加|加入|删除|移除|替换|重构|修复|优化|调整|实现|改进|增强|"
    r"降低|提高|减少|增加|改成|修改|改一下|改(?:代码|源码|掉|吧|啊|呀)?|做一个|画出|标记|"
    r"generate|create|add|remove|delete|replace|refactor|fix|optimi[sz]e|"
    r"adjust|implement|improve|change|modify|update)",
    re.IGNORECASE,
)
_QUESTION_RE = re.compile(
    r"(?:解释|说明|讲解|分析|梳理|为什么|为何|怎么|如何|是什么|有什么|什么意思|"
    r"是否|能否|可以吗|会不会|原理|逻辑|区别|风险|问题|用途|作用|"
    r"explain|describe|why|how|what|whether|can\s+you|review|analy[sz]e|"
    r"\?|？|吗(?:\s|$))",
    re.IGNORECASE,
)
_EXPLICIT_CHANGE_RE = re.compile(
    r"(?:帮我|请(?:直接)?|把|将|需要你|替我|我让你|给我|"
    r"不要(?:再)?.{0,8}解释|按(?:上面|刚才).{0,8})(?:.{0,24})"
    r"(?:生成|创建|新增|添加|加入|删除|移除|替换|重构|修复|优化|调整|实现|改成|修改|"
    r"改(?:代码|源码|掉|吧|啊|呀)?|写入|应用|执行|"
    r"generate|create|add|remove|delete|replace|refactor|fix|optimi[sz]e|adjust|implement|change|modify|update)",
    re.IGNORECASE,
)
_DIRECT_CHANGE_RE = re.compile(
    r"^\s*(?:直接|现在就|马上)(?:.{0,12})"
    r"(?:改(?:代码|源码|掉|吧|啊|呀)?|修改|写入|应用|执行|change|modify|update)",
    re.IGNORECASE,
)


def classify_indicator_ai_intent(prompt: str, requested_mode: str = "auto") -> str:
    """Resolve an IDE turn to a safe discussion or an explicit code change.

    Ambiguous messages default to discussion so a question can never silently
    become a replacement-code candidate.  The client may explicitly tag its
    curated change prompts as ``modify``.
    """
    requested = str(requested_mode or "auto").strip().lower()
    if requested in {"discussion", "discuss", "question", "chat"}:
        return "discussion"
    if requested in {"modify", "change", "code", "candidate"}:
        return "modify"

    text = re.sub(r"\s+", " ", str(prompt or "").strip())
    if not text:
        return "discussion"
    if _EXPLICIT_CHANGE_RE.search(text) or _DIRECT_CHANGE_RE.search(text):
        return "modify"
    if _QUESTION_RE.search(text):
        return "discussion"
    if _MUTATION_RE.search(text):
        return "modify"
    return "discussion"


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)


def _json_loads(value: Any, default: Any) -> Any:
    if value in (None, ""):
        return default
    try:
        return json.loads(value)
    except Exception:
        return default


def _row(row: Any) -> dict:
    return dict(row or {})


def code_hash(code: str | None) -> str:
    return hashlib.sha256(str(code or "").encode("utf-8")).hexdigest()


def ensure_tables(cur) -> None:
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS qd_ai_workspace_threads (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            asset_type VARCHAR(32) NOT NULL,
            asset_id INTEGER NOT NULL,
            title VARCHAR(255) DEFAULT '',
            summary_json TEXT,
            summary_until_message_id INTEGER,
            summary_version INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            UNIQUE (user_id, asset_type, asset_id)
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS qd_ai_workspace_messages (
            id SERIAL PRIMARY KEY,
            thread_id INTEGER NOT NULL REFERENCES qd_ai_workspace_threads(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL,
            role VARCHAR(16) NOT NULL,
            content TEXT NOT NULL,
            message_type VARCHAR(32) DEFAULT 'chat',
            change_id INTEGER,
            metadata_json TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS qd_ai_workspace_changes (
            id SERIAL PRIMARY KEY,
            thread_id INTEGER NOT NULL REFERENCES qd_ai_workspace_threads(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL,
            asset_type VARCHAR(32) NOT NULL,
            asset_id INTEGER NOT NULL,
            base_code_hash VARCHAR(64) NOT NULL,
            candidate_code TEXT NOT NULL,
            change_summary_json TEXT,
            validation_json TEXT,
            status VARCHAR(24) DEFAULT 'candidate',
            applied_version_no INTEGER,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )
        """
    )
    for ddl in (
        "CREATE INDEX IF NOT EXISTS idx_qd_ai_workspace_threads_asset ON qd_ai_workspace_threads(user_id, asset_type, asset_id)",
        "CREATE INDEX IF NOT EXISTS idx_qd_ai_workspace_messages_thread ON qd_ai_workspace_messages(thread_id, id)",
        "CREATE INDEX IF NOT EXISTS idx_qd_ai_workspace_changes_thread ON qd_ai_workspace_changes(thread_id, id)",
    ):
        cur.execute(ddl)


def _owned_indicator(cur, user_id: int, indicator_id: int) -> dict:
    cur.execute(
        """
        SELECT id, user_id, name, description, code,
               COALESCE(is_buy, 0) AS is_buy,
               COALESCE(is_encrypted, 0) AS is_encrypted
        FROM qd_indicator_codes
        WHERE id = ? AND user_id = ?
        """,
        (int(indicator_id), int(user_id)),
    )
    indicator = _row(cur.fetchone())
    if not indicator:
        raise LookupError("indicator_not_found")
    if int(indicator.get("is_buy") or 0) == 1 and int(indicator.get("is_encrypted") or 0) == 1:
        raise PermissionError("indicator_source_hidden")
    return indicator


def _get_or_create_thread(cur, user_id: int, indicator: dict) -> dict:
    cur.execute(
        """
        SELECT * FROM qd_ai_workspace_threads
        WHERE user_id = ? AND asset_type = ? AND asset_id = ?
        """,
        (int(user_id), ASSET_TYPE, int(indicator["id"])),
    )
    thread = _row(cur.fetchone())
    if thread:
        title = str(indicator.get("name") or "")[:255]
        if title and title != str(thread.get("title") or ""):
            cur.execute(
                "UPDATE qd_ai_workspace_threads SET title = ?, updated_at = NOW() WHERE id = ?",
                (title, int(thread["id"])),
            )
            thread["title"] = title
        return thread

    cur.execute(
        """
        INSERT INTO qd_ai_workspace_threads
          (user_id, asset_type, asset_id, title, created_at, updated_at)
        VALUES (?, ?, ?, ?, NOW(), NOW())
        RETURNING *
        """,
        (int(user_id), ASSET_TYPE, int(indicator["id"]), str(indicator.get("name") or "")[:255]),
    )
    return _row(cur.fetchone())


def _load_messages(cur, thread_id: int, limit: int) -> list[dict]:
    cur.execute(
        """
        SELECT id, role, content, message_type, change_id, metadata_json, created_at
        FROM qd_ai_workspace_messages
        WHERE thread_id = ?
        ORDER BY id DESC
        LIMIT ?
        """,
        (int(thread_id), int(limit)),
    )
    messages = []
    for raw in reversed(cur.fetchall() or []):
        item = _row(raw)
        item["metadata"] = _json_loads(item.pop("metadata_json", None), {}) or {}
        messages.append(item)
    return messages


def _latest_candidate(cur, thread_id: int) -> dict | None:
    cur.execute(
        """
        SELECT id, base_code_hash, candidate_code, change_summary_json,
               validation_json, status, applied_version_no, created_at, updated_at
        FROM qd_ai_workspace_changes
        WHERE thread_id = ? AND status = 'candidate'
        ORDER BY id DESC
        LIMIT 1
        """,
        (int(thread_id),),
    )
    change = _row(cur.fetchone())
    if not change:
        return None
    change["summary"] = _json_loads(change.pop("change_summary_json", None), {}) or {}
    change["validation"] = _json_loads(change.pop("validation_json", None), {}) or {}
    return change


def get_workspace(user_id: int, indicator_id: int) -> dict:
    with get_db_connection() as db:
        cur = db.cursor()
        ensure_tables(cur)
        indicator = _owned_indicator(cur, user_id, indicator_id)
        thread = _get_or_create_thread(cur, user_id, indicator)
        messages = _load_messages(cur, int(thread["id"]), WORKSPACE_MESSAGE_LIMIT)
        candidate = _latest_candidate(cur, int(thread["id"]))
        if candidate:
            candidate["base_code_matches_current"] = (
                str(candidate.get("base_code_hash") or "") == code_hash(indicator.get("code"))
            )
        summary = _json_loads(thread.get("summary_json"), {}) or {}
        db.commit()
        cur.close()
    return {
        "thread": {
            "id": int(thread["id"]),
            "asset_type": ASSET_TYPE,
            "asset_id": int(indicator_id),
            "title": thread.get("title") or indicator.get("name") or "",
            "summary": summary,
            "summary_version": int(thread.get("summary_version") or 0),
            "updated_at": thread.get("updated_at"),
        },
        "messages": messages,
        "candidate": candidate,
    }


def begin_turn(user_id: int, indicator_id: int, prompt: str, intent: str = "modify") -> dict:
    clean_prompt = re.sub(r"\s+", " ", str(prompt or "").strip())[:4000]
    clean_intent = "discussion" if str(intent or "").lower() == "discussion" else "modify"
    with get_db_connection() as db:
        cur = db.cursor()
        ensure_tables(cur)
        indicator = _owned_indicator(cur, user_id, indicator_id)
        thread = _get_or_create_thread(cur, user_id, indicator)
        recent = _load_messages(cur, int(thread["id"]), RECENT_MESSAGE_LIMIT)
        previous_summary = _json_loads(thread.get("summary_json"), {}) or {}
        summary = merge_session_summary(
            previous_summary,
            recent,
            clean_prompt,
            {"intent": f"indicator_{clean_intent}"},
        )
        summary["indicator"] = {
            "id": int(indicator_id),
            "name": str(indicator.get("name") or "")[:255],
            "description": str(indicator.get("description") or "")[:500],
        }
        cur.execute(
            """
            INSERT INTO qd_ai_workspace_messages
              (thread_id, user_id, role, content, message_type, created_at)
            VALUES (?, ?, 'user', ?, ?, NOW())
            RETURNING id
            """,
            (
                int(thread["id"]),
                int(user_id),
                clean_prompt,
                "question" if clean_intent == "discussion" else "change_request",
            ),
        )
        message_row = _row(cur.fetchone())
        user_message_id = int(message_row.get("id") or 0)
        cur.execute(
            """
            UPDATE qd_ai_workspace_threads
            SET summary_json = ?, summary_until_message_id = ?,
                summary_version = COALESCE(summary_version, 0) + 1,
                updated_at = NOW()
            WHERE id = ?
            """,
            (_json_dumps(summary), user_message_id, int(thread["id"])),
        )
        db.commit()
        cur.close()
    return {
        "thread_id": int(thread["id"]),
        "user_message_id": user_message_id,
        "summary": summary,
        "recent_messages": recent,
        "indicator": indicator,
        "intent": clean_intent,
    }


def complete_discussion_turn(
    *,
    user_id: int,
    workspace: dict,
    answer: str,
) -> dict:
    """Persist an explanatory answer without creating or mutating code."""
    thread_id = int(workspace["thread_id"])
    indicator_id = int(workspace["indicator"]["id"])
    clean_answer = str(answer or "").strip()[:24000]
    metadata = {"intent": "discussion", "creates_candidate": False}
    with get_db_connection() as db:
        cur = db.cursor()
        ensure_tables(cur)
        _owned_indicator(cur, user_id, indicator_id)
        cur.execute(
            """
            INSERT INTO qd_ai_workspace_messages
              (thread_id, user_id, role, content, message_type, metadata_json, created_at)
            VALUES (?, ?, 'assistant', ?, 'discussion', ?, NOW())
            RETURNING id, created_at
            """,
            (thread_id, int(user_id), clean_answer, _json_dumps(metadata)),
        )
        assistant_row = _row(cur.fetchone())
        cur.execute("UPDATE qd_ai_workspace_threads SET updated_at = NOW() WHERE id = ?", (thread_id,))
        db.commit()
        cur.close()
    return {
        "reply_type": "discussion",
        "thread_id": thread_id,
        "assistant_message": {
            "id": int(assistant_row.get("id") or 0),
            "role": "assistant",
            "content": clean_answer,
            "message_type": "discussion",
            "metadata": metadata,
            "created_at": assistant_row.get("created_at"),
        },
    }


def complete_turn(
    *,
    user_id: int,
    workspace: dict,
    prompt: str,
    base_code: str,
    candidate_code: str,
    validation: dict | None,
    assistant_text: str,
) -> dict:
    thread_id = int(workspace["thread_id"])
    indicator_id = int(workspace["indicator"]["id"])
    validation = validation or {}
    summary = {
        "request": str(prompt or "")[:1000],
        "validation_success": bool(validation.get("success")),
        "hint_count": len(validation.get("hints") or []),
    }
    with get_db_connection() as db:
        cur = db.cursor()
        ensure_tables(cur)
        _owned_indicator(cur, user_id, indicator_id)
        cur.execute(
            "UPDATE qd_ai_workspace_changes SET status = 'superseded', updated_at = NOW() WHERE thread_id = ? AND status = 'candidate'",
            (thread_id,),
        )
        cur.execute(
            """
            INSERT INTO qd_ai_workspace_changes
              (thread_id, user_id, asset_type, asset_id, base_code_hash,
               candidate_code, change_summary_json, validation_json, status,
               created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'candidate', NOW(), NOW())
            RETURNING id, created_at
            """,
            (
                thread_id,
                int(user_id),
                ASSET_TYPE,
                indicator_id,
                code_hash(base_code),
                candidate_code,
                _json_dumps(summary),
                _json_dumps(validation),
            ),
        )
        change_row = _row(cur.fetchone())
        change_id = int(change_row.get("id") or 0)
        cur.execute(
            """
            INSERT INTO qd_ai_workspace_messages
              (thread_id, user_id, role, content, message_type, change_id, metadata_json, created_at)
            VALUES (?, ?, 'assistant', ?, 'candidate', ?, ?, NOW())
            RETURNING id, created_at
            """,
            (thread_id, int(user_id), assistant_text, change_id, _json_dumps(summary)),
        )
        assistant_row = _row(cur.fetchone())
        cur.execute("UPDATE qd_ai_workspace_threads SET updated_at = NOW() WHERE id = ?", (thread_id,))
        db.commit()
        cur.close()
    return {
        "reply_type": "candidate",
        "thread_id": thread_id,
        "change_id": change_id,
        "assistant_message": {
            "id": int(assistant_row.get("id") or 0),
            "role": "assistant",
            "content": assistant_text,
            "message_type": "candidate",
            "change_id": change_id,
            "metadata": summary,
            "created_at": assistant_row.get("created_at"),
        },
        "base_code_hash": code_hash(base_code),
        "validation": validation,
        "summary": summary,
    }


def set_change_status(user_id: int, change_id: int, status: str) -> dict:
    allowed = {"applied", "discarded"}
    if status not in allowed:
        raise ValueError("invalid_change_status")
    with get_db_connection() as db:
        cur = db.cursor()
        ensure_tables(cur)
        cur.execute(
            """
            SELECT c.id, c.asset_id, c.status
            FROM qd_ai_workspace_changes c
            JOIN qd_ai_workspace_threads t ON t.id = c.thread_id
            WHERE c.id = ? AND c.user_id = ? AND t.user_id = ?
            """,
            (int(change_id), int(user_id), int(user_id)),
        )
        change = _row(cur.fetchone())
        if not change:
            raise LookupError("change_not_found")
        if str(change.get("status") or "") != "candidate":
            raise ValueError("change_is_not_pending")
        _owned_indicator(cur, user_id, int(change["asset_id"]))
        cur.execute(
            "UPDATE qd_ai_workspace_changes SET status = ?, updated_at = NOW() WHERE id = ?",
            (status, int(change_id)),
        )
        db.commit()
        cur.close()
    return {"id": int(change_id), "status": status}


def clear_workspace(user_id: int, indicator_id: int) -> dict:
    with get_db_connection() as db:
        cur = db.cursor()
        ensure_tables(cur)
        indicator = _owned_indicator(cur, user_id, indicator_id)
        thread = _get_or_create_thread(cur, user_id, indicator)
        cur.execute("DELETE FROM qd_ai_workspace_messages WHERE thread_id = ? AND user_id = ?", (int(thread["id"]), int(user_id)))
        cur.execute("DELETE FROM qd_ai_workspace_changes WHERE thread_id = ? AND user_id = ?", (int(thread["id"]), int(user_id)))
        cur.execute(
            """
            UPDATE qd_ai_workspace_threads
            SET summary_json = NULL, summary_until_message_id = NULL,
                summary_version = COALESCE(summary_version, 0) + 1,
                updated_at = NOW()
            WHERE id = ? AND user_id = ?
            """,
            (int(thread["id"]), int(user_id)),
        )
        db.commit()
        cur.close()
    return {"thread_id": int(thread["id"]), "asset_id": int(indicator_id)}
