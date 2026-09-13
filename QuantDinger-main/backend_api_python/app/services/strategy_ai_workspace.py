"""Bounded AI authoring memory for saved Strategy API V2 sources.

CTA and portfolio sources use separate threads even when their numeric ids
match another asset type. Generated code is stored as a candidate and never
mutates ``qd_script_sources`` until the user explicitly applies and saves it.
"""
from __future__ import annotations

import json
import re
from typing import Any

from app.services.ai_copilot_context import merge_session_summary
from app.services.indicator_ai_workspace import (
    RECENT_MESSAGE_LIMIT,
    WORKSPACE_MESSAGE_LIMIT,
    _json_dumps,
    _json_loads,
    _latest_candidate,
    _load_messages,
    _row,
    classify_indicator_ai_intent,
    code_hash,
    ensure_tables,
)
from app.utils.db import get_db_connection


SUPPORTED_ASSET_TYPES = {"script", "portfolio_strategy"}


def normalize_asset_type(value: Any) -> str:
    normalized = str(value or "script").strip().lower()
    if normalized in {"portfolio", "cross_section", "cross-section"}:
        normalized = "portfolio_strategy"
    if normalized not in SUPPORTED_ASSET_TYPES:
        raise ValueError("strategy.invalidAssetType")
    return normalized


def classify_strategy_ai_intent(prompt: str, requested_mode: str = "auto") -> str:
    return classify_indicator_ai_intent(prompt, requested_mode)


def _metadata_dict(value: Any) -> dict:
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def _owned_source(cur, user_id: int, source_id: int, asset_type: str | None = None) -> dict:
    cur.execute(
        """
        SELECT id, user_id, name, description, code, asset_type, metadata
        FROM qd_script_sources
        WHERE id = ? AND user_id = ?
        """,
        (int(source_id), int(user_id)),
    )
    source = _row(cur.fetchone())
    if not source:
        raise LookupError("strategy_source_not_found")
    actual_type = normalize_asset_type(source.get("asset_type"))
    if asset_type and actual_type != normalize_asset_type(asset_type):
        raise ValueError("strategy_source_asset_type_mismatch")
    source["asset_type"] = actual_type
    source["metadata"] = _metadata_dict(source.get("metadata"))
    if bool(source["metadata"].get("code_hidden") or source["metadata"].get("hide_code")):
        raise PermissionError("strategy_source_hidden")
    return source


def _get_or_create_thread(cur, user_id: int, source: dict) -> dict:
    asset_type = normalize_asset_type(source.get("asset_type"))
    source_id = int(source["id"])
    cur.execute(
        """
        SELECT * FROM qd_ai_workspace_threads
        WHERE user_id = ? AND asset_type = ? AND asset_id = ?
        """,
        (int(user_id), asset_type, source_id),
    )
    thread = _row(cur.fetchone())
    title = str(source.get("name") or "")[:255]
    if thread:
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
        (int(user_id), asset_type, source_id, title),
    )
    return _row(cur.fetchone())


def get_strategy_ai_workspace(user_id: int, source_id: int, asset_type: str | None = None) -> dict:
    with get_db_connection() as db:
        cur = db.cursor()
        ensure_tables(cur)
        source = _owned_source(cur, user_id, source_id, asset_type)
        thread = _get_or_create_thread(cur, user_id, source)
        messages = _load_messages(cur, int(thread["id"]), WORKSPACE_MESSAGE_LIMIT)
        candidate = _latest_candidate(cur, int(thread["id"]))
        if candidate:
            candidate["base_code_matches_current"] = (
                str(candidate.get("base_code_hash") or "") == code_hash(source.get("code"))
            )
        summary = _json_loads(thread.get("summary_json"), {}) or {}
        db.commit()
        cur.close()
    return {
        "thread": {
            "id": int(thread["id"]),
            "asset_type": source["asset_type"],
            "asset_id": int(source_id),
            "title": thread.get("title") or source.get("name") or "",
            "summary": summary,
            "summary_version": int(thread.get("summary_version") or 0),
            "updated_at": thread.get("updated_at"),
        },
        "messages": messages,
        "candidate": candidate,
    }


