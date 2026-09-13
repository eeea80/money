from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.script_source import get_script_source_service
from app.services.strategy_runtime.robot_v2 import migrate_legacy_robot_v2_source
from app.services.strategy_v2 import compile_strategy_v2
from app.utils.db import get_db_connection


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    with get_db_connection() as db:
        cur = db.cursor()
        cur.execute(
            """
            SELECT id, user_id, template_key
            FROM qd_script_sources
            WHERE template_key LIKE 'robot_v2_%'
            ORDER BY id
            """
        )
        rows = [dict(row) for row in (cur.fetchall() or [])]
        cur.close()

    service = get_script_source_service()
    changed = 0
    for row in rows:
        source = service.get_source(int(row["id"]), user_id=int(row["user_id"]))
        if not source:
            continue
        kind = str(row["template_key"] or "").removeprefix("robot_v2_")
        code = str(source.get("code") or "")
        migrated = migrate_legacy_robot_v2_source(code, kind)
        if migrated == code:
            continue
        compile_strategy_v2(migrated)
        changed += 1
        print(f"source={row['id']} user={row['user_id']} template={row['template_key']}")
        if not args.apply:
            continue
        metadata = dict(source.get("metadata") or {})
        metadata["strategy_manifest"] = compile_strategy_v2(migrated).manifest.metadata()
        service.update_source(
            int(row["id"]),
            int(row["user_id"]),
            {"code": migrated, "metadata": metadata},
        )
    print(f"changed={changed} applied={bool(args.apply)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
