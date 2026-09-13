"""Normalize Gate spot order fills; ``fill_price`` is quote turnover, not price.

Contract: https://www.gate.com/docs/developers/apiv4/en/spot/
"""

from math import isfinite
from typing import Any, Mapping, Tuple


def _positive(data: Mapping[str, Any], *keys: str) -> float:
    for key in keys:
        try:
            value = float(data.get(key) or 0)
        except (TypeError, ValueError, OverflowError):
            continue
        if isfinite(value) and value > 0:
            return value
    return 0.0


def parse_gate_spot_fill(data: Mapping[str, Any]) -> Tuple[float, float]:
    """Return gross base quantity and actual cumulative average execution price."""
    base = _positive(data, "filled_amount", "filledAmount")
    quote = _positive(data, "filled_total", "filledTotal", "fill_price", "fillPrice")
    average = _positive(data, "avg_deal_price")
    if base <= 0 and "filled_amount" not in data and "filledAmount" not in data:
        if quote > 0 and average > 0:
            base = quote / average
        elif "left" in data and (
            data.get("type") == "limit"
            or (data.get("type") == "market" and data.get("side") == "sell")
        ):
            try:
                amount, left = float(data["amount"]), float(data["left"])
                if isfinite(amount) and isfinite(left) and 0 <= left <= amount:
                    base = amount - left
            except (KeyError, TypeError, ValueError, OverflowError):
                pass
    if base <= 0:
        return 0.0, 0.0
    if average <= 0 and quote > 0:
        average = quote / base
    return base, average
