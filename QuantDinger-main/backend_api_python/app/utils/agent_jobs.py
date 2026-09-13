"""
In-process async job runner for the Agent Gateway.

Backtests are CPU/IO heavy;
HTTP clients (especially LLM-driven agents) prefer "submit + poll" semantics.
We persist every job in `qd_agent_jobs` so the API survives worker restarts
and so audit can correlate jobs with the agent that triggered them.

Production deployments dispatch supported jobs to Celery. Local development
and tests retain a bounded thread-pool fallback when Celery is disabled.

Progress streaming
------------------
Runners may accept a second positional argument `on_progress(dict)`. Each
call merges into a per-job event ring (kept in-process for low latency) and
also persists the latest snapshot in the `progress` JSONB column so a fresh
SSE client can replay where it left off.
"""
from __future__ import annotations

import inspect
import json
import os
import threading
import time
import traceback
import uuid
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Any, Callable, Iterator, Optional

from app.utils.db import get_db_connection
from app.utils.logger import get_logger
from app.services.billing_service import BillingError, get_billing_service

logger = get_logger(__name__)


# Per-job in-process event buffer (monotonic seq → event dict).
# We only keep the most recent N events to bound memory.
_PROGRESS_RING_SIZE = 200
_progress_buffers: dict[str, deque] = {}
_progress_locks: dict[str, threading.Lock] = {}
_progress_signals: dict[str, threading.Event] = {}
_progress_global_lock = threading.Lock()


def _max_workers() -> int:
    try:
        return max(1, int(os.getenv("AGENT_JOBS_MAX_WORKERS", "4")))
    except Exception:
        return 4


_executor: Optional[ThreadPoolExecutor] = None
_lock = threading.Lock()


def _get_executor() -> ThreadPoolExecutor:
    global _executor
    if _executor is not None:
        return _executor
    with _lock:
        if _executor is None:
            _executor = ThreadPoolExecutor(
                max_workers=_max_workers(),
                thread_name_prefix="agent-job",
            )
        return _executor


def _new_job_id() -> str:
    return uuid.uuid4().hex


