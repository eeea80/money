"""Small request protection helpers for high-frequency read endpoints."""

from __future__ import annotations

import os
import threading
from concurrent.futures import Future, ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from typing import Any, Callable

from app.utils.cache import CacheManager
from app.utils.logger import get_logger

logger = get_logger(__name__)

_cache = CacheManager()
_executor = ThreadPoolExecutor(
    max_workers=max(4, int(os.getenv("REQUEST_GUARD_WORKERS", "16"))),
    thread_name_prefix="request-guard",
)
_inflight: dict[str, Future] = {}
_inflight_lock = threading.Lock()
_semaphores: dict[str, threading.BoundedSemaphore] = {}
_semaphores_lock = threading.Lock()


class RequestGuardError(RuntimeError):
    """Raised when a protected endpoint is overloaded or times out."""

    def __init__(self, message: str, *, status_code: int = 503):
        super().__init__(message)
        self.status_code = int(status_code or 503)


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except Exception:
        return default


def _semaphore(name: str, max_concurrent: int) -> threading.BoundedSemaphore:
    key = name or "default"
    with _semaphores_lock:
        sem = _semaphores.get(key)
        if sem is None:
            sem = threading.BoundedSemaphore(max(1, int(max_concurrent or 1)))
            _semaphores[key] = sem
        return sem


def cache_key(*parts: Any) -> str:
    return ":".join(str(p).strip().replace(" ", "_") for p in parts if p is not None)


def guarded_cached(
    key: str,
    compute: Callable[[], Any],
    *,
    ttl_sec: int,
    stale_ttl_sec: int | None = None,
    timeout_sec: float = 8.0,
    namespace: str = "default",
    max_concurrent: int | None = None,
    cache_if: Callable[[Any], bool] | None = None,
) -> Any:
    """Return a cached value or compute it with per-key singleflight.

    ``singleflight`` makes concurrent requests for the same key share one
    upstream/database call.  A small semaphore limits total concurrent work per
    namespace.  When a fresh value cannot be produced quickly, stale cache is
    returned if available instead of piling more work onto the server.
    """

    ttl = max(1, int(ttl_sec or 1))
    stale_ttl = int(stale_ttl_sec or max(ttl * 12, ttl + 1))
    fresh_key = f"guard:fresh:{key}"
    stale_key = f"guard:stale:{key}"

    cached = _cache.get(fresh_key)
    if cached is not None:
        return cached

    stale = _cache.get(stale_key)
    work_key = f"{namespace}:{key}"

    created = False
    with _inflight_lock:
        fut = _inflight.get(work_key)
        if fut is None:
            sem = _semaphore(namespace, max_concurrent or _env_int("REQUEST_GUARD_MAX_CONCURRENT", 16))
            if not sem.acquire(blocking=False):
                if stale is not None:
                    return stale
                raise RequestGuardError("Server is busy, please retry shortly.", status_code=429)

            def _run():
                try:
                    value = compute()
                    should_cache = cache_if(value) if cache_if is not None else True
                    if should_cache:
                        _cache.set(fresh_key, value, ttl)
                        _cache.set(stale_key, value, stale_ttl)
                    return value
                finally:
                    try:
                        sem.release()
                    except Exception:
                        pass

            fut = _executor.submit(_run)
            _inflight[work_key] = fut
            created = True

    if created:
        def _cleanup(done: Future) -> None:
            with _inflight_lock:
                if _inflight.get(work_key) is done:
                    _inflight.pop(work_key, None)

        fut.add_done_callback(_cleanup)

    try:
        return fut.result(timeout=max(0.1, float(timeout_sec or 0.1)))
    except FuturesTimeoutError:
        if stale is not None:
            logger.info("request guard timeout; serving stale cache for %s", work_key)
            return stale
        raise RequestGuardError("Request timed out, please retry shortly.", status_code=504)
    except Exception:
        if stale is not None:
            logger.info("request guard failed; serving stale cache for %s", work_key, exc_info=True)
            return stale
        raise
