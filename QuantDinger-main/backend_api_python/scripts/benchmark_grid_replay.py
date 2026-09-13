"""Benchmark deterministic grid replay, including a full-result fingerprint."""

import argparse
import hashlib
import json
from pathlib import Path
import statistics
import sys
import time

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.strategy_runtime.robot_v2 import _build_grid_v2_source
from app.services.strategy_v2 import StrategyV2BacktestRunner


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bars", type=int, default=1730)
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--source", type=Path)
    parser.add_argument("--save-source", type=Path)
    args = parser.parse_args()
    symbol = "Crypto:BTC/USDT@swap"
    code = args.source.read_text(encoding="utf-8") if args.source else _build_grid_v2_source(
        dict(side="long", dynamic_anchor=True, start_price=0.98, end_price=1.02,
             grid_count=8, initial_position_pct=0.6, max_open_orders=4,
             equity_take_profit_pct=0, equity_stop_loss_pct=0, equity_trailing_enabled=False),
        instrument=symbol, timeframe="15m",
    )
    if args.save_source:
        args.save_source.write_text(code, encoding="utf-8")
    prices = ([100, 100, 99.4, 99.4, 100.1, 100.1] * (args.bars // 6 + 1))[:args.bars]
    frame = pd.DataFrame(dict(
        open=prices, high=[p + 0.05 for p in prices], low=[p - 0.05 for p in prices],
        close=prices, volume=[100000] * len(prices),
    ), index=pd.date_range("2026-01-01", periods=len(prices), freq="15min"))
    durations = []
    fingerprints = []
    for _ in range(args.repeats):
        start = time.perf_counter()
        result = StrategyV2BacktestRunner(
            code=code, frames={symbol: frame}, initial_capital=1000,
            commission=0.0005, slippage=0.0005, leverage_enabled=True, leverage=1,
        ).run()
        durations.append(time.perf_counter() - start)
        fingerprints.append(hashlib.sha256(json.dumps(
            result, sort_keys=True, default=str, separators=(",", ":"),
        ).encode()).hexdigest())
    assert len(set(fingerprints)) == 1
    print(json.dumps(dict(
        bars=args.bars, seconds=durations, median_seconds=statistics.median(durations),
        executions=len(result["executions"]), audit=result["audit"]["passed"],
        result_sha256=fingerprints[0],
    ), indent=2))


if __name__ == "__main__":
    main()
