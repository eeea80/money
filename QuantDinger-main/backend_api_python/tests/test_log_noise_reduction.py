from app.data_sources import asia_stock_kline
from app.data_sources.factory import DataSourceFactory


def test_market_aliases_map_ashare_hshare_to_supported_sources():
    assert DataSourceFactory.normalize_market("AShare") == "CNStock"
    assert DataSourceFactory.normalize_market("a_share") == "CNStock"
    assert DataSourceFactory.normalize_market("HShare") == "HKStock"
    assert DataSourceFactory.normalize_market("hk") == "HKStock"


def test_factory_duplicate_failures_are_rate_limited(monkeypatch):
    monkeypatch.setattr(DataSourceFactory, "_noise_seen", {})
    monkeypatch.setattr(DataSourceFactory, "_noise_interval_sec", 3600)

    DataSourceFactory._log_limited("error", "same-error", "Noisy failure: %s", "ABC")
    DataSourceFactory._log_limited("error", "same-error", "Noisy failure: %s", "ABC")

    _last_seen, suppressed = DataSourceFactory._noise_seen["same-error"]
    assert suppressed == 1


def test_twelvedata_daily_credit_limit_suppresses_later_requests(monkeypatch):
    calls = {"count": 0}

    class _Resp:
        def json(self):
            return {
                "status": "error",
                "code": 429,
                "message": "You have run out of API credits for the day.",
            }

    def fake_get(*args, **kwargs):
        calls["count"] += 1
        return _Resp()

    monkeypatch.setattr(asia_stock_kline, "_TD_DAILY_LIMIT_UNTIL", 0.0)
    monkeypatch.setattr(asia_stock_kline, "_get_twelve_data_api_key", lambda: "test-key")
    monkeypatch.setattr(asia_stock_kline.requests, "get", fake_get)

    out1 = asia_stock_kline.fetch_twelvedata_klines(
        is_hk=False,
        tencent_code="SZ300001",
        timeframe="1m",
        limit=10,
        before_time=None,
    )
    out2 = asia_stock_kline.fetch_twelvedata_klines(
        is_hk=False,
        tencent_code="SZ300002",
        timeframe="1m",
        limit=10,
        before_time=None,
    )

    assert out1 == []
    assert out2 == []
    assert calls["count"] == 1
