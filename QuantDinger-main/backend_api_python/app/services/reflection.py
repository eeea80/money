"""
Reflection Service - Post-trade validation and learning.

Validates historical AI decisions against actual price outcomes,
updates qd_analysis_memory with was_correct/actual_return_pct,
and optionally triggers AI calibration.
"""
import os
import threading
import time
from typing import Dict, Any, Optional

from app.utils.logger import get_logger
from app.services.analysis_memory import get_analysis_memory

logger = get_logger(__name__)

_reflection_thread: Optional[threading.Thread] = None
_reflection_stop = threading.Event()


class ReflectionService:
    """
    Runs verification cycle: validate unvalidated decisions, optionally run calibration.
    """

    def run_verification_cycle(self) -> Dict[str, Any]:
        """
        Run one verification cycle:
        1. Validate unvalidated analysis records (older than min_age_days)
        2. Optionally run AI calibration for configured markets
        """
        memory = get_analysis_memory()
        min_age_days = int(os.getenv("REFLECTION_MIN_AGE_DAYS", "7"))
        limit = int(os.getenv("REFLECTION_VALIDATE_LIMIT", "200"))

        stats = memory.validate_unvalidated_older_than(
            min_age_days=min_age_days,
            limit=limit,
        )
        logger.info(f"Reflection validation: {stats}")

        if stats.get("validated", 0) > 0:
            self._maybe_run_calibration()
        else:
            logger.debug("No new validations, skipping calibration")

        return stats

    def _maybe_run_calibration(self) -> None:
        """Run AI calibration if enabled."""
        if os.getenv("ENABLE_OFFLINE_AI_CALIBRATION", "true").lower() != "true":
            return
        try:
            from app.services.ai_calibration import AICalibrationService
            svc = AICalibrationService()
            markets = (os.getenv("AI_CALIBRATION_MARKETS", "Crypto") or "Crypto").strip().split(",")
            for market in markets:
                market = market.strip()
                if not market:
                    continue
                result = svc.calibrate_market(
                    market=market,
                    lookback_days=int(os.getenv("AI_CALIBRATION_LOOKBACK_DAYS", "30")),
                    min_samples=int(os.getenv("AI_CALIBRATION_MIN_SAMPLES", "80")),
                    validate_before=False,
                )
                if result:
                    logger.info(
                        f"[Reflection] Calibration updated for {market}: "
                        f"accuracy={result.best_accuracy:.1f}% thr=±{result.buy_threshold:.1f}"
                    )
        except Exception as e:
            logger.warning(f"Reflection calibration failed: {e}", exc_info=True)


def start_reflection_worker() -> None:
    """Start background reflection worker (validates + calibrates periodically)."""
    global _reflection_thread
    # Default to ON to reduce environment-specific configuration needs.
    if os.getenv("ENABLE_REFLECTION_WORKER", "true").lower() != "true":
        logger.info("Reflection worker disabled (ENABLE_REFLECTION_WORKER != true).")
        return
    interval_sec = int(os.getenv("REFLECTION_WORKER_INTERVAL_SEC", "86400"))
    if _reflection_thread and _reflection_thread.is_alive():
        return

    def _run():
        _reflection_stop.clear()
        logger.info(f"Reflection worker started, interval={interval_sec}s")
        while not _reflection_stop.is_set():
            try:
                ReflectionService().run_verification_cycle()
            except Exception as e:
                logger.error(f"Reflection cycle failed: {e}", exc_info=True)
            _reflection_stop.wait(timeout=interval_sec)
        logger.info("Reflection worker stopped.")

    _reflection_thread = threading.Thread(target=_run, daemon=True)
    _reflection_thread.start()