def submit_job(
    *,
    user_id: int,
    agent_token_id: Optional[int],
    kind: str,
    request_payload: dict,
    runner: Callable[..., Any],
    idempotency_key: Optional[str] = None,
) -> dict:
    """Persist a job row and dispatch its runner on the thread pool.

    The runner may take either signature:
        ``runner(payload) -> result``                       (no streaming)
        ``runner(payload, on_progress) -> result``          (streaming)

    where ``on_progress(dict)`` is called by the runner to publish partial
    results.  Each call is delivered to live SSE subscribers AND persisted on
    the job row so reconnecting clients can replay the latest snapshot.
    """
    job_id = _new_job_id()
    created_at = datetime.utcnow()
    request_payload = dict(request_payload)
    with get_db_connection() as db:
        cur = db.cursor()
        if idempotency_key and agent_token_id:
            cur.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
                        (f"agent-job:{user_id}:{agent_token_id}:{kind}:{idempotency_key}",))
            cur.execute("""SELECT job_id, kind, status, request, created_at FROM qd_agent_jobs
                WHERE user_id = %s AND agent_token_id = %s AND kind = %s AND idempotency_key = %s
                ORDER BY id DESC LIMIT 1""", (user_id, agent_token_id, kind, idempotency_key))
            existing = cur.fetchone()
            if existing:
                saved = _request_dict(existing)
                saved.pop("__billing", None)
                if saved != request_payload:
                    raise BillingError("IDEMPOTENCY_CONFLICT", status=409)
                db.commit()
                cur.close()
                return _job_receipt(existing, duplicate=True)
        if kind == "backtest":
            request_payload["__billing"] = get_billing_service().consume_in_transaction(
                cur, int(user_id), "backtest", f"agent-backtest:{job_id}")
        cur.execute(
            """
            INSERT INTO qd_agent_jobs
              (job_id, user_id, agent_token_id, kind, status, request, idempotency_key, created_at)
            VALUES (%s, %s, %s, %s, 'queued', %s::jsonb, %s, %s)
            """,
            (
                job_id, int(user_id), agent_token_id, kind,
                json.dumps(request_payload, default=str),
                idempotency_key, created_at,
            ),
        )
        db.commit()
        cur.close()

    accepts_progress = _runner_accepts_progress(runner)

    def _run() -> None:
        if not _set_status(job_id, "running", started_at=datetime.utcnow()):
            return
        row = get_job_for_worker(job_id)
        if row and row.get("status") == "cancelled":
            return
        # Emit a synthetic "queued -> running" event so SSE clients see *something*
        # before the runner publishes its first real progress update.
        _publish_progress(job_id, {"phase": "running", "ts": time.time()})
        try:
            if accepts_progress:
                def _on_progress(snapshot: Any) -> None:
                    if not isinstance(snapshot, dict):
                        snapshot = {"value": snapshot}
                    _publish_progress(job_id, snapshot)
                result = runner(request_payload, _on_progress)
            else:
                result = runner(request_payload)
            if _set_result(job_id, result):
                _publish_progress(job_id, {"phase": "succeeded", "ts": time.time()}, terminal=True)
            else:
                _publish_terminal_state(job_id)
        except Exception as exc:
            tb = traceback.format_exc()
            logger.error(f"agent_job {job_id} kind={kind} failed: {exc}\n{tb}")
            if _set_failure(job_id, f"{exc}\n{tb[-2000:]}"):
                _publish_progress(
                    job_id,
                    {"phase": "failed", "error": str(exc)[:500], "ts": time.time()},
                    terminal=True,
                )
            else:
                _publish_terminal_state(job_id)

    celery_enabled = os.getenv("CELERY_TASKS_ENABLED", "false").strip().lower() in {
        "1", "true", "yes", "on",
    }
    try:
        if celery_enabled:
            from app.tasks.agent_jobs import execute_agent_job, supports_kind

            if supports_kind(kind):
                execute_agent_job.delay(job_id)
            else:
                logger.warning("No Celery runner registered for agent job kind=%s; using local executor", kind)
                _get_executor().submit(_run)
        else:
            _get_executor().submit(_run)
    except Exception:
        logger.exception("Agent job dispatch failed for %s", job_id)
        _set_failure(job_id, "AGENT_JOB_DISPATCH_FAILED")
        return _job_receipt(get_job_for_worker(job_id))

    return _job_receipt({"job_id": job_id, "status": "queued", "kind": kind,
                         "created_at": created_at.isoformat() + "Z", "request": request_payload})


def _request_dict(row: dict) -> dict:
    value = row.get("request") or {}
    return json.loads(value) if isinstance(value, str) else dict(value)


def _job_receipt(row: dict, *, duplicate: bool = False) -> dict:
    out = {key: row.get(key) for key in ("job_id", "status", "kind", "created_at")}
    billing = _request_dict(row).get("__billing")
    if billing is not None:
        out["billing"] = billing
    if duplicate:
        out["duplicate"] = True
    return out


def record_completed_job(
    *,
    user_id: int,
    agent_token_id: Optional[int],
    kind: str,
    request_payload: dict,
    result: Any,
    idempotency_key: Optional[str] = None,
) -> dict:
    """Persist a completed synchronous agent action for idempotent replay."""
    job_id = _new_job_id()
    now = datetime.utcnow()
    with get_db_connection() as db:
        cur = db.cursor()
        cur.execute(
            """
            INSERT INTO qd_agent_jobs
              (job_id, user_id, agent_token_id, kind, status, request, result,
               idempotency_key, created_at, started_at, finished_at)
            VALUES (%s, %s, %s, %s, 'succeeded', %s::jsonb, %s::jsonb, %s, %s, %s, %s)
            """,
            (
                job_id,
                int(user_id),
                agent_token_id,
                kind,
                json.dumps(request_payload, default=str),
                json.dumps(result, default=str),
                idempotency_key,
                now,
                now,
                now,
            ),
        )
        db.commit()
        cur.close()

    return {
        "job_id": job_id,
        "status": "succeeded",
        "kind": kind,
        "created_at": now.isoformat() + "Z",
    }


