"""Shared multi-timeframe loading for live Strategy API V2 sessions."""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Callable

import pandas as pd

from app.data_sources.errors import (
    MarketDataFailure,
    MarketDataUnavailableError,
    classify_market_data_failure,
)
from app.services.fundamental_data import get_fundamental_data_service
from app.services.strategy_v2.frequencies import frequency_seconds
from app.services.strategy_v2.models import StrategyManifest
from app.services.strategy_v2.service import StrategyV2BacktestService


def live_history_days(frequency: str, warmup_bars: int) -> int:
    """Return a frequency-aware live lookback with a startup buffer."""
    bars = max(10, max(1, int(warmup_bars or 0)) * 3)
    seconds = frequency_seconds(frequency) * bars
    return max(1, int(math.ceil(seconds / 86_400)))


def completed_bar_token(frequency: str, now: datetime | None = None) -> int:
    """Return a stable token for the latest fully completed UTC candle."""
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    seconds = max(1, frequency_seconds(frequency))
    return int(current.timestamp()) // seconds - 1


def load_live_frequency_frames(
    *,
    service: StrategyV2BacktestService,
    candidates: list[dict[str, object]],
    manifest: StrategyManifest,
    end_date: datetime,
    warn: Callable[[str], None] | None = None,
) -> dict[str, dict[str, pd.DataFrame]]:
    """Load a complete live frame bundle for all declared strategy timeframes."""
    start_dates = {
        frequency: end_date
        - timedelta(days=live_history_days(frequency, manifest.warmup_bars))
        for frequency in manifest.frequencies
    }
    bundles, skipped = service.fetch_frequency_frames(
        candidates,
        manifest.frequencies,
        start_dates,
        end_date,
    )
    driving_frequency = manifest.driving_frequency
    driving_frames = bundles.get(driving_frequency, {})
    if not driving_frames:
        structured = [
            item.get("market_data_error")
            for item in skipped
            if isinstance(item.get("market_data_error"), dict)
        ]
        priority = {
            "region_restricted": 0,
            "proxy_failure": 1,
            "symbol_not_found": 2,
            "unsupported_timeframe": 3,
            "rate_limited": 4,
            "exchange_unavailable": 5,
            "no_market_data": 6,
        }
        if structured:
            selected = min(
                structured,
                key=lambda value: priority.get(str(value.get("code") or ""), 99),
            )
            raise MarketDataUnavailableError(MarketDataFailure.from_mapping(selected))
        detail = "; ".join(str(item.get("reason") or "") for item in skipped[:3])
        raise MarketDataUnavailableError(
            classify_market_data_failure(
                detail or "No usable market data",
                symbol=str(candidates[0].get("symbol") or "") if candidates else "",
                timeframe=driving_frequency,
            )
        )

    if skipped and warn:
        details = ", ".join(
            f"{item.get('symbol') or '?'}@{item.get('frequency') or '?'}:"
            f"{item.get('reason') or 'unavailable'}"
            for item in skipped[:5]
        )
        suffix = f" ({details})" if details else ""
        warn(
            f"Skipped {len(skipped)} instrument/timeframe data source(s)"
            f" without usable market data{suffix}"
        )

    if manifest.fundamental_dependencies:
        driving_frames = get_fundamental_data_service().enrich_panel(
            driving_frames,
            candidates,
        )
        bundles[driving_frequency] = driving_frames
        service.validate_fundamental_dependencies(driving_frames, manifest)
    return bundles


__all__ = ["completed_bar_token", "live_history_days", "load_live_frequency_frames"]
