"""Container health check for durable backend workers."""

from __future__ import annotations

import argparse
import os
import sys

from app.utils.db import get_db_connection


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("role", choices=("trading", "scheduler", "celery"))
    parser.add_argument("--max-age", type=int, default=45)
    args = parser.parse_args()

    credential_key = str(os.getenv("CREDENTIAL_ENCRYPTION_KEY") or "").strip()
    session_key = str(os.getenv("SECRET_KEY") or "").strip()
    if args.role in {"trading", "scheduler"} and not credential_key:
        if (
            len(session_key.encode("utf-8")) < 10
            or session_key == "quantdinger-secret-key-change-me"
        ):
            sys.exit(1)

    with get_db_connection() as db:
        cur = db.cursor()
        try:
            cur.execute(
                """
                SELECT COUNT(*) AS count
                FROM qd_worker_heartbeats
                WHERE role = %s AND status = 'running'
                  AND heartbeat_at >= NOW() - (%s * INTERVAL '1 second')
                """,
                (args.role, max(1, int(args.max_age))),
            )
            row = cur.fetchone() or {}
        finally:
            cur.close()
    if int(row.get("count") or 0) < 1:
        sys.exit(1)


if __name__ == "__main__":
    main()
