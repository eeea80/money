"""Unit tests for the risk manager — sizing, daily cap, drawdown throttle,
and the no-martingale guarantee."""

import pytest

from omni_trader.risk import (
    DRAWDOWN_TIERS,
    DAILY_LOSS_CAP,
    RISK_PER_TRADE,
    RiskManager,
    RiskMode,
)


# ---------------------------------------------------------------- sizing
def test_risk_per_trade_by_mode():
    assert RISK_PER_TRADE[RiskMode.CONSERVATIVE] == pytest.approx(0.005)
    assert RISK_PER_TRADE[RiskMode.BALANCED] == pytest.approx(0.01)
    assert RISK_PER_TRADE[RiskMode.AGGRESSIVE] == pytest.approx(0.02)


@pytest.mark.parametrize("mode,pct", [
    ("conservative", 0.005), ("balanced", 0.01), ("aggressive", 0.02),
])
def test_position_size_fixed_fraction(mode, pct):
    rm = RiskManager(10_000, mode)
    # risk 1% of 10k = 100; stop distance 50 -> size 2.0
    size = rm.position_size(entry_price=30_000, stop_distance=50.0)
    assert size == pytest.approx(10_000 * pct / 50.0)


def test_position_size_invalid_inputs_return_zero():
    rm = RiskManager(10_000, "balanced")
    assert rm.position_size(0, 10) == 0.0
    assert rm.position_size(100, 0) == 0.0
    assert rm.position_size(-5, 10) == 0.0


def test_size_shrinks_as_equity_shrinks():
    rm = RiskManager(10_000, "balanced")
    s1 = rm.position_size(100, 1)
    rm.on_trade_closed(-1_000)  # equity 9000
    s2 = rm.position_size(100, 1)
    assert s2 < s1  # never increases after a loss


# ---------------------------------------------------------------- daily cap
def test_daily_loss_cap_halts_trading():
    rm = RiskManager(10_000, "balanced")  # cap 3% = 300
    assert rm.can_trade()
    rm.on_trade_closed(-200)
    assert rm.can_trade()
    rm.on_trade_closed(-150)  # daily -350 <= -300
    st = rm.status()
    assert st.halted is True
    assert rm.can_trade() is False
    assert rm.position_size(100, 1) == 0.0  # refuses while halted


def test_daily_cap_respects_mode_thresholds():
    for mode, cap in DAILY_LOSS_CAP.items():
        rm = RiskManager(1_000, mode)
        rm.on_trade_closed(-1_000 * cap)
        assert rm.status().halted is True, mode


def test_halt_lifts_next_day():
    rm = RiskManager(10_000, "balanced")
    rm.on_trade_closed(-10_000 * DAILY_LOSS_CAP[RiskMode.BALANCED])
    assert rm.status().halted
    # simulate UTC day rollover
    rm.state.day_key = "2000-01-01"
    assert rm.can_trade() is True
    assert rm.state.daily_pnl == 0.0


# ---------------------------------------------------------------- throttle
def _tiers():
    return DRAWDOWN_TIERS


def test_throttle_full_size_when_no_drawdown():
    rm = RiskManager(10_000, "aggressive")
    assert rm.status().throttle == pytest.approx(1.0)


def test_throttle_steps_down_with_drawdown():
    rm = RiskManager(10_000, "aggressive")
    rm.on_trade_closed(-600)  # dd 6% -> tier 0.70
    assert rm.status().throttle == pytest.approx(0.70)
    rm.on_trade_closed(-1_000)  # equity 8400 -> dd 16% -> tier 0.25
    assert rm.status().throttle == pytest.approx(0.25)


def test_throttle_never_recovers_intraday_ratchet():
    """No martingale: throttle must not increase back after losses, even if
    equity partially recovers (peak-based dd unchanged) or via repeated calls."""
    rm = RiskManager(10_000, "balanced")
    rm.on_trade_closed(-1_600)  # dd 16% -> 0.25
    assert rm.status().throttle == pytest.approx(0.25)
    for _ in range(5):  # repeated status calls never raise it
        assert rm.status().throttle == pytest.approx(0.25)
    rm.on_trade_closed(200)  # small win: equity up but still underwater
    assert rm.status().throttle <= 0.25


def test_throttle_reflected_in_position_size():
    rm = RiskManager(10_000, "balanced")
    base = rm.position_size(100, 1)  # 100 * 1.0 / 1
    rm.on_trade_closed(1_000)        # equity 11k, new peak
    rm.on_trade_closed(-700)         # dd 6.36% -> tier 0.70; daily +300, cap not hit
    throttled = rm.position_size(100, 1)
    assert throttled == pytest.approx((10_300 * 0.01 * 0.70) / 1.0)
    assert throttled < base


def test_drawdown_matches_peak_logic():
    rm = RiskManager(10_000, "balanced")
    assert rm.drawdown() == pytest.approx(0.0)
    rm.on_trade_closed(1_000)   # new peak 11k
    rm.on_trade_closed(-2_200)  # equity 8.8k, dd = 2200/11000 = 20%
    assert rm.drawdown() == pytest.approx(0.20)


def test_tiers_are_monotonic():
    thresholds = [t for t, _ in _tiers()]
    mults = [m for _, m in _tiers()]
    assert thresholds == sorted(thresholds)
    assert mults == sorted(mults, reverse=True)
    assert _tiers()[-1][0] == float("inf")


# ---------------------------------------------------------------- misc
def test_invalid_mode_rejected():
    with pytest.raises(ValueError):
        RiskManager(10_000, "yolo")


def test_invalid_equity_rejected():
    with pytest.raises(ValueError):
        RiskManager(0, "balanced")
    with pytest.raises(ValueError):
        RiskManager(-5, "balanced")


def test_mode_switch_changes_sizing():
    rm = RiskManager(10_000, "conservative")
    s_c = rm.position_size(100, 1)
    rm.mode = RiskMode.AGGRESSIVE
    s_a = rm.position_size(100, 1)
    assert s_a == pytest.approx(s_c * 4)  # 2% vs 0.5%
