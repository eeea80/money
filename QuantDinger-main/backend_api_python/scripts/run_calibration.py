#!/usr/bin/env python3
"""
Run AI calibration manually (e.g. via cron).

Usage:
  python scripts/run_calibration.py
  AI_CALIBRATION_MARKET=Crypto python scripts/run_calibration.py
  AI_CALIBRATION_MARKETS=Crypto,USStock python scripts/run_calibration.py
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app.services.ai_calibration import AICalibrationService


def main():
    markets = (os.getenv("AI_CALIBRATION_MARKETS") or os.getenv("AI_CALIBRATION_MARKET") or "Crypto").strip().split(",")
    for m in markets:
        m = m.strip()
        if not m:
            continue
        print(f"Calibrating market: {m}")
        svc = AICalibrationService()
        r = svc.calibrate_market(market=m, validate_before=True)
        if r:
            print(f"  OK: accuracy={r.best_accuracy:.1f}% threshold=±{r.buy_threshold:.1f} samples={r.sample_count}")
        else:
            print("  SKIP: not enough validated samples")
    print("Done.")


if __name__ == "__main__":
    main()
