"""Per-user broker session registry.

Brokers expose stateful HTTP routes (`/connect`, `/status`, `/order`, ...).
Previously each route module kept a single module-level ``_client`` global,
which means **every authenticated user shares one connection** to the broker.
That's fine for a single-tenant desktop install but is a multi-tenancy bug in
SaaS deployments: user B calling ``POST /api/alpaca/order`` would route the
order through user A's account.

This module provides :class:`BrokerSessionRegistry`, a small thread-safe map
from ``(user_id, broker_name)`` to a broker client instance. Route handlers
should grab the registry instance for their broker and call ``get()``/``set()``
/``clear()`` instead of using a module-level global.

The client object itself must expose a ``disconnect()`` method so the registry
can tear down stale sessions when a user reconnects.
"""

from __future__ import annotations

import threading
from typing import Any, Dict, Optional, Tuple

from flask import g

from app.utils.logger import get_logger

logger = get_logger(__name__)


class BrokerSessionRegistry:
    """Thread-safe per-user broker client cache.

    A single registry instance is typically created per broker (e.g. one for
    IBKR, one for Alpaca). Keys are ``(user_id, broker_name)`` so the same
    registry can be reused across processes/brokers if desired.

    Notes:
        * Falls back to ``user_id=0`` when no Flask request context exists or
          ``flask.g.user_id`` is unset (e.g. legacy single-user mode). This is
          intentional so that local installs without auth keep working.
        * Replacing an existing client via :meth:`set` calls ``disconnect()``
          on the old one (best-effort, exceptions swallowed) before storing
          the new one.
    """

    def __init__(self, broker_name: str):
        if not broker_name:
            raise ValueError("broker_name is required")
        self.broker_name = broker_name
        self._clients: Dict[Tuple[int, str], Any] = {}
        self._lock = threading.RLock()

    @staticmethod
    def _current_user_id() -> int:
        try:
            uid = getattr(g, 'user_id', None)
        except RuntimeError:
            uid = None
        if uid is None:
            return 0
        try:
            return int(uid)
        except (TypeError, ValueError):
            return 0

    def _key(self) -> Tuple[int, str]:
        return (self._current_user_id(), self.broker_name)

    def get(self) -> Optional[Any]:
        """Return the current user's client or ``None`` if not connected."""
        with self._lock:
            return self._clients.get(self._key())

    def set(self, client: Any) -> None:
        """Store ``client`` for the current user, disposing any prior one."""
        with self._lock:
            key = self._key()
            old = self._clients.get(key)
            if old is not None and old is not client:
                try:
                    old.disconnect()
                except Exception as exc:  # pragma: no cover - defensive
                    logger.debug(
                        "[%s] previous client.disconnect() raised: %s",
                        self.broker_name, exc,
                    )
            self._clients[key] = client

    def clear(self) -> Optional[Any]:
        """Remove the current user's client (without calling disconnect)."""
        with self._lock:
            return self._clients.pop(self._key(), None)

    def disconnect_current(self) -> bool:
        """Disconnect and remove the current user's client.

        Returns ``True`` if a client existed and was disconnected.
        """
        with self._lock:
            client = self._clients.pop(self._key(), None)
        if client is None:
            return False
        try:
            client.disconnect()
        except Exception as exc:  # pragma: no cover - defensive
            logger.debug("[%s] disconnect on cleanup raised: %s", self.broker_name, exc)
        return True

    def all_user_ids(self) -> Tuple[int, ...]:
        """Return a snapshot of user ids currently holding a session."""
        with self._lock:
            return tuple(sorted({uid for uid, _ in self._clients}))


__all__ = ['BrokerSessionRegistry']
