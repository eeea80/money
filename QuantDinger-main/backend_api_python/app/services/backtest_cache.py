import threading
import time
from typing import Any, Dict, Optional

import pandas as pd


class KlineCache:
    """Small in-memory K-line cache with timeframe-aware TTL."""

    def __init__(self, max_size: int = 64):
        self._store: Dict[str, Any] = {}
        self._lock = threading.Lock()
        self._max_size = max_size

    @staticmethod
    def _ttl_for_timeframe(timeframe: str) -> int:
        if timeframe in ("1m", "5m", "15m", "30m"):
            return 300
        return 1800

    def get(self, key: str) -> Optional[pd.DataFrame]:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            if time.time() > entry["expires"]:
                del self._store[key]
                return None
            return entry["df"].copy()

    def put(self, key: str, df: pd.DataFrame, timeframe: str) -> None:
        ttl = self._ttl_for_timeframe(timeframe)
        with self._lock:
            if len(self._store) >= self._max_size:
                oldest_key = min(self._store, key=lambda item: self._store[item]["expires"])
                del self._store[oldest_key]
            self._store[key] = {
                "df": df.copy(),
                "expires": time.time() + ttl,
            }
