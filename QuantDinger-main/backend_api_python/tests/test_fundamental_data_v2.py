import sys
import types

import pandas as pd
import pytest

from app.services.fundamental_data import FUNDAMENTAL_FIELDS, FundamentalDataService, _availability_date


def _install_collector(monkeypatch, payload):
    class FakeMarketDataCollector:
        def _fetch_fundamental_uncached(self, *_args):
            return payload

    module = types.ModuleType("app.services.market_data_collector")
    module.MarketDataCollector = FakeMarketDataCollector
    monkeypatch.setitem(sys.modules, "app.services.market_data_collector", module)


def test_sync_current_persists_real_provider_values(monkeypatch):
    provider_payload = {
        "market_cap": 3_000_000_000_000,
        "pe_ratio": 31.5,
        "pb_ratio": 47.2,
        "shares_outstanding": 15_500_000_000,
        "source": "provider-test",
        "financial_statements": {
            "income_statement": {
                "latest_date": "2026-06-30",
                "total_revenue": 1000,
                "net_income": 250,
            },
            "balance_sheet": {"total_equity": 400, "debt": 50},
            "cash_flow": {"free_cash_flow": 200},
        },
    }
    _install_collector(monkeypatch, provider_payload)
    persisted = {}
    service = FundamentalDataService()
    monkeypatch.setattr(service, "upsert", lambda payload: persisted.update(payload))

    result = service.sync_current(market="USStock", symbol="aapl")

    assert result["symbol"] == "AAPL"
    assert result["source"] == "provider-test"
    assert result["market_cap"] == 3_000_000_000_000.0
    assert result["revenue"] == 1000.0
    assert result["net_income"] == 250.0
    assert result["shareholder_equity"] == 400.0
    assert result["metadata"]["analysisPayload"]["financial_statements"] == provider_payload["financial_statements"]
    assert persisted == result


def test_sync_current_rejects_empty_provider_result(monkeypatch):
    _install_collector(monkeypatch, {})

    with pytest.raises(ValueError, match="factor.fundamentalDataUnavailable"):
        FundamentalDataService().sync_current(market="USStock", symbol="AAPL")


def test_sync_current_rejects_unsupported_market():
    with pytest.raises(ValueError, match="factor.fundamentalMarketUnsupported"):
        FundamentalDataService().sync_current(market="Crypto", symbol="BTC/USDT")


def test_sync_history_persists_reported_quarters_with_point_in_time_dates(monkeypatch):
    periods = pd.to_datetime(["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31"])

    class FakeTicker:
        quarterly_income_stmt = pd.DataFrame(
            [
                [100, 110, 120, 130, 140],
                [10, 11, 12, 13, 14],
                [50, 50, 50, 50, 50],
            ],
            index=["Total Revenue", "Net Income", "Diluted Average Shares"],
            columns=periods,
        )
        quarterly_balance_sheet = pd.DataFrame(
            [
                [200, 210, 220, 230, 240],
                [40, 41, 42, 43, 44],
                [50, 50, 50, 50, 50],
            ],
            index=["Stockholders Equity", "Total Debt", "Ordinary Shares Number"],
            columns=periods,
        )
        quarterly_cash_flow = pd.DataFrame(
            [[8, 9, 10, 11, 12]],
            index=["Free Cash Flow"],
            columns=periods,
        )

        @staticmethod
        def get_earnings_dates(limit=32):
            del limit
            index = pd.to_datetime([
                "2025-05-01 16:00:00-04:00",
                "2025-07-31 16:00:00-04:00",
                "2025-10-30 16:00:00-04:00",
                "2026-01-29 16:00:00-05:00",
                "2026-04-30 16:00:00-04:00",
            ], utc=True)
            return pd.DataFrame({"Reported EPS": [1, 1, 1, 1, 1]}, index=index)

        @staticmethod
        def history(**_kwargs):
            return pd.DataFrame(
                {"Close": [10, 11, 12, 13, 14]},
                index=pd.to_datetime(["2025-05-01", "2025-07-31", "2025-10-30", "2026-01-29", "2026-04-30"]),
            )

    yfinance_module = types.ModuleType("yfinance")
    yfinance_module.Ticker = lambda _symbol: FakeTicker()
    monkeypatch.setitem(sys.modules, "yfinance", yfinance_module)
    persisted = []
    service = FundamentalDataService()
    monkeypatch.setattr(service, "upsert", lambda payload: persisted.append(payload))

    result = service.sync_history(market="USStock", symbol="aapl")

    assert result["observations"] == 5
    assert persisted[0]["available_at"].isoformat() == "2025-05-02"
    assert persisted[-1]["market_cap"] == 700.0
    assert persisted[-1]["revenue_growth"] == pytest.approx(0.4)
    assert persisted[2]["net_income_ttm"] is None
    assert persisted[3]["net_income_ttm"] == 46
    assert persisted[4]["net_income_ttm"] == 50
    assert persisted[-1]["pe_ratio"] == pytest.approx(14)
    assert persisted[-1]["pb_ratio"] == pytest.approx(700 / 240)
    assert set(FUNDAMENTAL_FIELDS).issubset(persisted[-1])
    assert persisted[-1]["metadata"]["pointInTime"] is True


def test_sync_history_uses_safe_fallback_when_earnings_calendar_is_unavailable(monkeypatch):
    period = pd.Timestamp("2026-03-31")

    class FakeTicker:
        quarterly_income_stmt = pd.DataFrame([[100], [10]], index=["Total Revenue", "Net Income"], columns=[period])
        quarterly_balance_sheet = pd.DataFrame([[50], [10]], index=["Stockholders Equity", "Ordinary Shares Number"], columns=[period])
        quarterly_cash_flow = pd.DataFrame([[8]], index=["Free Cash Flow"], columns=[period])

        @staticmethod
        def get_earnings_dates(limit=32):
            del limit
            return pd.DataFrame()

        @staticmethod
        def history(**_kwargs):
            return pd.DataFrame({"Close": [20]}, index=pd.to_datetime(["2026-07-01"]))

    yfinance_module = types.ModuleType("yfinance")
    yfinance_module.Ticker = lambda _symbol: FakeTicker()
    monkeypatch.setitem(sys.modules, "yfinance", yfinance_module)
    persisted = []
    service = FundamentalDataService()
    monkeypatch.setattr(service, "upsert", lambda payload: persisted.append(payload))

    result = service.sync_history(market="USStock", symbol="TEST")

    assert result["observations"] == 1
    assert persisted[0]["available_at"].isoformat() == "2026-06-30"
    assert persisted[0]["metadata"]["availabilitySource"] == "conservative_91_day_lag"


def test_recent_report_without_calendar_uses_observation_date():
    available_at, source = _availability_date(pd.Timestamp.today().normalize() - pd.Timedelta(days=10), [])
    assert available_at == pd.Timestamp.today().date()
    assert source == "observed_at_sync"
