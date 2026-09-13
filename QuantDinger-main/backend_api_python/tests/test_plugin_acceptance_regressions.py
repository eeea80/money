from datetime import datetime
from types import SimpleNamespace

import pandas as pd
import pytest

from app.services.live_trading import factory
from app.services.strategy_v2 import StrategyV2ContractError
from app.services.strategy_v2.data import MultiAssetDataPortal
from app.services.strategy_v2.runtime import MultiAssetSimulationBroker, OrderIntent, Position
from app.services.strategy_v2.service import _validate_warmup_history
from app.services.strategy_v2.service import _warmup_calendar_days


@pytest.mark.parametrize("amount", [0.00823321, 0.00823319, 0.00000001, 0.12345678])
def test_integral_crypto_lots_do_not_lose_a_unit(amount):
    assert MultiAssetSimulationBroker._round_to_lot(amount, 1e-8) == pytest.approx(amount, abs=1e-15)
    assert MultiAssetSimulationBroker._round_to_lot(-amount, 1e-8) == pytest.approx(-amount, abs=1e-15)


def test_fractional_lot_still_rounds_down():
    assert MultiAssetSimulationBroker._round_to_lot(0.008233219, 1e-8) == pytest.approx(0.00823321)


def _broker(amount, price=100, volume=100000):
    symbol = "Crypto:BTC/USDT@spot"
    frame = pd.DataFrame({"open": [price], "high": [price], "low": [price], "close": [price], "volume": [volume]}, index=pd.date_range("2026-01-01", periods=1))
    portal = MultiAssetDataPortal({symbol: frame})
    portal.set_clock(frame.index[0], include_current=True)
    broker = MultiAssetSimulationBroker(initial_capital=1000, commission=0.001, slippage=0, instrument_rules={symbol: {"key": symbol, "exchange_id": "okx", "market_type": "spot", "symbol": "BTC/USDT", "amount_step": 0.1}})
    if amount:
        broker.portfolio.positions[symbol] = Position(symbol, amount=amount, avg_cost=price, last_price=price)
        broker.portfolio.available_cash -= amount * price
    return broker, portal, symbol, frame.index[0]


def test_spot_close_reconciles_small_remainder_with_cash_and_fees():
    broker, portal, symbol, timestamp = _broker(0.25)
    broker.execute([OrderIntent(symbol, "target_quantity", 0)], portal, timestamp)
    assert not broker.portfolio.positions
    assert broker.executions[-1]["quantity"] == pytest.approx(0.25)
    assert broker.portfolio.available_cash == pytest.approx(999.975)


def test_dust_tolerance_does_not_override_liquidity():
    broker, portal, symbol, timestamp = _broker(0.25, volume=1)
    broker.execute([OrderIntent(symbol, "target_quantity", 0)], portal, timestamp)
    assert broker.executions[-1]["quantity"] == pytest.approx(0.1)
    assert broker.portfolio.positions[symbol].amount == pytest.approx(0.15)


@pytest.mark.parametrize("difference,expected", [(0.099, 0), (0.1, 0), (0.101, 1)])
def test_target_rebalance_tolerance_boundary(difference, expected):
    broker, portal, symbol, timestamp = _broker(1)
    broker.execute([OrderIntent(symbol, "target_quantity", 1 + difference)], portal, timestamp)
    assert len(broker.executions) == expected


def test_small_new_position_is_not_suppressed():
    broker, portal, symbol, timestamp = _broker(0)
    broker.execute([OrderIntent(symbol, "target_quantity", 0.1)], portal, timestamp)
    assert len(broker.executions) == 1


def test_insufficient_hourly_history_cannot_report_success():
    frames = {"1h": {"USStock:NVDA": pd.DataFrame(index=pd.date_range("2026-09-10", periods=16, freq="h"))}}
    with pytest.raises(StrategyV2ContractError, match="insufficientWarmupData"):
        _validate_warmup_history(frames, 80, datetime(2026, 6, 13))


def test_backtest_service_rejects_truncated_data_before_running_or_persisting():
    from app.services.strategy_v2.service import StrategyV2BacktestService
    service = StrategyV2BacktestService.__new__(StrategyV2BacktestService)
    service.resolve_candidates = lambda **kwargs: ([{"key": "USStock:NVDA", "market": "USStock", "symbol": "NVDA"}], None)
    frames = {"1h": {"USStock:NVDA": pd.DataFrame(index=pd.date_range("2026-09-10", periods=16, freq="h"))}}
    service.fetch_frequency_frames = lambda *args: (frames, [])
    code = '''
def initialize(context):
    context.set_universe(["USStock:NVDA"])
    context.subscribe(frequency="1h")
    context.set_warmup(80)
def handle_data(context, data):
    pass
'''
    with pytest.raises(StrategyV2ContractError, match="insufficientWarmupData"):
        service.run(user_id=1, code=code, start_date=datetime(2026, 6, 13), end_date=datetime(2026, 9, 10), initial_capital=1000)


