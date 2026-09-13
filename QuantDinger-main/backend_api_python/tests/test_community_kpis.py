import json

from app.services.community_kpis import summarise_backtest_runs


def test_summary_reads_strategy_v2_annualized_return():
    summary = summarise_backtest_runs([
        {
            "id": 7,
            "symbol": "BTC/USDT",
            "timeframe": "1m",
            "result_json": json.dumps({
                "totalReturn": 0.94,
                "annualizedReturn": 12.07,
                "sharpeRatio": 1.79,
                "maxDrawdown": -1.62,
                "totalTrades": 8,
            }),
        }
    ])

    assert summary["total_return"] == 0.94
    assert summary["annual_return"] == 12.07


def test_summary_keeps_legacy_annual_return_fields_compatible():
    camel_case = summarise_backtest_runs([
        {"id": 1, "result_json": json.dumps({"annualReturn": 8.5})}
    ])
    snake_case = summarise_backtest_runs([
        {"id": 2, "result_json": json.dumps({"annual_return": 6.25})}
    ])

    assert camel_case["annual_return"] == 8.5
    assert snake_case["annual_return"] == 6.25


def test_summary_separates_profit_factor_from_payoff_ratio():
    summary = summarise_backtest_runs([
        {
            "id": 25,
            "result_json": json.dumps({
                "totalTrades": 89,
                "profitFactor": 1020.950291,
                "profitLossRatio": 11.601708,
                "winningTrades": 88,
                "losingTrades": 1,
            }),
        }
    ])

    assert summary["profit_factor"] == 1020.95
    assert summary["profit_loss_ratio"] == 11.6
    assert summary["winning_trades"] == 88
    assert summary["losing_trades"] == 1


def test_summary_derives_payoff_ratio_from_average_trade_fields():
    summary = summarise_backtest_runs([
        {
            "id": 26,
            "result_json": json.dumps({
                "totalTrades": 4,
                "avgWin": 6.0,
                "avgLoss": -2.0,
            }),
        }
    ])

    assert summary["profit_loss_ratio"] == 3.0
