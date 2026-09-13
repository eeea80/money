#!/usr/bin/env python3
"""Sync local market symbol master data into qd_market_symbols.

Usage:
    python scripts/sync_market_symbols.py
    python scripts/sync_market_symbols.py --markets CNStock HKStock USStock
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND_ROOT))

os.environ.setdefault("SKIP_STARTUP_HOOKS", "1")


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync QuantDinger local symbol master data")
    parser.add_argument(
        "--markets",
        nargs="*",
        default=None,
        help="Markets to sync. Defaults to CNStock HKStock USStock Crypto.",
    )
    args = parser.parse_args()

    from app.services.symbol_master_sync import sync_symbol_master

    stats = sync_symbol_master(args.markets)
    print(json.dumps(stats, ensure_ascii=False, indent=2))

    failed = [market for market, stat in stats.items() if not stat.get("ok")]
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
