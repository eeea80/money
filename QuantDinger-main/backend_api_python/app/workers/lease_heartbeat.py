"""Renew trading leases independently of exchange I/O and the application pool."""
from __future__ import annotations

import threading
import time

import psycopg2

from app.utils.db_postgres import _get_database_url, _parse_database_url
from app.utils.logger import get_logger

logger = get_logger(__name__)


class LeaseHeartbeat:
    def __init__(self, owner_id, lease_seconds, on_loss, connect=None):
        self.owner_id = owner_id
        self.lease_seconds = lease_seconds
        self.on_loss = on_loss
        self.interval = max(0.5, min(5.0, lease_seconds / 4))
        self._connect = connect or self._open_connection
        self._connection = None
        self._strategies = {}
        self._global = None
        self._command = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = None

    @staticmethod
    def _open_connection():
        params = _parse_database_url(_get_database_url())
        if not params:
            raise RuntimeError("Trading heartbeat requires DATABASE_URL")
        params.update(connect_timeout=3, application_name="quantdinger-trading-heartbeat",
                      options="-c timezone=UTC -c statement_timeout=3000 -c lock_timeout=1000",
                      keepalives=1, keepalives_idle=5, keepalives_interval=2, keepalives_count=2,
                      tcp_user_timeout=5000)
        conn = psycopg2.connect(**params)
        conn.autocommit = True
        return conn

    def watch_strategy(self, strategy_id):
        with self._lock:
            self._strategies[strategy_id] = time.monotonic() + self.lease_seconds

    def forget_strategy(self, strategy_id):
        with self._lock:
            self._strategies.pop(strategy_id, None)

    def watch_global(self, key):
        with self._lock:
            self._global = (key, time.monotonic() + self.lease_seconds)

    def strategy_valid(self, strategy_id):
        with self._lock:
            return self._strategies.get(strategy_id, 0) > time.monotonic()

    def global_valid(self):
        with self._lock:
            return bool(self._global and self._global[1] > time.monotonic())

    def forget_global(self):
        with self._lock:
            self._global = None

    def watch_command(self, command_id, ttl):
        with self._lock:
            self._command = (command_id, time.monotonic() + ttl, ttl)

    def forget_command(self):
        with self._lock:
            self._command = None

    def command_valid(self, command_id):
        with self._lock:
            return bool(self._command and self._command[0] == command_id and self._command[1] > time.monotonic())

    def start(self):
        self._thread = threading.Thread(target=self._run, name="TradingLeaseHeartbeat", daemon=True)
        self._thread.start()

    def close(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=8)

    def _run(self):
        try:
            while not self._stop.wait(self.interval):
                self.renew()
        finally:
            self._disconnect()

    def _disconnect(self):
        if self._connection is not None:
            try:
                self._connection.close()
            except Exception:
                logger.warning("Trading heartbeat connection close failed", exc_info=True)
            self._connection = None

    def renew(self):
        with self._lock:
            strategies, global_lease, command = dict(self._strategies), self._global, self._command
        if not strategies and not global_lease and not command:
            return
        started = time.monotonic()
        renewed_ids, renewed_global, renewed_command = None, None, None
        try:
            if self._connection is None or self._connection.closed:
                self._connection = self._connect()
            with self._connection.cursor() as cur:
                if global_lease:
                    cur.execute(
                        "UPDATE qd_process_leases SET lease_expires_at = NOW() + (%s * INTERVAL '1 second'), "
                        "heartbeat_at = NOW(), updated_at = NOW() "
                        "WHERE lease_key = %s AND owner_id = %s AND lease_expires_at >= NOW() RETURNING lease_key",
                        (self.lease_seconds, global_lease[0], self.owner_id),
                    )
                    renewed_global = cur.fetchone() is not None
                if strategies:
                    cur.execute(
                        "UPDATE qd_strategy_runtime_leases SET lease_expires_at = NOW() + (%s * INTERVAL '1 second'), "
                        "heartbeat_at = NOW(), updated_at = NOW() "
                        "WHERE strategy_id = ANY(%s) AND owner_id = %s AND lease_expires_at >= NOW() RETURNING strategy_id",
                        (self.lease_seconds, list(strategies), self.owner_id),
                    )
                    renewed_ids = {int(row[0]) for row in cur.fetchall()}
                if command:
                    cur.execute(
                        "UPDATE qd_strategy_commands SET lease_expires_at = NOW() + (%s * INTERVAL '1 second'), "
                        "updated_at = NOW() WHERE id = %s AND claimed_by = %s AND status = 'processing' "
                        "AND lease_expires_at >= NOW() RETURNING id",
                        (command[2], command[0], self.owner_id),
                    )
                    renewed_command = cur.fetchone() is not None
        except Exception:
            logger.warning("Trading lease heartbeat failed; local deadlines remain enforced", exc_info=True)
            self._disconnect()
        lost = []
        with self._lock:
            if command and self._command == command:
                if renewed_command:
                    self._command = (command[0], started + command[2], command[2])
                elif renewed_command is False or time.monotonic() >= command[1]:
                    self._command = None
                    lost.append(("command", command[0]))
            for sid, deadline in strategies.items():
                if self._strategies.get(sid) != deadline:
                    continue
                if renewed_ids is not None and sid in renewed_ids:
                    self._strategies[sid] = started + self.lease_seconds
                elif renewed_ids is not None or time.monotonic() >= deadline:
                    self._strategies.pop(sid, None)
                    lost.append(("strategy", sid))
            if global_lease and self._global == global_lease:
                if renewed_global:
                    self._global = (global_lease[0], started + self.lease_seconds)
                elif renewed_global is False or time.monotonic() >= global_lease[1]:
                    self._global = None
                    lost.append(("global", 0))
        for kind, sid in lost:
            self.on_loss(kind, sid)
