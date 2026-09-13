import pandas as pd
import pytest

from app.services.strategy_v2.factor_research import FactorResearchEngine


def test_factor_research_returns_ic_groups_costs_and_stability():
    index = pd.date_range("2025-01-01", periods=90, freq="B")
    frames = {}
    for offset, symbol in enumerate(["A", "B", "C", "D", "E", "F"]):
        prices = [100 + offset * 3 + day * (0.1 + offset * 0.02) for day in range(len(index))]
        frames[f"USStock:{symbol}"] = pd.DataFrame({
            "open": prices,
            "high": [value * 1.01 for value in prices],
            "low": [value * 0.99 for value in prices],
            "close": prices,
            "volume": [100000] * len(index),
            "industry": ["Tech" if offset < 3 else "Finance"] * len(index),
        }, index=index)

    result = FactorResearchEngine().run(
        frames=frames,
        factor_id="momentum_20",
        start_date=index[0],
        end_date=index[-1],
        groups=3,
        holding_period=5,
        commission=0.0005,
        slippage=0.0005,
        neutralize_industry=True,
    )

    assert result["icSeries"]
    assert len(result["groupCurves"]) == 3
    assert result["coverage"] > 0
    assert result["missingRate"] < 1
    assert result["neutralized"] is True
    assert result["factorCorrelation"]["factors"]
    assert "rankAutocorrelation" in result["stability"]


def test_factor_research_rejects_empty_cross_sectional_observations():
    index = pd.date_range("2025-01-01", periods=30, freq="B")
    frames = {
        f"USStock:{symbol}": pd.DataFrame({
            "open": [100.0] * len(index),
            "close": [100.0] * len(index),
        }, index=index)
        for symbol in ["A", "B", "C"]
    }

    with pytest.raises(ValueError, match="factorResearchInsufficientObservations"):
        FactorResearchEngine().run(
            frames=frames,
            factor_id="quality",
            start_date=index[0],
            end_date=index[-1],
            groups=3,
        )
