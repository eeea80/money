"""
Admin user statistics service.

Powers the dashboard widgets in the user-manage page (User Management tab):
  * Headline KPIs (total / today / week / month / active / VIP / disabled)
  * 30-day daily-new-users + cumulative line
  * 14-day daily active users (DAU)

All queries are pure read-only and parameterless, so we run them concurrently
inside a small thread pool — typical wall-clock on a 5k-user table is well
under a second.

The role distribution, recent signups, VIP-expiring list, and IP→country
breakdown that used to live here were removed per product feedback; the
endpoint is now strictly KPI + growth + activity to keep the admin landing
page fast and unambiguous.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List

from app.utils.db import get_db_connection
from app.utils.logger import get_logger

logger = get_logger(__name__)


# Dedicated tiny pool — we never run more than ~3 queries per request.
_executor = ThreadPoolExecutor(max_workers=3, thread_name_prefix="user-stats")


# ---------------------------------------------------------------------------
# SQL helpers
# ---------------------------------------------------------------------------

def _fetch_summary() -> Dict[str, Any]:
    """Headline numbers in a single round-trip.

    Postgres FILTER (WHERE ...) lets us bundle 10 conditional counts into one
    sequential scan of qd_users instead of 10 separate queries.
    """
    sql = """
        SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)
                AS today_new,
            COUNT(*) FILTER (
                WHERE created_at >= CURRENT_DATE - INTERVAL '1 day'
                  AND created_at <  CURRENT_DATE
            ) AS yesterday_new,
            COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '6 days')
                AS week_new,
            COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '29 days')
                AS month_new,
            COUNT(*) FILTER (WHERE last_login_at >= CURRENT_DATE)
                AS active_today,
            COUNT(*) FILTER (
                WHERE last_login_at >= CURRENT_DATE - INTERVAL '6 days'
            ) AS active_week,
            COUNT(*) FILTER (WHERE COALESCE(status, 'active') = 'disabled')
                AS disabled,
            COUNT(*) FILTER (WHERE vip_expires_at IS NOT NULL
                                  AND vip_expires_at > NOW())
                AS vip_total,
            COUNT(*) FILTER (WHERE vip_expires_at IS NOT NULL
                                  AND vip_expires_at > NOW()
                                  AND vip_expires_at <= NOW() + INTERVAL '7 days')
                AS vip_expiring_7d
        FROM qd_users
    """
    with get_db_connection() as db:
        cur = db.cursor()
        cur.execute(sql)
        row = cur.fetchone() or {}
        cur.close()
    return {k: int(v or 0) for k, v in row.items()}


def _fetch_growth(days: int = 30) -> List[Dict[str, Any]]:
    """Return a dense `days`-long series: [{date, new_users, cumulative}].

    `generate_series` guarantees the array always has exactly `days` entries
    even when nobody registered on a given day — the frontend chart code
    doesn't have to backfill zeros.
    """
    span = max(1, int(days)) - 1  # inclusive endpoints, so e.g. 30d -> 29 step
    sql = """
        WITH series AS (
            SELECT generate_series(
                CURRENT_DATE - (INTERVAL '1 day' * ?),
                CURRENT_DATE,
                INTERVAL '1 day'
            )::date AS d
        ),
        per_day AS (
            SELECT DATE(created_at) AS d, COUNT(*)::int AS n
            FROM qd_users
            WHERE created_at >= CURRENT_DATE - (INTERVAL '1 day' * ?)
            GROUP BY DATE(created_at)
        )
        SELECT
            TO_CHAR(s.d, 'YYYY-MM-DD') AS date,
            COALESCE(p.n, 0)           AS new_users
        FROM series s
        LEFT JOIN per_day p ON p.d = s.d
        ORDER BY s.d
    """
    with get_db_connection() as db:
        cur = db.cursor()
        cur.execute(sql, (span, span))
        rows = cur.fetchall() or []
        cur.close()

    # Pre-compute the running total starting from the user count *before* the
    # window so the cumulative line reflects real platform size, not just the
    # 30-day delta. Cheap enough to do server-side; saves a round-trip.
    base_sql = """
        SELECT COUNT(*)::int AS c
        FROM qd_users
        WHERE created_at < CURRENT_DATE - (INTERVAL '1 day' * ?)
    """
    with get_db_connection() as db:
        cur = db.cursor()
        cur.execute(base_sql, (span,))
        base_row = cur.fetchone() or {}
        cur.close()
    cumulative = int(base_row.get('c') or 0)

    out: List[Dict[str, Any]] = []
    for r in rows:
        n = int(r.get('new_users') or 0)
        cumulative += n
        out.append({
            'date': r.get('date'),
            'new_users': n,
            'cumulative': cumulative,
        })
    return out


def _fetch_active_trend(days: int = 14) -> List[Dict[str, Any]]:
    """Daily active users (DAU) for the last `days` days based on last_login_at.

    `last_login_at` is rewritten on every login so this is approximate — a
    user who logged in 3 days ago will only show up on the day-3 bucket, not
    earlier. Good enough for an admin "is the platform alive" glance.
    """
    span = max(1, int(days)) - 1
    sql = """
        WITH series AS (
            SELECT generate_series(
                CURRENT_DATE - (INTERVAL '1 day' * ?),
                CURRENT_DATE,
                INTERVAL '1 day'
            )::date AS d
        ),
        per_day AS (
            SELECT DATE(last_login_at) AS d, COUNT(*)::int AS n
            FROM qd_users
            WHERE last_login_at IS NOT NULL
              AND last_login_at >= CURRENT_DATE - (INTERVAL '1 day' * ?)
            GROUP BY DATE(last_login_at)
        )
        SELECT TO_CHAR(s.d, 'YYYY-MM-DD') AS date,
               COALESCE(p.n, 0)           AS active_users
        FROM series s
        LEFT JOIN per_day p ON p.d = s.d
        ORDER BY s.d
    """
    with get_db_connection() as db:
        cur = db.cursor()
        cur.execute(sql, (span, span))
        rows = cur.fetchall() or []
        cur.close()
    return [{
        'date': r.get('date'),
        'active_users': int(r.get('active_users') or 0)
    } for r in rows]


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def get_user_admin_stats() -> Dict[str, Any]:
    """Aggregate every widget the admin dashboard needs in one shot.

    Each section runs independently; a single failure degrades to a safe
    empty value rather than failing the whole request.
    """
    futures = {
        'summary':  _executor.submit(_fetch_summary),
        'growth':   _executor.submit(_fetch_growth, 30),
        'activity': _executor.submit(_fetch_active_trend, 14),
    }

    def _safe(name: str, default):
        try:
            return futures[name].result()
        except Exception as e:
            logger.warning(f"user-stats section '{name}' failed: {e}")
            return default

    return {
        'summary':  _safe('summary', {}),
        'growth':   _safe('growth', []),
        'activity': _safe('activity', []),
    }
