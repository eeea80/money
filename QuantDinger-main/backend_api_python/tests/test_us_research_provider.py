from types import SimpleNamespace

import pandas as pd
import pytest

from app.data_providers import us_research


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


def test_sec_research_normalizes_filings_and_does_not_infer_form4_direction(monkeypatch):
    monkeypatch.setattr(us_research, "get_cached", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(us_research, "set_cached", lambda *_args, **_kwargs: None)

    def fake_get(url, **_kwargs):
        if url.endswith("company_tickers.json"):
            return FakeResponse({"0": {"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc."}})
        assert url.endswith("CIK0000320193.json")
        return FakeResponse({
            "name": "Apple Inc.",
            "filings": {"recent": {
                "form": ["8-K", "4", "10-Q"],
                "filingDate": ["2026-09-07", "2026-09-06", "2026-08-01"],
                "reportDate": ["2026-09-07", "", "2026-06-30"],
                "accessionNumber": ["0000320193-26-000001", "0000320193-26-000002", "0000320193-26-000003"],
                "primaryDocument": ["a8k.htm", "form4.xml", "a10q.htm"],
                "primaryDocDescription": ["Current report", "Ownership", "Quarterly report"],
            }},
        })

    result = us_research.fetch_sec_research("AAPL", http_get=fake_get)

    assert result["identity"]["cik"] == "0000320193"
    assert [item["form"] for item in result["sec_filings"]] == ["8-K", "10-Q"]
    assert result["sec_filings"][0]["url"].endswith("/000032019326000001/a8k.htm")
    assert result["insider_activity"]["recent_form4_filing_count"] == 1
    assert result["insider_activity"]["scope"] == "form4_filing_activity_not_trade_direction"
    assert "direction" not in result["insider_activity"]


class FakeTicker:
    info = {
        "currentPrice": 200,
        "recommendationKey": "buy",
        "recommendationMean": 1.8,
        "numberOfAnalystOpinions": 40,
        "targetMedianPrice": 240,
        "targetMeanPrice": 242,
        "targetLowPrice": 180,
        "targetHighPrice": 300,
        "sharesShort": 10_000,
        "sharesShortPriorMonth": 9_000,
        "shortPercentOfFloat": 0.0125,
        "shortRatio": 1.75,
        "dateShortInterest": 1_788_739_200,
    }
    options = ("2026-09-18",)

    def option_chain(self, expiry):
        assert expiry == "2026-09-18"
        calls = pd.DataFrame([
            {"strike": 195, "volume": 100, "openInterest": 1000, "impliedVolatility": 0.25},
            {"strike": 200, "volume": 200, "openInterest": 2000, "impliedVolatility": 0.20},
        ])
        puts = pd.DataFrame([
            {"strike": 200, "volume": 150, "openInterest": 1200, "impliedVolatility": 0.22},
            {"strike": 205, "volume": 50, "openInterest": 800, "impliedVolatility": 0.26},
        ])
        return SimpleNamespace(calls=calls, puts=puts)


class FakeYahoo:
    @staticmethod
    def Ticker(symbol):
        assert symbol == "AAPL"
        return FakeTicker()


def test_yahoo_research_labels_consensus_options_and_short_interest_scope():
    result = us_research.fetch_yahoo_us_research("AAPL", yf_client=FakeYahoo)

    assert result["analyst_expectations"]["target_price_median_usd"] == 240
    assert result["options"]["put_call_volume_ratio"] == 200 / 300
    assert result["options"]["nearest_atm_implied_volatility_pct"] == pytest.approx(21)
    assert result["options"]["scope"] == "nearest_expiry_snapshot"
    assert result["short_interest"]["short_percent_of_float_pct"] == 1.25
    assert result["short_interest"]["scope"] == "reported_short_interest_not_daily_short_volume"


def test_nearest_atm_iv_ignores_yahoo_placeholder_values():
    calls = pd.DataFrame([
        {"strike": 200, "impliedVolatility": 0.00001},
        {"strike": 205, "impliedVolatility": 0.24},
    ])
    puts = pd.DataFrame([
        {"strike": 200, "impliedVolatility": 0.00001},
        {"strike": 195, "impliedVolatility": 0.22},
    ])

    assert us_research._nearest_atm_iv(calls, puts, 200) == pytest.approx(23)
