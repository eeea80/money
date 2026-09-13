"""Bound historical chart payloads without discarding key risk observations."""

from __future__ import annotations

import math
from typing import Any


def sample_equity_curve(items: list[dict[str, Any]], limit: int, initial: float) -> list[dict[str, Any]]:
    """Preserve endpoints, extrema, maximum drawdown and the insolvency boundary."""
    if len(items) <= limit:
        return list(items)
    if limit < 10:
        raise ValueError("Equity curve sampling requires at least ten points")

    required = {0, len(items) - 1}
    peak, peak_index = initial, 0
    worst, worst_pair = 0.0, (0, 0)
    low, high = math.inf, -math.inf
    low_index = high_index = 0
    saved_worst, saved_index = 0.0, 0
    first_insolvent = None
    for index, item in enumerate(items):
        value = float(item["value"])
        if not math.isfinite(value):
            continue
        if value < low:
            low, low_index = value, index
        if value > high:
            high, high_index = value, index
        if peak <= 0 or value > peak:
            peak, peak_index = value, index
        drawdown = (value / peak - 1.0) * 100.0 if peak > 0 else 0.0
        if drawdown < worst:
            worst, worst_pair = drawdown, (peak_index, index)
        saved = item.get("drawdown")
        if saved is not None and float(saved) < saved_worst:
            saved_worst, saved_index = float(saved), index
        if value <= 0 and first_insolvent is None:
            first_insolvent = index

    required.update((*worst_pair, low_index, high_index, saved_index))
    if first_insolvent is not None:
        required.update((max(0, first_insolvent - 1), first_insolvent))
    candidates = [index for index in range(len(items)) if index not in required]
    slots = limit - len(required)
    step = (len(candidates) - 1) / (slots - 1)
    required.update(candidates[round(index * step)] for index in range(slots))
    return [items[index] for index in sorted(required)]
