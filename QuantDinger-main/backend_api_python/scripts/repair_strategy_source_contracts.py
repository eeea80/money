"""Rebuild stored strategy-source metadata with the current compiler."""

from __future__ import annotations

import argparse
import json
from typing import Any

from app.services.strategy_v2 import canonical_source_metadata
from app.utils.db import get_db_connection


def _metadata(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str) and value.strip():
        parsed = json.loads(value)
        return dict(parsed) if isinstance(parsed, dict) else {}
    return {}


def repair(*, user_id: int | None = None, dry_run: bool = False) -> dict[str, int]:
    query = "SELECT id, user_id, code, asset_type, metadata FROM qd_script_sources"
    params: tuple[Any, ...] = ()
    if user_id is not None:
        query += " WHERE user_id = ?"
        params = (int(user_id),)
    query += " ORDER BY id"

    counts = {"scanned": 0, "updated": 0, "unchanged": 0, "invalid": 0}
    with get_db_connection() as db:
        cur = db.cursor()
        cur.execute(query, params)
        rows = cur.fetchall() or []
        for row in rows:
            counts["scanned"] += 1
            try:
                metadata, manifest = canonical_source_metadata(
                    str(row.get("code") or ""),
                    _metadata(row.get("metadata")),
                )
            except ValueError:
                counts["invalid"] += 1
                continue
            asset_type = "portfolio_strategy" if manifest.get("strategyType") == "portfolio" else "script"
            if metadata == _metadata(row.get("metadata")) and asset_type == str(row.get("asset_type") or ""):
                counts["unchanged"] += 1
                continue
            counts["updated"] += 1
            if dry_run:
                continue
            cur.execute(
                "UPDATE qd_script_sources SET metadata = ?::jsonb, asset_type = ? WHERE id = ?",
                (json.dumps(metadata, ensure_ascii=False), asset_type, int(row["id"])),
            )
        if dry_run:
            db.rollback()
        else:
            db.commit()
        cur.close()
    return counts


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--user-id", type=int)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    print(json.dumps(repair(user_id=args.user_id, dry_run=args.dry_run), sort_keys=True))


if __name__ == "__main__":
    main()
