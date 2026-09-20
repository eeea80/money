"""Build the bundled sample dataset (data/sample_btcusdt_1m.csv).

Tries a live public Binance fetch first; if the network is unavailable,
falls back to a seeded synthetic random-walk so the dataset is
reproducible. Either way the pipeline can run end-to-end offline.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import pandas as pd

from omni_trader.market_data import MarketData

OUT = Path(__file__).resolve().parent.parent / "data" / "sample_btcusdt_1m.csv"


def synthetic(rows: int = 1000, seed: int = 42) -> pd.DataFrame:
    """Seeded geometric random walk with mild trend regimes (deterministic)."""
    rng = np.random.default_rng(seed)
    ts0 = pd.Timestamp("2024-01-01 00:00:00", tz="UTC")
    idx = pd.date_range(ts0, periods=rows, freq="1min")
    ret = rng.normal(0.00002, 0.0008, rows)
    # inject a couple of trend segments so crosses/RSI regimes actually occur
    ret[200:320] += 0.00035
    ret[600:760] -= 0.00030
    close = 42_000.0 * np.exp(np.cumsum(ret))
    open_ = np.concatenate([[close[0]], close[:-1]])
    spread = np.abs(rng.normal(0, 0.0006, rows)) * close
    high = np.maximum(open_, close) + spread
    low = np.minimum(open_, close) - spread
    vol = np.abs(rng.normal(8, 3, rows))
    df = pd.DataFrame(
        {"timestamp": (idx.asi8 // 10**6), "open": open_, "high": high,
         "low": low, "close": close, "volume": vol}
    )
    return df.round(6)


def main() -> None:
    md = MarketData(max_retries=2, backoff_base=1.2)
    try:
        df = md.fetch_ohlcv("BTC/USDT", "1m", limit=1000)
        src = f"live Binance snapshot ({len(df)} candles)"
    except Exception as exc:
        print(f"live fetch failed ({exc}); writing synthetic sample")
        df = synthetic()
        src = f"synthetic seeded sample ({len(df)} candles)"
    OUT.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUT, index=False)
    print(f"wrote {OUT} — {src}")


if __name__ == "__main__":
    main()
