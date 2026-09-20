"""Smoke run: live-paper-trade BTC/USDT 1m for a few minutes.

- Fetches candles (live Binance; falls back to the bundled sample offline).
- Polls for new 1m candles, evaluates the strategy, routes orders through
  the risk manager into the paper engine, journals everything.
- Prints a summary and leaves the journal on disk for inspection.

Usage: python scripts/run_smoke.py [--minutes 3]
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from omni_trader.journal import Journal
from omni_trader.market_data import MarketData
from omni_trader.paper_engine import PaperConfig, PaperEngine
from omni_trader.risk import RiskManager
from omni_trader.strategies import get_strategy

ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=float, default=3.0)
    ap.add_argument("--symbol", default="BTC/USDT")
    ap.add_argument("--timeframe", default="1m")
    ap.add_argument("--risk-mode", default="balanced")
    ap.add_argument("--latency-ms", type=float, default=140.0)
    args = ap.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    log = logging.getLogger("smoke")

    journal = Journal(ROOT / "data" / "journal.sqlite3")
    risk = RiskManager(starting_equity=10_000.0, mode=args.risk_mode)
    engine = PaperEngine(
        strategy=get_strategy("ema_cross_rsi"),
        journal=journal,
        risk_manager=risk,
        config=PaperConfig(
            starting_equity=10_000.0,
            execution_latency_ms=args.latency_ms,
            default_risk_mode=args.risk_mode,
        ),
        symbol=args.symbol,
        timeframe=args.timeframe,
    )
    market = MarketData()

    log.info("=== Omni-Trader smoke run: %s %s, %.1f min, mode=%s, latency=%.0fms",
             args.symbol, args.timeframe, args.minutes, args.risk_mode, args.latency_ms)

    df = market.get_candles(args.symbol, args.timeframe, 300)
    source = df.attrs.get("source", "unknown")
    log.info("initial candles: %d rows (source=%s), last close=%s",
             len(df), source, df.index[-1])
    engine.on_candle(df, source)  # warm-up: evaluate the latest history immediately

    deadline = time.monotonic() + args.minutes * 60.0
    poll = 10.0
    while time.monotonic() < deadline:
        time.sleep(poll)
        df = market.get_candles(args.symbol, args.timeframe, 300)
        src = df.attrs.get("source", "unknown")
        before = engine.last_close_ts
        engine.on_candle(df, src)
        new = (engine.last_close_ts is not None and engine.last_close_ts != before)
        st = engine.status()
        log.info("poll: source=%s new_candle=%s equity=%.2f pos=%s pending=%s signals=%d trades=%d",
                 src, new, st["equity"],
                 (st["position"] or {}).get("side", "-"),
                 (st["pending"] or {}).get("action", "-"),
                 journal.counts()["signals"], journal.counts()["trades"])

    st = engine.status()
    counts = journal.counts()
    log.info("=== summary: signals=%d trades=%d fills=%d equity=%.2f daily_pnl=%.2f "
             "throttle=%.2f mode=%s halted=%s",
             counts["signals"], counts["trades"], engine.fills, st["equity"],
             st["daily_pnl"], st["throttle"], st["risk_mode"], st["halted"])
    log.info("journal counts: %s", counts)
    log.info("strategy memory: %s", journal.get_memory())
    journal.close()
    market.close()


if __name__ == "__main__":
    main()
