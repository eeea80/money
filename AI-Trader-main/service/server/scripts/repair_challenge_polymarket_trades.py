#!/usr/bin/env python3
"""Quarantine legacy Polymarket challenge trades that cannot be marked.

Polymarket challenge trades need an explicit outcome token to be valued against
the live CLOB. Legacy rows created before that guard may only contain a market
slug or even a non-Polymarket symbol, so they cannot be repaired safely.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SERVER_DIR = Path(__file__).resolve().parents[1]
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from database import begin_write_transaction, get_db_connection  # noqa: E402


BACKUP_DIR = SERVER_DIR / "data" / "repair_backups"
LEGACY_REASON = "legacy_polymarket_trade_missing_token"


def now_z() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def row_dict(row: Any) -> dict[str, Any]:
    return dict(row) if row is not None and not isinstance(row, dict) else (row or {})


def as_float(value: Any) -> float:
    try:
        parsed = float(value)
    except Exception:
        return 0.0
    return parsed if math.isfinite(parsed) else 0.0


def fetch_invalid_rows(cursor: Any, challenge_key: str | None, include_settled: bool) -> list[dict[str, Any]]:
    where = [
        "ct.market = 'polymarket'",
        """(
            ct.token_id IS NULL OR ct.token_id = ''
            OR ct.price <= 0 OR ct.price > 1
            OR ct.quantity <= 0
            OR LOWER(ct.side) NOT IN ('buy', 'sell')
        )""",
    ]
    params: list[Any] = []
    if challenge_key:
        where.append("c.challenge_key = ?")
        params.append(challenge_key)
    if not include_settled:
        where.append("c.status = 'active'")

    cursor.execute(
        f"""
        SELECT
            ct.*,
            c.challenge_key,
            c.status AS challenge_status,
            a.name AS agent_name
        FROM challenge_trades ct
        JOIN challenges c ON c.id = ct.challenge_id
        JOIN agents a ON a.id = ct.agent_id
        WHERE {' AND '.join(where)}
        ORDER BY c.challenge_key, ct.agent_id, ct.executed_at, ct.id
        """,
        params,
    )
    return [row_dict(row) for row in cursor.fetchall()]


def invalid_reason(row: dict[str, Any]) -> str:
    token_id = str(row.get("token_id") or "").strip()
    price = as_float(row.get("price"))
    quantity = as_float(row.get("quantity"))
    side = str(row.get("side") or "").strip().lower()
    if not token_id:
        return "missing_token_id"
    if price <= 0 or price > 1:
        return "invalid_price"
    if quantity <= 0:
        return "invalid_quantity"
    if side not in {"buy", "sell"}:
        return "invalid_side"
    return "invalid_polymarket_trade"


def write_backup(rows: list[dict[str, Any]], action: str, repaired_at: str) -> str | None:
    if not rows:
        return None
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    backup_path = BACKUP_DIR / f"polymarket_challenge_trades_{action}_{repaired_at.replace(':', '').replace('-', '')}.json"
    payload = {
        "created_at": repaired_at,
        "action": action,
        "row_count": len(rows),
        "rows": rows,
    }
    backup_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    return str(backup_path)


def refresh_participant_trade_counts(cursor: Any, rows: list[dict[str, Any]]) -> None:
    affected_pairs = {(int(row["challenge_id"]), int(row["agent_id"])) for row in rows}
    for challenge_id, agent_id in sorted(affected_pairs):
        cursor.execute(
            "SELECT COUNT(*) AS count FROM challenge_trades WHERE challenge_id = ? AND agent_id = ?",
            (challenge_id, agent_id),
        )
        count = int(cursor.fetchone()["count"])
        cursor.execute(
            """
            UPDATE challenge_participants
            SET trade_count = ?, ending_value = NULL, return_pct = NULL,
                max_drawdown = NULL, rank = NULL,
                status = CASE
                    WHEN status = 'disqualified' AND disqualified_reason = ? THEN 'active'
                    ELSE status
                END,
                disqualified_reason = CASE
                    WHEN disqualified_reason = ? THEN NULL
                    ELSE disqualified_reason
                END
            WHERE challenge_id = ? AND agent_id = ?
            """,
            (count, LEGACY_REASON, LEGACY_REASON, challenge_id, agent_id),
        )


def apply_delete(cursor: Any, rows: list[dict[str, Any]]) -> None:
    for row in rows:
        cursor.execute("DELETE FROM challenge_trades WHERE id = ?", (row["id"],))
    refresh_participant_trade_counts(cursor, rows)


def apply_disqualify(cursor: Any, rows: list[dict[str, Any]]) -> None:
    affected_pairs = {(int(row["challenge_id"]), int(row["agent_id"])) for row in rows}
    for challenge_id, agent_id in sorted(affected_pairs):
        cursor.execute(
            "SELECT COUNT(*) AS count FROM challenge_trades WHERE challenge_id = ? AND agent_id = ?",
            (challenge_id, agent_id),
        )
        count = int(cursor.fetchone()["count"])
        cursor.execute(
            """
            UPDATE challenge_participants
            SET status = 'disqualified', disqualified_reason = ?, trade_count = ?
            WHERE challenge_id = ? AND agent_id = ?
            """,
            (LEGACY_REASON, count, challenge_id, agent_id),
        )


def summarize(rows: list[dict[str, Any]], action: str, mode: str, backup_path: str | None = None) -> dict[str, Any]:
    reasons = Counter(invalid_reason(row) for row in rows)
    affected_agents = sorted(
        {
            f"{row.get('challenge_key')}:{row.get('agent_id')}:{row.get('agent_name')}"
            for row in rows
        }
    )
    return {
        "captured_at": now_z(),
        "mode": mode,
        "action": action,
        "invalid_trade_count": len(rows),
        "affected_participant_count": len(affected_agents),
        "reasons": dict(reasons),
        "backup_path": backup_path,
        "affected_participants": affected_agents,
        "trades": [
            {
                "id": row.get("id"),
                "challenge_key": row.get("challenge_key"),
                "agent_id": row.get("agent_id"),
                "agent_name": row.get("agent_name"),
                "symbol": row.get("symbol"),
                "token_id": row.get("token_id"),
                "outcome": row.get("outcome"),
                "side": row.get("side"),
                "price": row.get("price"),
                "quantity": row.get("quantity"),
                "reason": invalid_reason(row),
            }
            for row in rows
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--challenge-key")
    parser.add_argument("--include-settled", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--action", choices=["delete-trades", "disqualify"], default="delete-trades")
    args = parser.parse_args()

    repaired_at = now_z()
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        rows = fetch_invalid_rows(cursor, args.challenge_key, args.include_settled)
        if not args.apply:
            print(json.dumps(summarize(rows, args.action, "dry-run"), indent=2, ensure_ascii=False, default=str))
            return 0

        backup_path = write_backup(rows, args.action, repaired_at)
        begin_write_transaction(cursor)
        if args.action == "delete-trades":
            apply_delete(cursor, rows)
        else:
            apply_disqualify(cursor, rows)
        conn.commit()
        print(json.dumps(summarize(rows, args.action, "apply", backup_path), indent=2, ensure_ascii=False, default=str))
        return 0
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
