"""PostgreSQL repository for durable strategy lifecycle commands and leases."""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from typing import Any

from app.utils.db import get_db_connection


TERMINAL_COMMAND_STATUSES = frozenset({"succeeded", "failed", "cancelled"})


@dataclass(frozen=True)
class StrategyCommand:
    id: int
    strategy_id: int
    user_id: int
    command_type: str
    status: str
    idempotency_key: str
    payload: dict[str, Any]
    result: dict[str, Any] | None = None
    attempts: int = 0
    error_message: str = ""

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> "StrategyCommand":
        payload = row.get("payload_json") or {}
        result = row.get("result_json") or {}
        if isinstance(payload, str):
            payload = json.loads(payload)
        if isinstance(result, str):
            result = json.loads(result)
        return cls(
            id=int(row["id"]),
            strategy_id=int(row["strategy_id"]),
            user_id=int(row.get("user_id") or 0),
            command_type=str(row["command_type"]),
            status=str(row["status"]),
            idempotency_key=str(row.get("idempotency_key") or ""),
            payload=dict(payload),
            result=dict(result),
            attempts=int(row.get("attempts") or 0),
            error_message=str(row.get("error_message") or ""),
        )


class StrategyCommandRepository:
    def enqueue(
        self,
        *,
        strategy_id: int,
        command_type: str,
        user_id: int = 0,
        payload: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
    ) -> StrategyCommand:
        command_type = command_type.strip().lower()
        if command_type not in {"start", "stop", "restart", "reconcile"}:
            raise ValueError(f"Unsupported strategy command: {command_type}")
        key = idempotency_key or uuid.uuid4().hex
        body = json.dumps(payload or {}, default=str)

        with get_db_connection() as db:
            cur = db.cursor()
            try:
                cur.execute("SELECT pg_advisory_xact_lock(%s, %s)", (7413, int(strategy_id)))
                cur.execute(
                    """
                    SELECT * FROM qd_strategy_commands
                    WHERE strategy_id = %s AND command_type = %s
                      AND status IN ('pending', 'processing')
                    ORDER BY id DESC
                    LIMIT 1
                    FOR UPDATE
                    """,
                    (int(strategy_id), command_type),
                )
                row = cur.fetchone()
                if row:
                    db.commit()
                    return StrategyCommand.from_row(dict(row))

                cur.execute(
                    """
                    INSERT INTO qd_strategy_commands
                        (strategy_id, user_id, command_type, idempotency_key, payload_json)
                    VALUES (%s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (idempotency_key) DO UPDATE
                        SET idempotency_key = EXCLUDED.idempotency_key
                    RETURNING *
                    """,
                    (int(strategy_id), int(user_id or 0), command_type, key, body),
                )
                row = cur.fetchone()
                db.commit()
                return StrategyCommand.from_row(dict(row))
            except Exception:
                db.rollback()
                raise
            finally:
                cur.close()

    def claim_next(self, *, owner_id: str, lease_seconds: int, max_attempts: int) -> StrategyCommand | None:
        with get_db_connection() as db:
            cur = db.cursor()
            try:
                cur.execute(
                    """
                    WITH candidate AS (
                        SELECT command.id
                        FROM qd_strategy_commands AS command
                        LEFT JOIN qd_strategy_runtime_leases AS lease
                          ON lease.strategy_id = command.strategy_id
                        WHERE command.attempts < %s
                          AND (
                            (command.status = 'pending' AND command.available_at <= NOW())
                            OR
                            (command.status = 'processing' AND command.lease_expires_at < NOW())
                          )
                          AND (
                            command.command_type IN ('start', 'reconcile')
                            OR lease.strategy_id IS NULL
                            OR lease.owner_id = %s
                            OR lease.lease_expires_at < NOW()
                          )
                        ORDER BY command.id
                        FOR UPDATE OF command SKIP LOCKED
                        LIMIT 1
                    )
                    UPDATE qd_strategy_commands AS command
                    SET status = 'processing',
                        claimed_by = %s,
                        claimed_at = COALESCE(command.claimed_at, NOW()),
                        lease_expires_at = NOW() + (%s * INTERVAL '1 second'),
                        attempts = command.attempts + 1,
                        updated_at = NOW()
                    FROM candidate
                    WHERE command.id = candidate.id
                    RETURNING command.*
                    """,
                    (int(max_attempts), owner_id, owner_id, int(lease_seconds)),
                )
                row = cur.fetchone()
                db.commit()
                return StrategyCommand.from_row(dict(row)) if row else None
            except Exception:
                db.rollback()
                raise
            finally:
                cur.close()

    def complete(self, command_id: int, *, result: dict[str, Any] | None = None) -> None:
        self._finish(command_id, "succeeded", result=result)

    def fail(self, command_id: int, error: str, *, retry_delay_seconds: int | None = None) -> None:
        if retry_delay_seconds is not None:
            with get_db_connection() as db:
                cur = db.cursor()
                try:
                    cur.execute(
                        """
                        UPDATE qd_strategy_commands
                        SET status = 'pending', error_message = %s,
                            available_at = NOW() + (%s * INTERVAL '1 second'),
                            lease_expires_at = NULL, updated_at = NOW()
                        WHERE id = %s
                        """,
                        (error[:4000], int(retry_delay_seconds), int(command_id)),
                    )
                    db.commit()
                finally:
                    cur.close()
            return
        self._finish(command_id, "failed", error=error)

    def _finish(
        self,
        command_id: int,
        status: str,
        *,
        result: dict[str, Any] | None = None,
        error: str = "",
    ) -> None:
        with get_db_connection() as db:
            cur = db.cursor()
            try:
                cur.execute(
                    """
                    UPDATE qd_strategy_commands
                    SET status = %s, result_json = %s::jsonb, error_message = %s,
                        completed_at = NOW(), lease_expires_at = NULL, updated_at = NOW()
                    WHERE id = %s
                    """,
                    (status, json.dumps(result or {}, default=str), error[:4000], int(command_id)),
                )
                db.commit()
            finally:
                cur.close()

    def get(self, command_id: int) -> StrategyCommand | None:
        with get_db_connection() as db:
            cur = db.cursor()
            try:
                cur.execute("SELECT * FROM qd_strategy_commands WHERE id = %s", (int(command_id),))
                row = cur.fetchone()
                return StrategyCommand.from_row(dict(row)) if row else None
            finally:
                cur.close()

    def has_active_strategy_lease(self, strategy_id: int) -> bool:
        with get_db_connection() as db:
            cur = db.cursor()
            try:
                cur.execute(
                    """
                    SELECT 1
                    FROM qd_strategy_runtime_leases
                    WHERE strategy_id = %s AND lease_expires_at >= NOW()
                    LIMIT 1
                    """,
                    (int(strategy_id),),
                )
                return cur.fetchone() is not None
            finally:
                cur.close()

    def has_pending_stop(self, strategy_id: int) -> bool:
        with get_db_connection() as db:
            cur = db.cursor()
            try:
                cur.execute(
                    """SELECT 1 FROM qd_strategy_commands
                       WHERE strategy_id = %s AND command_type = 'stop'
                         AND status IN ('pending', 'processing') LIMIT 1""",
                    (int(strategy_id),),
                )
                return cur.fetchone() is not None
            finally:
                cur.close()

    def acquire_strategy_lease(self, *, strategy_id: int, owner_id: str, lease_seconds: int) -> int | None:
        with get_db_connection() as db:
            cur = db.cursor()
            try:
                cur.execute(
                    """
                    INSERT INTO qd_strategy_runtime_leases
                        (strategy_id, owner_id, fencing_token, lease_expires_at, heartbeat_at)
                    VALUES (%s, %s, 1, NOW() + (%s * INTERVAL '1 second'), NOW())
                    ON CONFLICT (strategy_id) DO UPDATE
                    SET owner_id = EXCLUDED.owner_id,
                        fencing_token = CASE
                            WHEN qd_strategy_runtime_leases.owner_id = EXCLUDED.owner_id
                                THEN qd_strategy_runtime_leases.fencing_token
                            ELSE qd_strategy_runtime_leases.fencing_token + 1
                        END,
                        lease_expires_at = EXCLUDED.lease_expires_at,
                        heartbeat_at = NOW(),
                        updated_at = NOW()
                    WHERE qd_strategy_runtime_leases.owner_id = EXCLUDED.owner_id
                       OR qd_strategy_runtime_leases.lease_expires_at < NOW()
                    RETURNING fencing_token
                    """,
                    (int(strategy_id), owner_id, int(lease_seconds)),
                )
                row = cur.fetchone()
                db.commit()
                return int(row["fencing_token"]) if row else None
            except Exception:
                db.rollback()
                raise
            finally:
                cur.close()

    def renew_strategy_lease(self, *, strategy_id: int, owner_id: str, lease_seconds: int) -> bool:
        with get_db_connection() as db:
            cur = db.cursor()
            try:
                cur.execute(
                    """
                    UPDATE qd_strategy_runtime_leases
                    SET lease_expires_at = NOW() + (%s * INTERVAL '1 second'),
                        heartbeat_at = NOW(), updated_at = NOW()
                    WHERE strategy_id = %s AND owner_id = %s
                      AND lease_expires_at >= NOW()
                    """,
                    (int(lease_seconds), int(strategy_id), owner_id),
                )
                ok = cur.rowcount == 1
                db.commit()
                return ok
            finally:
                cur.close()

    def release_strategy_lease(self, *, strategy_id: int, owner_id: str) -> None:
        with get_db_connection() as db:
            cur = db.cursor()
            try:
                cur.execute(
                    "DELETE FROM qd_strategy_runtime_leases WHERE strategy_id = %s AND owner_id = %s",
                    (int(strategy_id), owner_id),
                )
                db.commit()
            finally:
                cur.close()

    def record_worker_heartbeat(
        self,
        *,
        worker_id: str,
        role: str,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        with get_db_connection() as db:
            cur = db.cursor()
            try:
                cur.execute(
                    """
                    INSERT INTO qd_worker_heartbeats
                        (worker_id, role, status, metadata_json, started_at, heartbeat_at)
                    VALUES (%s, %s, 'running', %s::jsonb, NOW(), NOW())
                    ON CONFLICT (worker_id) DO UPDATE
                    SET role = EXCLUDED.role, status = 'running',
                        metadata_json = EXCLUDED.metadata_json,
                        heartbeat_at = NOW(), updated_at = NOW()
                    RETURNING worker_id
                    """,
                    (worker_id, role, json.dumps(metadata or {}, default=str)),
                )
                db.commit()
            finally:
                cur.close()

    def mark_worker_stopped(self, worker_id: str) -> None:
        with get_db_connection() as db:
            cur = db.cursor()
            try:
                cur.execute(
                    """
                    UPDATE qd_worker_heartbeats
                    SET status = 'stopped', heartbeat_at = NOW(), updated_at = NOW()
                    WHERE worker_id = %s
                    """,
                    (worker_id,),
                )
                db.commit()
            finally:
                cur.close()

    def acquire_process_lease(self, *, lease_key: str, owner_id: str, lease_seconds: int) -> bool:
        with get_db_connection() as db:
            cur = db.cursor()
            try:
                cur.execute(
                    """
                    INSERT INTO qd_process_leases (lease_key, owner_id, lease_expires_at, heartbeat_at)
                    VALUES (%s, %s, NOW() + (%s * INTERVAL '1 second'), NOW())
                    ON CONFLICT (lease_key) DO UPDATE
                    SET owner_id = EXCLUDED.owner_id,
                        lease_expires_at = EXCLUDED.lease_expires_at,
                        heartbeat_at = NOW(), updated_at = NOW()
                    WHERE qd_process_leases.owner_id = EXCLUDED.owner_id
                       OR qd_process_leases.lease_expires_at < NOW()
                    RETURNING lease_key
                    """,
                    (lease_key, owner_id, int(lease_seconds)),
                )
                acquired = cur.fetchone() is not None
                db.commit()
                return acquired
            finally:
                cur.close()

    def renew_process_lease(self, *, lease_key: str, owner_id: str, lease_seconds: int) -> bool:
        with get_db_connection() as db:
            cur = db.cursor()
            try:
                cur.execute(
                    """
                    UPDATE qd_process_leases
                    SET lease_expires_at = NOW() + (%s * INTERVAL '1 second'),
                        heartbeat_at = NOW(), updated_at = NOW()
                    WHERE lease_key = %s AND owner_id = %s AND lease_expires_at >= NOW()
                    """,
                    (int(lease_seconds), lease_key, owner_id),
                )
                renewed = cur.rowcount == 1
                db.commit()
                return renewed
            finally:
                cur.close()

    def release_process_lease(self, *, lease_key: str, owner_id: str) -> None:
        with get_db_connection() as db:
            cur = db.cursor()
            try:
                cur.execute(
                    "DELETE FROM qd_process_leases WHERE lease_key = %s AND owner_id = %s",
                    (lease_key, owner_id),
                )
                db.commit()
            finally:
                cur.close()

    def fail_exhausted_commands(self, max_attempts: int) -> int:
        with get_db_connection() as db:
            cur = db.cursor()
            try:
                cur.execute(
                    """
                    UPDATE qd_strategy_commands
                    SET status = 'failed',
                        error_message = CASE
                            WHEN error_message = '' THEN 'Command lease expired after maximum attempts.'
                            ELSE error_message
                        END,
                        completed_at = NOW(), lease_expires_at = NULL, updated_at = NOW()
                    WHERE status = 'processing' AND lease_expires_at < NOW() AND attempts >= %s
                    """,
                    (int(max_attempts),),
                )
                count = cur.rowcount
                db.commit()
                return count
            finally:
                cur.close()

    def cleanup_runtime_metadata(
        self,
        *,
        command_retention_days: int,
        heartbeat_retention_days: int,
    ) -> dict[str, int]:
        with get_db_connection() as db:
            cur = db.cursor()
            try:
                cur.execute(
                    """
                    DELETE FROM qd_strategy_commands
                    WHERE status IN ('succeeded', 'failed', 'cancelled')
                      AND completed_at < NOW() - (%s * INTERVAL '1 day')
                    """,
                    (int(command_retention_days),),
                )
                commands = cur.rowcount
                cur.execute(
                    """
                    DELETE FROM qd_worker_heartbeats
                    WHERE heartbeat_at < NOW() - (%s * INTERVAL '1 day')
                    """,
                    (int(heartbeat_retention_days),),
                )
                heartbeats = cur.rowcount
                cur.execute(
                    "DELETE FROM qd_process_leases WHERE lease_expires_at < NOW() - INTERVAL '1 day'"
                )
                process_leases = cur.rowcount
                cur.execute(
                    "DELETE FROM qd_strategy_runtime_leases WHERE lease_expires_at < NOW() - INTERVAL '1 day'"
                )
                strategy_leases = cur.rowcount
                db.commit()
                return {
                    "commands": commands,
                    "heartbeats": heartbeats,
                    "process_leases": process_leases,
                    "strategy_leases": strategy_leases,
                }
            finally:
                cur.close()
