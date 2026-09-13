"""Capability-token sharing for immutable professional report snapshots."""
from __future__ import annotations

import hashlib
import json
import re
import secrets
from typing import Any


_TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{32,128}$")


def _token_hash(token: str) -> str:
    return hashlib.sha256(str(token).encode("utf-8")).hexdigest()


def _json_load(value: Any, default: Any = None) -> Any:
    if value in (None, ""):
        return default
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return default


def ensure_report_share_table(cur) -> None:
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS qd_professional_report_shares (
            id SERIAL PRIMARY KEY,
            token_hash VARCHAR(64) NOT NULL UNIQUE,
            owner_user_id INTEGER NOT NULL,
            source_message_id INTEGER NOT NULL,
            report_json TEXT NOT NULL,
            report_target_json TEXT,
            language VARCHAR(20) NOT NULL DEFAULT 'en-US',
            view_count BIGINT NOT NULL DEFAULT 0,
            last_viewed_at TIMESTAMP,
            revoked_at TIMESTAMP,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
        """
    )
    for ddl in (
        "CREATE INDEX IF NOT EXISTS idx_qd_report_shares_owner ON qd_professional_report_shares(owner_user_id, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_qd_report_shares_message ON qd_professional_report_shares(owner_user_id, source_message_id)",
    ):
        try:
            cur.execute(ddl)
        except Exception:
            pass


def create_report_share(cur, *, owner_user_id: int, source_message_id: int, language: str) -> dict:
    """Create an opaque capability URL for one report owned by the caller."""
    ensure_report_share_table(cur)
    cur.execute(
        """
        SELECT report_json, report_target_json
        FROM qd_ai_copilot_messages
        WHERE id = ? AND user_id = ? AND report_json IS NOT NULL
        """,
        (int(source_message_id), int(owner_user_id)),
    )
    row = cur.fetchone()
    row = dict(row or {})
    report = _json_load(row.get("report_json"), {})
    artifact = report.get("report") or report.get("professional_report") or report if isinstance(report, dict) else {}
    if not isinstance(artifact, dict) or artifact.get("schema_version") not in {"professional_report_v1", "1.0"}:
        raise LookupError("professional report not found")

    target = _json_load(row.get("report_target_json"), {}) or {}
    report_payload = json.dumps(report, ensure_ascii=False, separators=(",", ":"))
    target_payload = json.dumps(target, ensure_ascii=False, separators=(",", ":"))
    if len(report_payload.encode("utf-8")) > 5 * 1024 * 1024:
        raise ValueError("report snapshot is too large to share")

    token = secrets.token_urlsafe(32)
    cur.execute(
        """
        INSERT INTO qd_professional_report_shares
        (token_hash, owner_user_id, source_message_id, report_json,
         report_target_json, language, created_at)
        VALUES (?, ?, ?, ?, ?, ?, NOW())
        """,
        (
            _token_hash(token),
            int(owner_user_id),
            int(source_message_id),
            report_payload,
            target_payload,
            str(language or "en-US")[:20],
        ),
    )
    return {"token": token, "path": f"/report/share/{token}"}


def get_public_report_share(cur, token: str) -> dict | None:
    """Resolve an active capability token without exposing its owner or session."""
    token = str(token or "").strip()
    if not _TOKEN_PATTERN.fullmatch(token):
        return None
    ensure_report_share_table(cur)
    cur.execute(
        """
        SELECT id, report_json, report_target_json, language, created_at
        FROM qd_professional_report_shares
        WHERE token_hash = ? AND revoked_at IS NULL
        """,
        (_token_hash(token),),
    )
    row = dict(cur.fetchone() or {})
    if not row:
        return None
    cur.execute(
        """
        UPDATE qd_professional_report_shares
        SET view_count = view_count + 1, last_viewed_at = NOW()
        WHERE id = ?
        """,
        (int(row["id"]),),
    )
    return {
        "report": _json_load(row.get("report_json"), {}) or {},
        "target": _json_load(row.get("report_target_json"), {}) or {},
        "language": str(row.get("language") or "en-US"),
        "shared_at": row.get("created_at").isoformat() if hasattr(row.get("created_at"), "isoformat") else row.get("created_at"),
    }
