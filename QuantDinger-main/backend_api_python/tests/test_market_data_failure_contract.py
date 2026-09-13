from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.data_sources.errors import (
    MarketDataFailure,
    MarketDataUnavailableError,
    classify_market_data_failure,
)
from app.services.strategy_runtime.timeframes import load_live_frequency_frames
from app.services.strategy_v2.service import StrategyV2BacktestService
from app.utils.strategy_runtime_logs import format_market_data_log, parse_market_data_log


@pytest.mark.parametrize(
    ("detail", "expected"),
    [
        ("HTTP 451 Service unavailable from a restricted location", "region_restricted"),
        ("403 Forbidden: CloudFront is configured to block access from your country", "region_restricted"),
        ("ProxyError: tunnel connection failed", "proxy_failure"),
        ("binance does not have market symbol AVAX/USDT:USDT", "symbol_not_found"),
        ("HTTP 429 too many requests", "rate_limited"),
        ("Incomplete K-line coverage", "incomplete_market_data"),
        ("request timed out", "exchange_unavailable"),
    ],
)
def test_market_data_failure_classification(detail, expected):
    failure = classify_market_data_failure(
        detail,
        exchange_id="binance",
        market_type="spot",
        symbol="AVAX/USDT",
        timeframe="1m",
    )

    assert failure.code == expected
    assert failure.technical_detail == detail
    assert failure.exchange_id == "binance"


def test_market_data_strategy_log_round_trip():
    failure = MarketDataFailure(
        code="region_restricted",
        message="Region unavailable",
        technical_detail="HTTP 451",
        exchange_id="binance",
        market_type="spot",
        symbol="AVAX/USDT",
        timeframe="1m",
        retryable=False,
    )

    parsed = parse_market_data_log(format_market_data_log(failure))

    assert parsed == failure.as_dict()


def test_live_timeframe_loader_raises_structured_failure_when_all_frames_fail():
    failure = classify_market_data_failure(
        "HTTP 451 restricted location",
        exchange_id="binance",
        market_type="spot",
        symbol="AVAX/USDT",
        timeframe="1m",
    )
    service = SimpleNamespace(
        fetch_frequency_frames=lambda *_args: (
            {"1m": {}},
            [{
                "symbol": "Crypto:AVAX/USDT@binance:spot",
                "frequency": "1m",
                "reason": "marketData.region_restricted",
                "market_data_error": failure.as_dict(),
            }],
        )
    )
    manifest = SimpleNamespace(
        warmup_bars=30,
        frequencies=("1m",),
        driving_frequency="1m",
        fundamental_dependencies=(),
    )

    with pytest.raises(MarketDataUnavailableError) as raised:
        load_live_frequency_frames(
            service=service,
            candidates=[{"symbol": "AVAX/USDT"}],
            manifest=manifest,
            end_date=datetime.now(timezone.utc),
        )

    assert raised.value.failure.code == "region_restricted"
    assert raised.value.failure.technical_detail == "HTTP 451 restricted location"


def test_strategy_frame_batch_keeps_symbol_on_structured_fetch_failure():
    failure = classify_market_data_failure(
        "invalid symbol",
        exchange_id="binance",
        market_type="spot",
        symbol="MISSING/USDT",
        timeframe="1m",
    )

    def fail_fetch(*_args, **_kwargs):
        raise MarketDataUnavailableError(failure)

    service = StrategyV2BacktestService(
        repository=object(),
        universe_service=object(),
        frame_fetcher=fail_fetch,
        snapshot_store=object(),
        instrument_rules_provider=object(),
    )
    _frames, skipped = service.fetch_frames(
        [{"key": "Crypto:MISSING/USDT@binance:spot", "market": "Crypto", "symbol": "MISSING/USDT"}],
        "1m",
        datetime.now(timezone.utc),
        datetime.now(timezone.utc),
    )

    assert skipped[0]["symbol"] == "Crypto:MISSING/USDT@binance:spot"
    assert skipped[0]["market_data_error"]["code"] == "symbol_not_found"
