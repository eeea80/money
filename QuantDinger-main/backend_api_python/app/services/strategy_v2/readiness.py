"""Actionable, point-in-time checks before strategy execution."""
import pandas as pd

from .contract import StrategyV2ContractError


def validate_universe_history(universe, start_date):
    metadata = universe.get("metadata") or {}
    earliest = universe.get("history_from") or metadata.get("snapshot_as_of")
    if metadata.get("snapshot_only") and earliest:
        if pd.Timestamp(start_date).date() < pd.Timestamp(earliest).date():
            raise StrategyV2ContractError(
                f"strategyV2.universeHistoryUnavailable:{universe.get('code')}:{earliest}"
            )


def validate_warmup(frequency_frames, warmup_bars, start_date, members=()):
    if warmup_bars <= 0:
        return
    start = pd.Timestamp(start_date)
    start = start.tz_localize("UTC") if start.tzinfo is None else start.tz_convert("UTC")
    joined = {item.get("key"): item.get("valid_from") for item in members}
    problems = []
    for frequency, frames in frequency_frames.items():
        for symbol, frame in frames.items():
            first_active = start
            if joined.get(symbol):
                first_active = max(start, pd.Timestamp(joined[symbol], tz="UTC"))
            index = pd.to_datetime(frame.index, utc=True)
            usable = frame.reindex(columns=["open", "high", "low", "close"]).apply(pd.to_numeric, errors="coerce")
            count = int(((index < first_active) & usable.notna().all(axis=1) & (usable > 0).all(axis=1)).sum())
            if count < warmup_bars:
                problems.append(f"{symbol}@{frequency}={count}/{warmup_bars}")
    if problems:
        raise StrategyV2ContractError("strategyV2.insufficientWarmupData:" + ";".join(problems[:6]))


def validate_fundamentals(frames, required, as_of=None):
    problems = []
    for symbol, frame in frames.items():
        visible = frame
        if as_of is not None:
            visible = frame.loc[pd.to_datetime(frame.index, utc=True) <= pd.to_datetime(as_of, utc=True)]
        for field in sorted(required):
            values = pd.to_numeric(visible[field], errors="coerce") if field in visible else pd.Series(dtype=float)
            if not values.replace([float("inf"), -float("inf")], float("nan")).notna().any():
                problems.append(f"{symbol}/{field}")
    if problems:
        raise StrategyV2ContractError("strategyV2.fundamentalDataMissing:" + ";".join(problems[:6]))
