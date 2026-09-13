"""Prometheus metrics shared by the API process."""

from __future__ import annotations

import os
from pathlib import Path

from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
    multiprocess,
)

from app._version import APP_VERSION
from app.runtime.roles import current_process_role
from app.utils.db import get_db_connection


_multiprocess_dir = os.getenv("PROMETHEUS_MULTIPROC_DIR", "").strip()
if _multiprocess_dir:
    Path(_multiprocess_dir).mkdir(parents=True, exist_ok=True)


HTTP_REQUESTS = Counter(
    "quantdinger_http_requests_total",
    "HTTP requests processed by the API.",
    ("method", "route", "status"),
)
HTTP_DURATION = Histogram(
    "quantdinger_http_request_duration_seconds",
    "HTTP request duration in seconds.",
    ("method", "route"),
    buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60),
)
HTTP_IN_PROGRESS = Gauge(
    "quantdinger_http_requests_in_progress",
    "HTTP requests currently being processed.",
    ("method",),
    multiprocess_mode="livesum",
)
WORKER_HEALTHY = Gauge(
    "quantdinger_workers_healthy",
    "Workers with a fresh heartbeat.",
    ("role",),
    multiprocess_mode="max",
)
WORKER_STALE = Gauge(
    "quantdinger_workers_stale",
    "Workers whose heartbeat is stale.",
    ("role",),
    multiprocess_mode="max",
)
STRATEGY_COMMANDS = Gauge(
    "quantdinger_strategy_commands",
    "Durable strategy commands by status.",
    ("status",),
    multiprocess_mode="max",
)
BUILD_INFO = Gauge(
    "quantdinger_build_info",
    "QuantDinger build and process information.",
    ("version", "role"),
    multiprocess_mode="max",
)
BUILD_INFO.labels(version=APP_VERSION, role=current_process_role().value).set(1)


def _refresh_runtime_metrics() -> None:
    worker_roles = {"trading", "scheduler", "celery"}
    command_statuses = {"pending", "claimed", "succeeded", "failed"}
    worker_counts: dict[str, tuple[int, int]] = {}
    command_counts: dict[str, int] = {}
    try:
        with get_db_connection() as db:
            cur = db.cursor()
            try:
                cur.execute(
                    """
                    SELECT role,
                           COUNT(*) FILTER (
                               WHERE status = 'running'
                                 AND heartbeat_at >= NOW() - INTERVAL '45 seconds'
                           ) AS healthy,
                           COUNT(*) FILTER (
                               WHERE heartbeat_at < NOW() - INTERVAL '45 seconds'
                           ) AS stale
                    FROM qd_worker_heartbeats
                    GROUP BY role
                    """
                )
                for row in cur.fetchall() or []:
                    role = str(row.get("role") or "unknown")
                    worker_roles.add(role)
                    worker_counts[role] = (
                        int(row.get("healthy") or 0),
                        int(row.get("stale") or 0),
                    )

                cur.execute(
                    """
                    SELECT status, COUNT(*) AS count
                    FROM qd_strategy_commands
                    WHERE created_at >= NOW() - INTERVAL '24 hours'
                    GROUP BY status
                    """
                )
                for row in cur.fetchall() or []:
                    status = str(row.get("status") or "unknown")
                    command_statuses.add(status)
                    command_counts[status] = int(row.get("count") or 0)
            finally:
                cur.close()
    except Exception:
        return

    for role in worker_roles:
        healthy, stale = worker_counts.get(role, (0, 0))
        WORKER_HEALTHY.labels(role=role).set(healthy)
        WORKER_STALE.labels(role=role).set(stale)
    for status in command_statuses:
        STRATEGY_COMMANDS.labels(status=status).set(command_counts.get(status, 0))


def render_metrics() -> tuple[bytes, str]:
    _refresh_runtime_metrics()
    multiprocess_dir = os.getenv("PROMETHEUS_MULTIPROC_DIR", "").strip()
    if multiprocess_dir:
        registry = CollectorRegistry()
        multiprocess.MultiProcessCollector(registry)
        return generate_latest(registry), CONTENT_TYPE_LATEST
    return generate_latest(), CONTENT_TYPE_LATEST
