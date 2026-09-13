"""
AI Calibration Service (offline).

Goal:
- Calibrate the objective-score -> decision thresholds using validated historical analysis outcomes.
- Make FastAnalysisService "self-tuning" based on performance.

Approach (approx rules as requested):
- Use qd_analysis_memory.actual_return_pct and apply simple correctness rules:
    BUY correct if return_pct > +2
    SELL correct if return_pct < -2
    HOLD correct if abs(return_pct) <= 5
- Search candidate absolute thresholds for score mapping:
    score >= +thr => BUY
    score <= -thr => SELL
    else => HOLD

We calibrate on consensus_score because it's the main "objective" signal used for overriding decisions.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Dict, Any, List, Optional, Tuple

from app.utils.db import get_db_connection
from app.utils.logger import get_logger
from app.services.analysis_memory import get_analysis_memory, AnalysisMemory
from app.services.market_data_collector import MarketDataCollector


logger = get_logger(__name__)


DEFAULTS = {
    "buy_threshold": 20.0,
    "sell_threshold": -20.0,
    "min_consensus_abs_override": 15.0,
    "quality_hold_threshold": 0.7,
}


@dataclass
class CalibrationResult:
    market: str
    buy_threshold: float
    sell_threshold: float
    best_accuracy: float
    coverage: Dict[str, int]
    sample_count: int
    validated_count: int
    updated_at_ts: float


class AICalibrationService:
    def __init__(self):
        self._ensure_table()

    def _ensure_table(self) -> None:
        try:
            with get_db_connection() as db:
                cur = db.cursor()
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS qd_ai_calibration (
                        id SERIAL PRIMARY KEY,
                        market VARCHAR(50) NOT NULL,
                        buy_threshold DECIMAL(10,4) NOT NULL,
                        sell_threshold DECIMAL(10,4) NOT NULL,
                        min_consensus_abs_override DECIMAL(10,4) NOT NULL,
                        quality_hold_threshold DECIMAL(10,4) NOT NULL,
                        validated_at TIMESTAMP DEFAULT NOW(),
                        created_at TIMESTAMP DEFAULT NOW()
                    );
                    """
                )
                # Index for latest lookup
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_ai_calibration_market_validated_at
                    ON qd_ai_calibration(market, validated_at DESC);
                    """
                )
                db.commit()
                cur.close()
        except Exception as e:
            logger.error(f"Failed to ensure qd_ai_calibration table: {e}", exc_info=True)

    def get_latest(self, market: str) -> Dict[str, Any]:
        """
        Get latest calibration config for market.
        Falls back to DEFAULTS if not found.
        """
        market = (market or "").strip()
        if not market:
            return dict(DEFAULTS)

        try:
            with get_db_connection() as db:
                cur = db.cursor()
                cur.execute(
                    """
                    SELECT buy_threshold, sell_threshold,
                           min_consensus_abs_override, quality_hold_threshold
                    FROM qd_ai_calibration
                    WHERE market = %s
                    ORDER BY validated_at DESC
                    LIMIT 1
                    """,
                    (market,),
                )
                row = cur.fetchone() or {}
                cur.close()
            if not row:
                return dict(DEFAULTS)
            out = dict(DEFAULTS)
            out["buy_threshold"] = float(row.get("buy_threshold") or DEFAULTS["buy_threshold"])
            out["sell_threshold"] = float(row.get("sell_threshold") or DEFAULTS["sell_threshold"])
            out["min_consensus_abs_override"] = float(
                row.get("min_consensus_abs_override") or DEFAULTS["min_consensus_abs_override"]
            )
            out["quality_hold_threshold"] = float(
                row.get("quality_hold_threshold") or DEFAULTS["quality_hold_threshold"]
            )
            return out
        except Exception as e:
            logger.warning(f"get_latest calibration failed: {e}", exc_info=True)
            return dict(DEFAULTS)

    def _candidate_abs_thresholds(self) -> List[float]:
        env = os.getenv("AI_CALIBRATION_CANDIDATE_ABS_THRESHOLDS", "").strip()
        if env:
            parts = [p.strip() for p in env.split(",") if p.strip()]
            out = []
            for p in parts:
                try:
                    out.append(float(p))
                except Exception:
                    continue
            if out:
                return sorted(set(out))
        # Default grid
        return [10, 12, 14, 16, 18, 20, 22, 25, 30]

    def _correctness_for_return(self, decision: str, return_pct: float) -> bool:
        # Approx correctness rules (as requested)
        if decision == "BUY":
            return return_pct > 2.0
        if decision == "SELL":
            return return_pct < -2.0
        # HOLD
        return abs(return_pct) <= 5.0

    def _predict_decision_from_score(self, score: float, abs_thr: float) -> str:
        if score >= abs_thr:
            return "BUY"
        if score <= -abs_thr:
            return "SELL"
        return "HOLD"

    def calibrate_market(
        self,
        market: str = "Crypto",
        *,
        lookback_days: int = 30,
        min_samples: int = 80,
        validate_before: bool = True,
    ) -> Optional[CalibrationResult]:
        market = (market or "").strip()
        if not market:
            return None

        abs_thresholds = self._candidate_abs_thresholds()

        validated_count = 0
        try:
            # Best-effort: validate old unvalidated records first.
            if validate_before:
                memory: AnalysisMemory = get_analysis_memory()
                # Validate anything older than ~7 days (matching your existing approx rules).
                validated_stats = memory.validate_unvalidated_older_than(
                    min_age_days=7, limit=300
                )
                validated_count = int(validated_stats.get("validated", 0) or 0)
        except Exception as e:
            logger.warning(f"pre-validation failed (skipped): {e}", exc_info=True)

        # Fetch validated rows with consensus_score and actual_return_pct
        rows: List[Dict[str, Any]] = []
        try:
            with get_db_connection() as db:
                cur = db.cursor()
                lookback_days_int = int(lookback_days)
                cur.execute(
                    """
                    SELECT
                        decision,
                        consensus_score,
                        consensus_abs,
                        quality_multiplier,
                        agreement_ratio,
                        actual_return_pct
                    FROM qd_analysis_memory
                    WHERE market = %s
                      AND validated_at IS NOT NULL
                      AND actual_return_pct IS NOT NULL
                      AND consensus_score IS NOT NULL
                      AND created_at > NOW() - (%s || ' days')::interval
                    """,
                    (market, lookback_days_int),
                )
                rows = cur.fetchall() or []
                cur.close()
        except Exception as e:
            logger.error(f"Failed to fetch memory rows for calibration: {e}", exc_info=True)
            return None

        sample_count = len(rows)
        if sample_count < min_samples:
            logger.warning(
                f"[AI Calibration] Not enough samples for {market}: {sample_count} < min_samples={min_samples}"
            )
            return None

        best_abs_thr = abs_thresholds[0]
        best_accuracy = -1.0
        best_coverage: Dict[str, int] = {"BUY": 0, "SELL": 0, "HOLD": 0}

        # Evaluate each threshold
        for thr in abs_thresholds:
            correct = 0
            total = 0
            coverage = {"BUY": 0, "SELL": 0, "HOLD": 0}

            for r in rows:
                try:
                    score = float(r.get("consensus_score") or 0.0)
                    return_pct = float(r.get("actual_return_pct") or 0.0)
                except Exception:
                    continue

                pred = self._predict_decision_from_score(score, thr)
                coverage[pred] += 1
                total += 1
                if self._correctness_for_return(pred, return_pct):
                    correct += 1

            if total <= 0:
                continue
            acc = correct / total * 100.0

            # Tie-break: prefer higher BUY+SELL coverage (avoid always HOLD)
            # Secondary tie-break: higher accuracy
            buy_sell_cov = coverage["BUY"] + coverage["SELL"]
            best_buy_sell_cov = best_coverage["BUY"] + best_coverage["SELL"]

            if acc > best_accuracy:
                best_accuracy = acc
                best_abs_thr = thr
                best_coverage = coverage
            elif acc == best_accuracy:
                if buy_sell_cov > best_buy_sell_cov:
                    best_abs_thr = thr
                    best_coverage = coverage

        # Write new calibration row
        buy_threshold = float(best_abs_thr)
        sell_threshold = float(-best_abs_thr)
        cfg = self.get_latest(market)
        min_consensus_abs_override = float(cfg.get("min_consensus_abs_override") or DEFAULTS["min_consensus_abs_override"])
        quality_hold_threshold = float(cfg.get("quality_hold_threshold") or DEFAULTS["quality_hold_threshold"])

        try:
            with get_db_connection() as db:
                cur = db.cursor()
                cur.execute(
                    """
                    INSERT INTO qd_ai_calibration
                      (market, buy_threshold, sell_threshold,
                       min_consensus_abs_override, quality_hold_threshold,
                       validated_at, created_at)
                    VALUES
                      (%s, %s, %s, %s, %s, NOW(), NOW())
                    """,
                    (
                        market,
                        buy_threshold,
                        sell_threshold,
                        min_consensus_abs_override,
                        quality_hold_threshold,
                    ),
                )
                db.commit()
                cur.close()
        except Exception as e:
            logger.error(f"[AI Calibration] Failed to persist calibration: {e}", exc_info=True)
            return None

        return CalibrationResult(
            market=market,
            buy_threshold=buy_threshold,
            sell_threshold=sell_threshold,
            best_accuracy=float(best_accuracy),
            coverage=best_coverage,
            sample_count=sample_count,
            validated_count=int(validated_count),
            updated_at_ts=time.time(),
        )


def start_ai_calibration_worker() -> None:
    """
    Run offline calibration once on service startup (best-effort).
    """
    enabled = os.getenv("ENABLE_OFFLINE_AI_CALIBRATION", "true").lower() == "true"
    if not enabled:
        logger.info("AI calibration worker disabled (ENABLE_OFFLINE_AI_CALIBRATION=false).")
        return

    try:
        svc = AICalibrationService()
        lookback_days = int(os.getenv("AI_CALIBRATION_LOOKBACK_DAYS", "30"))
        min_samples = int(os.getenv("AI_CALIBRATION_MIN_SAMPLES", "80"))
        market = os.getenv("AI_CALIBRATION_MARKET", "Crypto").strip() or "Crypto"
        logger.info(
            f"Starting offline AI calibration: market={market}, lookback_days={lookback_days}, min_samples={min_samples}"
        )
        result = svc.calibrate_market(market=market, lookback_days=lookback_days, min_samples=min_samples)
        if result:
            logger.info(
                f"[AI Calibration] market={result.market} best_thr=+{result.buy_threshold:.1f} "
                f"accuracy={result.best_accuracy:.2f}% sample={result.sample_count} "
                f"coverage={result.coverage} validated_new={result.validated_count}"
            )
        else:
            logger.info("[AI Calibration] No calibration update applied (not enough data).")
    except Exception as e:
        logger.error(f"start_ai_calibration_worker failed: {e}", exc_info=True)