def begin_strategy_ai_turn(
    user_id: int,
    source_id: int,
    prompt: str,
    *,
    asset_type: str | None = None,
    intent: str = "modify",
) -> dict:
    clean_prompt = re.sub(r"\s+", " ", str(prompt or "").strip())[:4000]
    clean_intent = "discussion" if str(intent or "").lower() == "discussion" else "modify"
    with get_db_connection() as db:
        cur = db.cursor()
        ensure_tables(cur)
        source = _owned_source(cur, user_id, source_id, asset_type)
        thread = _get_or_create_thread(cur, user_id, source)
        recent = _load_messages(cur, int(thread["id"]), RECENT_MESSAGE_LIMIT)
        previous_summary = _json_loads(thread.get("summary_json"), {}) or {}
        summary = merge_session_summary(
            previous_summary,
            recent,
            clean_prompt,
            {"intent": f"{source['asset_type']}_{clean_intent}"},
        )
        summary["strategy_source"] = {
            "id": int(source_id),
            "asset_type": source["asset_type"],
            "name": str(source.get("name") or "")[:255],
            "description": str(source.get("description") or "")[:500],
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
        user_message_id = int((_row(cur.fetchone())).get("id") or 0)
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
        "source": source,
        "intent": clean_intent,
    }


def complete_strategy_discussion_turn(*, user_id: int, workspace: dict, answer: str) -> dict:
    thread_id = int(workspace["thread_id"])
    source = workspace["source"]
    clean_answer = str(answer or "").strip()[:24000]
    metadata = {"intent": "discussion", "creates_candidate": False}
    with get_db_connection() as db:
        cur = db.cursor()
        ensure_tables(cur)
        _owned_source(cur, user_id, int(source["id"]), source["asset_type"])
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


def complete_strategy_candidate_turn(
    *,
    user_id: int,
    workspace: dict,
    prompt: str,
    base_code: str,
    candidate_code: str,
    validation: dict,
    assistant_text: str,
    assistant_message_key: str = "",
) -> dict:
    thread_id = int(workspace["thread_id"])
    source = workspace["source"]
    asset_type = normalize_asset_type(source["asset_type"])
    summary = {
        "request": str(prompt or "")[:1000],
        "validation_success": bool(validation.get("success")),
        "strategy_type": str((validation.get("manifest") or {}).get("strategyType") or ""),
    }
    if assistant_message_key:
        summary["message_key"] = str(assistant_message_key)[:120]
    with get_db_connection() as db:
        cur = db.cursor()
        ensure_tables(cur)
        _owned_source(cur, user_id, int(source["id"]), asset_type)
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
                asset_type,
                int(source["id"]),
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
            "message_key": summary.get("message_key") or "",
            "message_type": "candidate",
            "change_id": change_id,
            "metadata": summary,
            "created_at": assistant_row.get("created_at"),
        },
        "base_code_hash": code_hash(base_code),
        "validation": validation,
        "summary": summary,
    }


def set_strategy_ai_change_status(user_id: int, change_id: int, status: str) -> dict:
    if status not in {"applied", "discarded"}:
        raise ValueError("invalid_change_status")
    with get_db_connection() as db:
        cur = db.cursor()
        ensure_tables(cur)
        cur.execute(
            """
            SELECT c.id, c.asset_id, c.asset_type, c.status
            FROM qd_ai_workspace_changes c
            JOIN qd_ai_workspace_threads t ON t.id = c.thread_id
            WHERE c.id = ? AND c.user_id = ? AND t.user_id = ?
              AND c.asset_type IN ('script', 'portfolio_strategy')
            """,
            (int(change_id), int(user_id), int(user_id)),
        )
        change = _row(cur.fetchone())
        if not change:
            raise LookupError("change_not_found")
        if str(change.get("status") or "") != "candidate":
            raise ValueError("change_is_not_pending")
        _owned_source(cur, user_id, int(change["asset_id"]), str(change["asset_type"]))
        cur.execute(
            "UPDATE qd_ai_workspace_changes SET status = ?, updated_at = NOW() WHERE id = ?",
            (status, int(change_id)),
        )
        db.commit()
        cur.close()
    return {"id": int(change_id), "status": status}


def clear_strategy_ai_workspace(user_id: int, source_id: int, asset_type: str | None = None) -> dict:
    with get_db_connection() as db:
        cur = db.cursor()
        ensure_tables(cur)
        source = _owned_source(cur, user_id, source_id, asset_type)
        thread = _get_or_create_thread(cur, user_id, source)
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
    return {"thread_id": int(thread["id"]), "asset_id": int(source_id), "asset_type": source["asset_type"]}
