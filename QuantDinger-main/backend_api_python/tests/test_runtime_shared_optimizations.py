import pandas as pd
import pytest

from app.services.strategy_v2 import StrategyV2LiveSession
from app.services.strategy_v2.data import MultiAssetDataPortal
from app.services.strategy_v2.runtime import PortfolioState, StrategyRuntimeContext


SYMBOL = "USStock:AAPL"


def frame(prices):
    return pd.DataFrame({
        "open": prices, "high": [p + 1 for p in prices], "low": [p - 1 for p in prices],
        "close": prices, "volume": [1000.] * len(prices),
    }, index=pd.date_range("2026-01-01", periods=len(prices), freq="1h"))


def test_cached_handler_signatures_keep_arity_and_refresh_on_replacement(monkeypatch):
    import app.services.strategy_v2.runtime as runtime

    portal = MultiAssetDataPortal({SYMBOL: frame([100., 101.])}, driving_frequency="1h")
    context = StrategyRuntimeContext(portal=portal, portfolio=PortfolioState(1000, 1000))
    original = runtime.inspect.signature
    calls = []
    monkeypatch.setattr(runtime.inspect, "signature", lambda handler: (calls.append(handler), original(handler))[1])
    one = lambda a: a
    varargs = lambda *args: args
    assert context.invoke_handler("handle_data", one, (1, 2)) == 1
    assert context.invoke_handler("handle_data", one, (3, 4)) == 3
    assert context.invoke_handler("handle_data", varargs, (1, 2)) == (1, 2)
    assert calls == [one, varargs]


@pytest.mark.parametrize("count", [None, 0, 1, 3])
@pytest.mark.parametrize("fields", [["close", "open"], ["close", "missing", "close"], ["missing"]])
def test_history_column_selection_matches_pandas_and_is_isolated(count, fields):
    source = frame([100., 101., 102., 103.])
    portal = MultiAssetDataPortal({SYMBOL: source}, driving_frequency="1h")
    portal.set_clock(source.index[2], include_current=True)
    expected = source.iloc[:3]
    if count:
        expected = expected.tail(count)
    expected = expected.loc[:, [name for name in fields if name in expected.columns]]
    actual = portal.history(SYMBOL, count=count, fields=fields)
    pd.testing.assert_frame_equal(actual, expected)
    if not actual.empty:
        actual.iloc[:, :] = -1
    pd.testing.assert_frame_equal(portal.history(SYMBOL, count=count, fields=fields), expected)


def test_live_indicator_cache_refreshes_revised_history_and_survives_append(monkeypatch):
    import app.services.strategy_v2.runtime as runtime

    monkeypatch.setattr(runtime, "is_talib_available", lambda: False)
    code = '''
PERSIST_RUNTIME_STATE = True
def initialize(context):
    context.set_universe(["USStock:AAPL"])
    context.subscribe(frequency="1h")
def handle_data(context, data):
    g.value = float(context.indicator("EMA", "USStock:AAPL", period=5).iloc[-1])
'''
    initial = frame([100. + i for i in range(20)])
    active = StrategyV2LiveSession(code=code, frames={SYMBOL: initial}, initial_capital=1000)
    active.process({SYMBOL: initial}, schedule_time=initial.index[-1])
    appended = frame([100. + i for i in range(21)])
    saved_cache = next(iter(active.context._indicator_cache.values()))
    portal = MultiAssetDataPortal({SYMBOL: appended}, driving_frequency="1h")
    active.context.refresh_portal(portal)
    assert next(iter(active.context._indicator_cache.values())) is saved_cache
    revised = appended.copy()
    revised.iloc[17, revised.columns.get_loc("close")] = 200
    active.process({SYMBOL: revised}, schedule_time=revised.index[-1])
    clean = StrategyV2LiveSession(code=code, frames={SYMBOL: revised}, initial_capital=1000)
    clean.process({SYMBOL: revised}, schedule_time=revised.index[-1])
    assert active.program.state.value == clean.program.state.value
    snapshot = active.session_snapshot()
    restarted = StrategyV2LiveSession(code=code, frames={SYMBOL: revised}, initial_capital=1000)
    restarted.restore_session_snapshot(snapshot)
    assert restarted.process({SYMBOL: revised}, schedule_time=revised.index[-1])[0] == []
    assert restarted.program.state.value == active.program.state.value


def test_cross_sectional_fundamentals_respect_each_symbols_visible_row():
    a = frame([100., 101., 102.])
    b = frame([200., 201., 202.])
    a["market_cap"] = [10., 20., 1000.]
    b["market_cap"] = [30., 40., 1.]
    b = b.drop(b.index[1])
    portal = MultiAssetDataPortal({SYMBOL: a, "USStock:MSFT": b}, driving_frequency="1h")
    context = StrategyRuntimeContext(portal=portal, portfolio=PortfolioState(1000, 1000))
    portal.set_clock(a.index[2], include_current=False)
    fundamentals = context.get_fundamentals(["MARKET_CAP"])
    assert fundamentals["MARKET_CAP"].to_dict() == {SYMBOL: 20., "USStock:MSFT": 30.}
    assert fundamentals.sort_values("MARKET_CAP").index[0] == SYMBOL
    portal.set_clock(a.index[2], include_current=True)
    assert context.get_fundamentals(["MARKET_CAP"]).sort_values("MARKET_CAP").index[0] == "USStock:MSFT"
