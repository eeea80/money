import pandas as pd
import pytest

from app.services.strategy_v2.data import MultiAssetDataPortal
from app.services.strategy_v2.runtime import _backtest_time_iso


def test_scalar_reads_follow_clock_phase_and_never_return_a_future_bar():
    index = pd.date_range("2026-01-01", periods=4, freq="15min")
    frame = pd.DataFrame({name: [10., 20., 30., 40.] for name in ("open", "high", "low", "close")}, index=index)
    portal = MultiAssetDataPortal({"USStock:AAPL": frame}, driving_frequency="15m")
    assert portal.current("AAPL") == 0
    for offset in [0, 2, 1, 3]:
        for include_current in [False, True, False]:
            portal.set_clock(index[offset], include_current=include_current)
            visible = portal.history("AAPL", count=1, fields=["close"])
            expected = float(visible["close"].iloc[-1]) if not visible.empty else 0
            assert portal.current("AAPL") == expected
            assert portal.current("AAPL", "missing", default=99) == 99
            if not visible.empty:
                visible.iloc[-1, 0] = -100
                assert portal.current("AAPL") == expected


def test_array_bar_reads_keep_execution_flags_and_do_not_fill_missing_bars():
    index = pd.DatetimeIndex(["2026-01-01", "2026-01-03"])
    frame = pd.DataFrame({name: [10., 20.] for name in ("open", "high", "low", "close")}, index=index)
    frame["suspended"] = [False, True]
    frame["limit_up"] = [True, False]
    frame["industry"] = ["tech", "finance"]
    portal = MultiAssetDataPortal({"USStock:AAPL": frame})
    assert portal.bar_at("AAPL", "2026-01-02") is None
    bar = portal.bar_at("AAPL", index[1])
    assert bool(bar["suspended"]) is True
    assert bool(bar["limit_up"]) is False
    assert bar["industry"] == "finance"
    assert bar["close"] == 20
    assert portal.bar_at("AAPL", index[0])["close"] == 10


@pytest.mark.parametrize("value", [
    "2026-01-01 12:34:56.999999999", "2026-01-01 12:34:56.999999999+08:00",
    "1969-12-31 23:59:59.999999999", "2026-01-01T04:34:56Z",
])
def test_cached_time_serialization_keeps_utc_and_fractional_second_semantics(value):
    timestamp = pd.Timestamp(value)
    utc = timestamp.tz_localize("UTC") if timestamp.tzinfo is None else timestamp.tz_convert("UTC")
    expected = utc.floor("s").isoformat().replace("+00:00", "Z")
    assert _backtest_time_iso(value) == expected
    assert _backtest_time_iso(timestamp) == expected
