import json
import math
from pathlib import Path

import pandas as pd
import pytest

from app.services.factors import FactorError, compute_factor


def reference_frame(kind):
    prices = [100. + (i % 13) * .7 - (i % 7) * .4 + i * .03 for i in range(96)]
    if kind == "flat":
        prices = [100.] * 96
    if kind == "gaps":
        prices = [p + (12 if i % 19 < 4 else -8) for i, p in enumerate(prices)]
    frame = pd.DataFrame({
        "open": prices, "high": [p + 1 for p in prices], "low": [p - 1 for p in prices],
        "close": prices, "volume": [1000.] * 96,
    }, index=pd.date_range("2026-01-01", periods=96))
    if kind == "nan":
        frame.iloc[[12, 28, 48], frame.columns.get_loc("close")] = float("nan")
        frame.iloc[[9, 15], frame.columns.get_loc("high")] = float("nan")
    if kind == "inf":
        frame.iloc[25, frame.columns.get_loc("high")] = float("inf")
        frame.iloc[30, frame.columns.get_loc("low")] = -float("inf")
    return frame


REFERENCE = Path(__file__).parent / "fixtures/recursive_factor_reference.json"
CASES = json.loads(REFERENCE.read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("case", CASES, ids=lambda c: f'{c["kind"]}-{c["factor"]}-{c["params"].get("output", "default")}')
def test_recursive_factors_match_previous_revision_on_every_visible_prefix(case):
    frame = reference_frame(case["kind"])
    for length, expected in case["prefixes"].items():
        try:
            value = compute_factor(case["factor"], frame.iloc[:int(length)], case["params"])
            actual = {"value": value if math.isfinite(value) else None}
        except FactorError as exc:
            actual = {"error": exc.code}
        assert actual == expected, (case, length, actual)
