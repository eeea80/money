import pandas as pd
import pytest

from app.services.fast_analysis import FastAnalysisService
from app.services.fast_analysis_fundamentals import format_fundamental_metric
from app.services.market_data_collector import MarketDataCollector


def _frame(rows, index, columns):
    return pd.DataFrame(rows, index=index, columns=pd.to_datetime(columns))


class FakeTicker:
    info = {
        "symbol": "TEST",
        "longName": "Test Corporation",
        "exchange": "NMS",
        "quoteType": "EQUITY",
        "industry": "Aerospace & Defense",
        "sector": "Industrials",
        "financialCurrency": "USD",
        "marketCap": 3_000_000_000,
        "returnOnEquity": 0.12,
        "profitMargins": -0.05,
        "debtToEquity": 50.0,
        "currentRatio": 1.25,
    }
    quarter_columns = ["2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30"]
    quarterly_income_stmt = _frame(
        [
            [100, 110, 120, 130, 150],
            [25, 27, 30, 34, 40],
            [5, 6, 7, 8, 10],
            [-10, -8, -6, -4, -5],
            [-0.10, -0.08, -0.06, -0.04, -0.05],
        ],
        ["Total Revenue", "Gross Profit", "Operating Income", "Net Income", "Diluted EPS"],
        quarter_columns,
    )
    quarterly_balance_sheet = _frame(
        [
            [500, 600, 700, 800, 900],
            [200, 220, 240, 260, 280],
            [250, 300, 350, 400, 450],
            [100, 120, 140, 160, 180],
            [50, 55, 60, 65, 70],
            [300, 340, 380, 420, 460],
            [100, 110, 120, 130, 140],
        ],
        [
            "Total Assets",
            "Total Liabilities Net Minority Interest",
            "Stockholders Equity",
            "Cash And Cash Equivalents",
            "Total Debt",
            "Current Assets",
            "Current Liabilities",
        ],
        quarter_columns,
    )
    quarterly_cash_flow = _frame(
        [
            [10, 11, 12, 13, 14],
            [-4, -4, -5, -5, -6],
            [2, 2, 3, 3, 4],
            [6, 7, 7, 8, 8],
        ],
        ["Operating Cash Flow", "Capital Expenditure", "Financing Cash Flow", "Free Cash Flow"],
        quarter_columns,
    )
    annual_columns = ["2024-12-31", "2025-12-31"]
    financials = _frame(
        [[350, 460], [20, 30], [-30, -20], [-0.30, -0.20]],
        ["Total Revenue", "Operating Income", "Net Income", "Diluted EPS"],
        annual_columns,
    )
    balance_sheet = _frame(
        [[650, 760], [230, 250], [320, 380], [58, 62], [360, 400], [115, 125]],
        ["Total Assets", "Total Liabilities Net Minority Interest", "Stockholders Equity", "Total Debt", "Current Assets", "Current Liabilities"],
        annual_columns,
    )
    cashflow = _frame(
        [[38, 46], [-16, -20], [22, 26]],
        ["Operating Cash Flow", "Capital Expenditure", "Free Cash Flow"],
        annual_columns,
    )
    calendar = pd.DataFrame()


def _collector(monkeypatch):
    monkeypatch.setattr("app.services.market_data_collector.yf.Ticker", lambda _symbol: FakeTicker())
    collector = MarketDataCollector.__new__(MarketDataCollector)
    collector._finnhub_client = None
    return collector


def test_us_fundamentals_separate_latest_quarter_ttm_and_annual(monkeypatch):
    result = _collector(monkeypatch)._get_us_fundamental("TEST")

    statements = result["financial_statements"]
    assert statements["latest_quarter"]["period_end"] == "2026-06-30"
    assert statements["latest_quarter"]["income_statement"]["total_revenue"] == 150
    assert statements["latest_quarter"]["derived"]["revenue_growth"] == pytest.approx(50.0)
    assert statements["ttm"]["income_statement"]["total_revenue"] == 510
    assert statements["latest_annual"]["period_end"] == "2025-12-31"
    assert statements["latest_annual"]["income_statement"]["total_revenue"] == 460
    assert statements["income_statement"]["period_type"] == "quarterly"
    assert result["roe"] == pytest.approx(12.0)
    assert result["debt_to_equity"] == pytest.approx(0.5)
    assert result["identity"]["verified"] is True
    assert result["identity"]["industry"] == "Aerospace & Defense"
    assert result["data_quality"]["preferred_basis"] == "latest_reported_quarter"


def test_prompt_labels_financial_periods_and_warns_against_mixing(monkeypatch):
    result = _collector(monkeypatch)._get_us_fundamental("TEST")
    service = FastAnalysisService.__new__(FastAnalysisService)

    text = service._format_financial_statements(result["financial_statements"])

    assert "LATEST REPORTED QUARTER | period_end=2026-06-30" in text
    assert "TTM THROUGH 2026-06-30" in text
    assert "LATEST ANNUAL (STRUCTURAL CONTEXT ONLY) | period_end=2025-12-31" in text
    assert "do not combine quarterly, TTM and annual" in text


def test_top_level_metric_keeps_unit_period_and_source(monkeypatch):
    result = _collector(monkeypatch)._get_us_fundamental("TEST")

    rendered = format_fundamental_metric(result, "profit_margin")

    assert "percent" in rendered
    assert "ttm" in rendered
    assert "yfinance" in rendered


def test_fundamental_score_prefers_latest_quarter_derived_metrics():
    service = FastAnalysisService.__new__(FastAnalysisService)
    payload = {
        "pe_ratio": 30,
        "roe": -50,
        "revenue_growth": -50,
        "profit_margin": -50,
        "debt_to_equity": 5,
        "current_ratio": 0.5,
        "financial_statements": {
            "latest_quarter": {
                "derived": {
                    "revenue_growth": 30,
                    "profit_margin": 15,
                    "debt_to_equity": 0.3,
                    "current_ratio": 2.0,
                }
            },
            "ttm": {"derived": {"roe": 25}},
        },
    }

    assert service._calculate_fundamental_score(payload, "USStock") > 0


def test_mismatched_provider_identity_is_rejected(monkeypatch):
    class MismatchedTicker(FakeTicker):
        info = {**FakeTicker.info, "symbol": "OTHER"}

    monkeypatch.setattr("app.services.market_data_collector.yf.Ticker", lambda _symbol: MismatchedTicker())
    collector = MarketDataCollector.__new__(MarketDataCollector)
    collector._finnhub_client = None

    assert collector._get_us_fundamental("TEST") is None
