"""Durable state storage for strategy runtime services."""

from __future__ import annotations

import json
import time
from typing import Any, Dict

from app.utils.db import get_db_connection
from app.utils.logger import get_logger

logger = get_logger(__name__)


class RuntimeStateStore:
    """Small JSON state store keyed by strategy run and namespace."""

    def __init__(self, *, strategy_id: int, strategy_run_id: int = 0, state_key: str = "script"):
        self.strategy_id = int(strategy_id or 0)
        self.strategy_run_id = int(strategy_run_id or 0)
        self.state_key = str(state_key or "script")
        self._last_serialized = ""
        self._last_saved_at = 0.0
        self._pending: Dict[str, Any] | None = None

    def load(self) -> Dict[str, Any]:
        if self.strategy_id <= 0:
            return {}
        try:
            with get_db_connection() as db:
                cur = db.cursor()
                cur.execute(
                    """
                    SELECT state_json
                    FROM strategy_runtime_state
                    WHERE strategy_run_id = %s AND strategy_id = %s AND state_key = %s
                    """,
                    (self.strategy_run_id, self.strategy_id, self.state_key),
                )
                row = cur.fetchone() or {}
                cur.close()
            raw = row.get("state_json") if isinstance(row, dict) else {}
            if isinstance(raw, dict):
                return dict(raw)
            if isinstance(raw, str) and raw.strip():
                parsed = json.loads(raw)
                return parsed if isinstance(parsed, dict) else {}
        except Exception as exc:
            logger.debug("runtime state load skipped: %s", exc)
        return {}

    def save(
        self,
        values: Dict[str, Any],
        *,
        min_interval_seconds: float = 0.0,
        force: bool = False,
    ) -> bool:
        if self.strategy_id <= 0:
            return False
        try:
            safe = json.loads(json.dumps(values or {}, default=str))
        except Exception:
            safe = {}
        serialized = json.dumps(safe, ensure_ascii=False, sort_keys=True)
        now = time.monotonic()
        if not force and serialized == self._last_serialized:
            self._pending = None
            return False
        if (
            not force
            and self._last_saved_at > 0
            and now - self._last_saved_at < max(0.0, float(min_interval_seconds or 0.0))
        ):
            self._pending = safe
            return False
        return self._write(safe, serialized=serialized, saved_at=now)

    def flush(self) -> bool:
        """Persist the newest coalesced snapshot before a runtime exits."""
        if self._pending is None:
            return False
        safe = self._pending
        serialized = json.dumps(safe, ensure_ascii=False, sort_keys=True)
        return self._write(safe, serialized=serialized, saved_at=time.monotonic())

    def _write(self, safe: Dict[str, Any], *, serialized: str, saved_at: float) -> bool:
        try:
            with get_db_connection() as db:
                cur = db.cursor()
                cur.execute(
                    """
                    INSERT INTO strategy_runtime_state
                    (strategy_run_id, strategy_id, state_key, state_json, version, updated_at)
                    VALUES (%s, %s, %s, %s, 1, NOW())
                    ON CONFLICT(strategy_run_id, strategy_id, state_key)
                    DO UPDATE SET
                        state_json = excluded.state_json,
                        version = strategy_runtime_state.version + 1,
                        updated_at = NOW()
                    """,
                    (
                        self.strategy_run_id,
                        self.strategy_id,
                        self.state_key,
                        serialized,
                    ),
                )
                db.commit()
                cur.close()
            self._last_serialized = serialized
            self._last_saved_at = saved_at
            self._pending = None
            return True
        except Exception as exc:
            self._pending = safe
            logger.warning(
                "Runtime state persistence failed: strategy=%s run=%s key=%s",
                self.strategy_id,
                self.strategy_run_id,
                self.state_key,
                exc_info=True,
            )
            return False


class RuntimeStateProxy:
    """Dict-like state object for scripts.

    It starts with persisted values, keeps writes in memory during the current
    bar/tick, and flushes through ``RuntimeStateStore`` when asked by the
    executor or script.
    """

    def __init__(self, store: RuntimeStateStore | None = None, initial: Dict[str, Any] | None = None):
        self._store = store
        self._values: Dict[str, Any] = dict(initial or {})
        if store is not None:
            self._values.update(store.load())
        self._dirty = False

    def get(self, key: str, default: Any = None) -> Any:
        return self._values.get(str(key), default)

    def set(self, key: str, value: Any) -> Any:
        self._values[str(key)] = value
        self._dirty = True
        return value

    def update(self, values: Dict[str, Any]) -> None:
        if isinstance(values, dict):
            self._values.update(values)
            self._dirty = True

    def as_dict(self) -> Dict[str, Any]:
        return dict(self._values)

    def flush(self) -> None:
        if self._store is not None and self._dirty:
            self._store.save(self._values)
        self._dirty = False

    def __getitem__(self, key: str) -> Any:
        return self._values[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.set(key, value)

    def __contains__(self, key: str) -> bool:
        return key in self._values