def _runner_accepts_progress(runner: Callable) -> bool:
    """True if `runner` declares a second positional parameter (on_progress)."""
    try:
        sig = inspect.signature(runner)
    except (TypeError, ValueError):
        return False
    params = [
        p for p in sig.parameters.values()
        if p.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD)
    ]
    return len(params) >= 2


# ──────────────────────────── progress / streaming ────────────────────────────

def _job_signal(job_id: str) -> threading.Event:
    with _progress_global_lock:
        ev = _progress_signals.get(job_id)
        if ev is None:
            ev = threading.Event()
            _progress_signals[job_id] = ev
        return ev


def _job_buffer(job_id: str) -> tuple[deque, threading.Lock]:
    with _progress_global_lock:
        buf = _progress_buffers.get(job_id)
        if buf is None:
            buf = deque(maxlen=_PROGRESS_RING_SIZE)
            _progress_buffers[job_id] = buf
            _progress_locks[job_id] = threading.Lock()
        return buf, _progress_locks[job_id]


def _publish_progress(job_id: str, event: dict, *, terminal: bool = False) -> None:
    """Record a progress event in-memory + persist latest snapshot to DB."""
    buf, lock = _job_buffer(job_id)
    seq = (buf[-1]["seq"] + 1) if buf else 1
    record = {"seq": seq, "ts": event.get("ts") or time.time(), "data": event, "terminal": terminal}
    with lock:
        buf.append(record)
    _job_signal(job_id).set()
    # Persist last snapshot so cold reconnects see something.
    try:
        with get_db_connection() as db:
            cur = db.cursor()
            cur.execute(
                """UPDATE qd_agent_jobs SET progress = %s::jsonb WHERE job_id = %s
                   AND (status IN ('queued', 'running') OR status = %s)""",
                (json.dumps(event, default=str), job_id, str(event.get("phase") or "") if terminal else ""),
            )
            db.commit()
            cur.close()
    except Exception as exc:
        logger.debug(f"agent_jobs: progress persist failed for {job_id}: {exc}")


def _publish_terminal_state(job_id: str) -> None:
    row = get_job_for_worker(job_id)
    if row and row.get("status") in {"succeeded", "failed", "cancelled"}:
        _publish_progress(job_id, {"phase": row["status"], "ts": time.time()}, terminal=True)


