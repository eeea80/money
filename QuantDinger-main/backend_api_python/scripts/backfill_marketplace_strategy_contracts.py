"""Backfill publish-time contracts for existing marketplace strategies."""

from __future__ import annotations

import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.services.community_service import _contract_index_values
from app.services.strategy_marketplace_contract import derive_marketplace_contract
from app.utils.db import get_db_connection


def backfill() -> tuple[int, int]:
    updated = 0
    failed = 0
    with get_db_connection() as db:
        cur = db.cursor()
        cur.execute("""
            SELECT i.id, i.code, ss.param_schema
            FROM qd_indicator_codes i
            LEFT JOIN qd_script_sources ss ON ss.id = i.source_script_source_id
            WHERE COALESCE(i.asset_type, 'indicator') = 'script_template'
              AND i.publish_to_community = 1
              AND (i.marketplace_contract IS NULL OR COALESCE(i.marketplace_contract_version, 0) < 2)
            ORDER BY i.id ASC
        """)
        rows = [dict(row) for row in (cur.fetchall() or [])]
        for row in rows:
            try:
                schema = row.get("param_schema")
                if isinstance(schema, str):
                    schema = json.loads(schema or "{}")
                contract = derive_marketplace_contract(
                    str(row.get("code") or ""),
                    schema if isinstance(schema, dict) else {},
                    source="published_code_backfill",
                )
                values = _contract_index_values(contract)
                cur.execute("""
                    UPDATE qd_indicator_codes
                    SET marketplace_contract = ?::jsonb,
                        marketplace_contract_version = ?, marketplace_contract_hash = ?,
                        marketplace_binding_mode = ?, marketplace_strategy_type = ?, marketplace_direction_mode = ?,
                        marketplace_execution_mode = ?, marketplace_execution_frequency = ?,
                        marketplace_confirmation_frequencies = ?, marketplace_markets = ?, marketplace_market_types = ?,
                        updated_at = NOW()
                    WHERE id = ?
                """, (
                    values["contract_json"], values["contract_version"], values["contract_hash"],
                    values["binding_mode"], values["strategy_type"], values["direction_mode"],
                    values["execution_mode"], values["execution_frequency"],
                    values["confirmation_frequencies"], values["markets"], values["market_types"],
                    int(row["id"]),
                ))
                updated += 1
            except Exception as exc:
                failed += 1
                print(f"strategy contract backfill failed for {row.get('id')}: {exc}")
        db.commit()
        cur.close()
    return updated, failed


if __name__ == "__main__":
    ok, bad = backfill()
    print(f"marketplace strategy contracts: updated={ok}, failed={bad}")
