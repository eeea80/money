from app.services.backtest_execution import (
    default_commission_if_missing,
    default_slippage_if_missing,
)


def test_default_slippage_if_missing():
    assert default_slippage_if_missing(None) == 0.0005
    assert default_slippage_if_missing('') == 0.0005
    assert default_slippage_if_missing(0.001) == 0.001


def test_default_commission_if_missing():
    assert default_commission_if_missing(None) == 0.0005
    assert default_commission_if_missing('') == 0.0005
    assert default_commission_if_missing(0) == 0.0
    assert default_commission_if_missing(0.001) == 0.001