def stream_progress(job_id: str, *, since_seq: int = 0, idle_timeout_s: float = 60.0) -> Iterator[dict]:
    """Generator that yields progress events for a job until terminal.

    Yields dicts of shape `{seq, ts, data, terminal}`. Caller is responsible
    for serialization (e.g. into SSE frames).  Stops after a terminal event
    is delivered, or after `idle_timeout_s` seconds with no new events.
    """
    buf, lock = _job_buffer(job_id)
    last_seq = since_seq
    deadline = time.monotonic() + idle_timeout_s
    last_persisted = None

    while True:
        with lock:
            pending = [r for r in list(buf) if r["seq"] > last_seq]
        for rec in pending:
            yield rec
            last_seq = rec["seq"]
            last_persisted = json.dumps(rec.get("data") or {}, sort_keys=True, default=str)
            if rec.get("terminal"):
                _gc_job_state(job_id)
                return
            deadline = time.monotonic() + idle_timeout_s

        try:
            row = get_job_for_worker(job_id)
            snapshot = row.get("progress") if row else {}
            if isinstance(snapshot, str):
                snapshot = json.loads(snapshot)
            serialized = json.dumps(snapshot, sort_keys=True, default=str)
            terminal = bool(row) and str(row.get("status") or "") in {
                "succeeded", "failed", "cancelled",
            }
            if snapshot and serialized != last_persisted:
                last_seq += 1
                record = {
                    "seq": last_seq,
                    "ts": time.time(),
                    "data": snapshot,
                    "terminal": terminal,
                }
                yield record
                last_persisted = serialized
                deadline = time.monotonic() + idle_timeout_s
                if terminal:
                    _gc_job_state(job_id)
                    return
            elif terminal:
                last_seq += 1
                yield {
                    "seq": last_seq,
                    "ts": time.time(),
                    "data": {"phase": str(row.get("status") or "failed")},
                    "terminal": True,
                }
                _gc_job_state(job_id)
                return
        except Exception as exc:
            logger.debug("agent_jobs: persisted progress poll failed for %s: %s", job_id, exc)

        # Wait for the next signal or until the idle window expires.
        ev = _job_signal(job_id)
        wait_for = max(0.0, deadline - time.monotonic())
        if wait_for == 0.0:
            return
        ev.wait(timeout=min(wait_for, 1.0))
        ev.clear()


def _gc_job_state(job_id: str) -> None:
    with _progress_global_lock:
        _progress_buffers.pop(job_id, None)
        _progress_locks.pop(job_id, None)
        _progress_signals.pop(job_id, None)


def _set_status(job_id: str, status: str, *, started_at: Optional[datetime] = None) -> bool:
    with get_db_connection() as db:
        cur = db.cursor()
        guard = " AND status = 'queued'" if status == "running" else ""
        if started_at is not None:
            cur.execute(
                f"UPDATE qd_agent_jobs SET status = %s, started_at = %s WHERE job_id = %s{guard}",
                (status, started_at, job_id),
            )
        else:
            cur.execute(
                f"UPDATE qd_agent_jobs SET status = %s WHERE job_id = %s{guard}",
                (status, job_id),
            )
        db.commit()
        changed = cur.rowcount > 0
        cur.close()
    return changed


def _set_result(job_id: str, result: Any) -> bool:
    return _finish_job(job_id, "succeeded", result=result)


def _set_failure(job_id: str, error: str) -> bool:
    return _finish_job(job_id, "failed", error=error[:6000])


def _finish_job(job_id: str, status: str, *, result: Any = None,
                error: Optional[str] = None, user_id: Optional[int] = None) -> bool:
    """Commit the terminal state and any refund in one transaction."""
    with get_db_connection() as db:
        cur = db.cursor()
        cur.execute("SELECT user_id, status, request FROM qd_agent_jobs WHERE job_id = %s FOR UPDATE", (job_id,))
        row = cur.fetchone()
        if not row or (user_id is not None and int(row["user_id"]) != int(user_id)) or row["status"] not in {"queued", "running"}:
            db.commit()
            cur.close()
            return False
        payload = _request_dict(row)
        charge = payload.get("__billing")
        if charge is not None:
            if status != "succeeded":
                charge = get_billing_service().refund_in_transaction(cur, int(row["user_id"]), charge)
                payload["__billing"] = charge
            result = {**(result if isinstance(result, dict) else {}), "billing": charge}
        cur.execute("""UPDATE qd_agent_jobs SET status = %s, result = %s::jsonb,
            error = %s, request = %s::jsonb, progress = %s::jsonb,
            finished_at = NOW() WHERE job_id = %s""",
            (status, json.dumps(result, default=str), error, json.dumps(payload, default=str),
             json.dumps({"phase": status}), job_id))
        db.commit()
        cur.close()
    return True