def test_stock_intraday_warmup_allows_closed_sessions():
    assert _warmup_calendar_days("1h", 80, [{"market": "USStock"}]) == 42
    assert _warmup_calendar_days("1h", 80, [{"market": "Crypto"}]) == 5
    assert _warmup_calendar_days("1m", 80, [{"market": "USStock"}]) == 7


def test_warmup_counts_only_prior_bars_and_checks_each_frequency():
    frames = {"1d": {"USStock:NVDA": pd.DataFrame(dict(open=100, high=101, low=99, close=100), index=pd.bdate_range("2026-01-01", periods=40, tz="UTC"))}}
    _validate_warmup_history(frames, 30, datetime(2026, 2, 12))
    with pytest.raises(StrategyV2ContractError, match="insufficientWarmupData"):
        _validate_warmup_history(frames, 31, datetime(2026, 2, 12))


@pytest.mark.parametrize("config,paper", [
    ({"environment": "demo", "paper": False}, True),
    ({"environment": "live", "paper": True}, False),
    ({"paper": True}, True),
    ({"enable_demo_trading": True}, True),
    ({}, True),
])
def test_alpaca_factory_respects_canonical_environment(monkeypatch, config, paper):
    captured = {}
    class Client:
        def __init__(self, cfg):
            captured["config"] = cfg
        def connect(self):
            return True
    monkeypatch.setattr(factory, "AlpacaClient", Client)
    monkeypatch.setattr(factory, "AlpacaConfig", lambda **kwargs: SimpleNamespace(**kwargs))
    factory.create_client({"exchange_id": "alpaca", "api_key": "PK-test", "secret_key": "test", "base_url": "https://api.alpaca.markets", **config}, market_type="spot")
    assert captured["config"].paper is paper
    if paper:
        assert captured["config"].base_url == "https://paper-api.alpaca.markets"


def test_hourly_range_falls_back_to_historical_provider(monkeypatch):
    from app.data_sources.us_stock import USStockDataSource
    source = USStockDataSource.__new__(USStockDataSource)
    source.finnhub_client = None
    observed = {}
    start = int(datetime(2026, 6, 13).timestamp())
    end = int(datetime(2026, 9, 10).timestamp())
    def chart(symbol, interval, start_date, end_date, limit):
        observed["start"] = start_date.timestamp()
        return []
    def latest_only(*args):
        pytest.fail("A historical request must not use a one-session fallback")
    monkeypatch.setattr(source, "_fetch_yahoo_chart", chart)
    monkeypatch.setattr(source, "_fetch_nasdaq_intraday_chart", latest_only)
    monkeypatch.setattr(source, "_fetch_yfinance", lambda *args: pd.DataFrame({"Close": [100]}))
    monkeypatch.setattr(source, "_convert_dataframe", lambda *args: [{"time": start + 3600, "open": 100, "high": 100, "low": 100, "close": 100, "volume": 10}])
    rows = source.get_kline("NVDA", "1h", 3000, end, start)
    assert observed["start"] == start
    assert len(rows) == 1


def test_repeated_spot_round_trips_do_not_stall_on_precision_dust():
    broker, portal, symbol, timestamp = _broker(0, price=60000)
    broker.instrument_rules[symbol]["amount_step"] = 1e-8
    for _ in range(50):
        broker.execute([OrderIntent(symbol, "target_quantity", 0.00823321)], portal, timestamp)
        broker.execute([OrderIntent(symbol, "target_quantity", 0)], portal, timestamp)
        assert not broker.portfolio.positions
    assert len(broker.executions) == 100
    assert len(broker.closed_trades) == 50
    assert all(event["status"] == "filled" for event in broker.order_ledger)
    expected_fees = 100 * 0.00823321 * 60000 * 0.001
    assert broker.portfolio.available_cash == pytest.approx(1000 - expected_fees)


@pytest.mark.parametrize("target,expected", [(1.1, False), (1.101, True), (0.0, True)])
def test_live_target_tolerance_preserves_full_close(target, expected):
    from app.services.trading_executor import TradingExecutor
    executor = TradingExecutor.__new__(TradingExecutor)
    executor._get_current_positions = lambda *args: [{"side": "long", "size": 1.0}]
    calls = []
    executor._execute_signal = lambda **kwargs: calls.append(kwargs) or True
    symbol = "Crypto:BTC/USDT@spot"
    result = executor._execute_strategy_v2_intent(
        strategy_id=1, strategy_name="test", intent=OrderIntent(symbol, "target_quantity", target),
        frames={symbol: pd.DataFrame({"close": [100]})},
        candidates=[{"key": symbol, "market": "Crypto", "symbol": "BTC/USDT", "market_type": "spot"}],
        initial_capital=1000, leverage=1, execution_mode="live", notification_config={},
        trading_config={}, exchange_config={}, signal_ts=1,
    )
    assert result is expected
    assert bool(calls) is expected
