"""Market data — Binance public OHLCV via ccxt. No API keys, no auth.

- Supported timeframes: 1m, 5m, 15m, 1h, 4h, 1d.
- Exponential backoff retry on transient network errors.
- If Binance is unreachable (e.g. sandboxed/offline environments),
  `MarketData.get_candles` falls back to the bundled sample dataset so
  the whole pipeline still runs end-to-end. Every response records its
  source as "binance" or "sample" so callers/UI can be honest about it.
"""

from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from typing import Dict, List, Optional

import pandas as pd

logger = logging.getLogger(__name__)

SUPPORTED_TIMEFRAMES = ("1m", "5m", "15m", "1h", "4h", "1d")

COLUMNS = ["timestamp", "open", "high", "low", "close", "volume"]

# Exchanges that need no keys for public OHLCV.
DEFAULT_EXCHANGE_ID = os.environ.get("OMNI_EXCHANGE", "binance")

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
SAMPLE_CSV = PACKAGE_ROOT / "data" / "sample_btcusdt_1m.csv"


class MarketDataError(RuntimeError):
    """Raised when neither live nor sample data can be provided."""


class MarketData:
    """Public market data with retry/backoff and offline sample fallback."""

    def __init__(
        self,
        exchange_id: str = DEFAULT_EXCHANGE_ID,
        max_retries: int = 3,
        backoff_base: float = 1.5,
        timeout_ms: int = 10_000,
        sample_csv: Optional[Path] = None,
    ) -> None:
        self.exchange_id = exchange_id
        self.max_retries = max_retries
        self.backoff_base = backoff_base
        self.timeout_ms = timeout_ms
        self.sample_csv = Path(sample_csv) if sample_csv else SAMPLE_CSV
        self._exchange = None  # lazy: don't touch the network until needed
        self.last_source: str = "unknown"

    # ------------------------------------------------------------------
    def _get_exchange(self):
        if self._exchange is None:
            import ccxt  # imported lazily so offline machines can still import this module

            klass = getattr(ccxt, self.exchange_id, None)
            if klass is None:
                raise MarketDataError(f"unknown exchange id: {self.exchange_id}")
            # Public endpoints only: no apiKey, no secret, no trading.
            self._exchange = klass(
                {"enableRateLimit": True, "timeout": self.timeout_ms}
            )
        return self._exchange

    @staticmethod
    def validate_timeframe(timeframe: str) -> str:
        if timeframe not in SUPPORTED_TIMEFRAMES:
            raise ValueError(
                f"unsupported timeframe {timeframe!r}; choose from {SUPPORTED_TIMEFRAMES}"
            )
        return timeframe

    # ------------------------------------------------------------------
    def fetch_ohlcv(
        self, symbol: str = "BTC/USDT", timeframe: str = "1m", limit: int = 300
    ) -> pd.DataFrame:
        """Fetch OHLCV from the exchange with exponential-backoff retries.

        Raises MarketDataError if all retries fail (caller decides fallback).
        """
        self.validate_timeframe(timeframe)
        exchange = self._get_exchange()
        last_exc: Optional[Exception] = None
        for attempt in range(1, self.max_retries + 1):
            try:
                raw: List[List] = exchange.fetch_ohlcv(symbol, timeframe, limit=limit)
                df = self._to_dataframe(raw)
                self.last_source = "binance"
                return df
            except Exception as exc:  # network/HTTP/rate errors — retry
                last_exc = exc
                delay = self.backoff_base ** attempt
                logger.warning(
                    "fetch_ohlcv attempt %d/%d failed (%s); retrying in %.1fs",
                    attempt,
                    self.max_retries,
                    exc,
                    delay,
                )
                time.sleep(delay)
        raise MarketDataError(
            f"failed to fetch {symbol} {timeframe} after {self.max_retries} attempts"
        ) from last_exc

    # ------------------------------------------------------------------
    def load_sample(self, symbol: str = "BTC/USDT", timeframe: str = "1m") -> pd.DataFrame:
        """Load the bundled sample dataset (offline fallback)."""
        self.validate_timeframe(timeframe)
        if not self.sample_csv.exists():
            raise MarketDataError(
                f"sample dataset missing at {self.sample_csv}; run scripts/build_sample_data.py"
            )
        df = pd.read_csv(self.sample_csv)
        missing = set(COLUMNS) - set(df.columns)
        if missing:
            raise MarketDataError(f"sample dataset missing columns: {missing}")
        df = self._with_datetime_index(df)
        self.last_source = "sample"
        return df[["open", "high", "low", "close", "volume"]].tail(1000)

    # ------------------------------------------------------------------
    def get_candles(
        self, symbol: str = "BTC/USDT", timeframe: str = "1m", limit: int = 300
    ) -> pd.DataFrame:
        """Live fetch with automatic fallback to the bundled sample.

        The DataFrame carries `attrs["source"]` = "binance" | "sample".
        """
        try:
            df = self.fetch_ohlcv(symbol, timeframe, limit)
            df.attrs["source"] = "binance"
            return df
        except MarketDataError as exc:
            logger.error("live market data unavailable (%s); using bundled sample", exc)
            df = self.load_sample(symbol, timeframe)
            df.attrs["source"] = "sample"
            return df

    # ------------------------------------------------------------------
    @staticmethod
    def _with_datetime_index(df: pd.DataFrame) -> pd.DataFrame:
        """Set a UTC DatetimeIndex from the `timestamp` column.

        Accepts ms-epoch (ccxt standard) or s-epoch values: magnitudes
        below 1e12 are treated as seconds.
        """
        ts = pd.to_numeric(df["timestamp"], errors="coerce")
        unit = "s" if float(ts.median()) < 1e12 else "ms"
        idx = pd.to_datetime(ts, unit=unit, utc=True)
        out = df[["open", "high", "low", "close", "volume"]].copy()
        out.index = pd.DatetimeIndex(idx, name="open_time")
        return out

    @staticmethod
    def _to_dataframe(raw: List[List]) -> pd.DataFrame:
        df = pd.DataFrame(raw, columns=COLUMNS)
        for col in ("open", "high", "low", "close", "volume"):
            df[col] = pd.to_numeric(df[col], errors="coerce")
        df = df.dropna().reset_index(drop=True)
        if df.empty:
            raise MarketDataError("exchange returned no usable candles")
        return MarketData._with_datetime_index(df)

    def close(self) -> None:
        if self._exchange is not None:
            try:
                self._exchange.close()
            except Exception:  # pragma: no cover - best effort
                pass
            self._exchange = None