def get_job(job_id: str, *, user_id: int) -> Optional[dict]:
    """Tenant-scoped job lookup."""
    with get_db_connection() as db:
        cur = db.cursor()
        cur.execute(
            """
            SELECT job_id, user_id, agent_token_id, kind, status, request,
                   result, error, progress, created_at, started_at, finished_at
            FROM qd_agent_jobs
            WHERE job_id = %s AND user_id = %s
            """,
            (job_id, int(user_id)),
        )
        row = cur.fetchone()
        cur.close()
    if row and "__billing" in _request_dict(row):
        row["billing"] = _request_dict(row)["__billing"]
    return row


def get_job_for_worker(job_id: str) -> Optional[dict]:
    """Internal unscoped lookup for a worker processing an already-authorized job."""
    with get_db_connection() as db:
        cur = db.cursor()
        try:
            cur.execute(
                """
                SELECT job_id, user_id, agent_token_id, kind, status, request,
                       result, error, progress, created_at, started_at, finished_at
                FROM qd_agent_jobs
                WHERE job_id = %s
                """,
                (job_id,),
            )
            return cur.fetchone()
        finally:
            cur.close()


def list_jobs(*, user_id: int, kind: Optional[str] = None, limit: int = 50) -> list[dict]:
    limit = max(1, min(int(limit or 50), 200))
    with get_db_connection() as db:
        cur = db.cursor()
        if kind:
            cur.execute(
                """
                SELECT job_id, kind, status, created_at, started_at, finished_at
                FROM qd_agent_jobs
                WHERE user_id = %s AND kind = %s
                ORDER BY id DESC LIMIT %s
                """,
                (int(user_id), kind, limit),
            )
        else:
            cur.execute(
                """
                SELECT job_id, kind, status, created_at, started_at, finished_at
                FROM qd_agent_jobs
                WHERE user_id = %s
                ORDER BY id DESC LIMIT %s
                """,
                (int(user_id), limit),
            )
        rows = cur.fetchall()
        cur.close()
    return rows or []


def count_active_jobs(*, user_id: int, agent_token_id: Optional[int] = None) -> int:
    with get_db_connection() as db:
        cur = db.cursor()
        if agent_token_id is None:
            cur.execute(
                """
                SELECT COUNT(*) AS count
                FROM qd_agent_jobs
                WHERE user_id = %s AND status IN ('queued', 'running')
                """,
                (int(user_id),),
            )
        else:
            cur.execute(
                """
                SELECT COUNT(*) AS count
                FROM qd_agent_jobs
                WHERE user_id = %s AND agent_token_id = %s
                  AND status IN ('queued', 'running')
                """,
                (int(user_id), int(agent_token_id)),
            )
        row = cur.fetchone() or {}
        cur.close()
    return int(row.get("count") or 0)


def cancel_job(job_id: str, *, user_id: int) -> Optional[dict]:
    """Request cancellation of a tenant-owned queued/running job.

    Thread and Celery runners may not be force-killed safely. The durable row is
    marked immediately, and result/failure writers refuse to overwrite it.
    """
    if _finish_job(job_id, "cancelled", user_id=user_id):
        _publish_progress(job_id, {"phase": "cancelled", "ts": time.time()}, terminal=True)
    return get_job(job_id, user_id=user_id)


def expire_billed_jobs(*, limit: int = 100) -> int:
    """Release credits for jobs orphaned by process death or lost dispatch."""
    timeout = max(300, int(os.getenv("AGENT_BILLED_JOB_TIMEOUT_SEC", "7200")))
    with get_db_connection() as db:
        cur = db.cursor()
        cur.execute("""SELECT job_id FROM qd_agent_jobs
            WHERE status IN ('queued', 'running') AND jsonb_exists(request, '__billing')
              AND created_at < NOW() - (%s * INTERVAL '1 second')
            ORDER BY created_at LIMIT %s""",
            (timeout, max(1, min(int(limit), 1000))))
        rows = cur.fetchall()
        cur.close()
    return sum(bool(_set_failure(row["job_id"], "AGENT_JOB_EXPIRED")) for row in rows)
