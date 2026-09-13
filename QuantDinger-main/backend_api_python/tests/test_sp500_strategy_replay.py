"""Exercise the documented strategy with synthetic prices, never claim market returns."""
from pathlib import Path

import numpy as np
import pandas as pd

from app.services.strategy_v2 import StrategyV2BacktestRunner, StrategyV2LiveSession


def test_full_universe_filters_budget_slots_exits_and_live_restart():
    source = (Path(__file__).resolve().parents[2] / 'docs/strategies/sp500_profitable_top50.py').read_text(encoding='utf-8')
    prices = np.concatenate([np.linspace(110, 80, 70), np.linspace(80, 125, 55), np.linspace(125, 70, 65)])
    index = pd.bdate_range('2025-01-01', periods=len(prices))
    members = [f'USStock:S{i:03}' for i in range(503)]
    frames = {symbol: pd.DataFrame(dict(open=prices, high=prices+2, low=prices-2,
              close=prices, volume=1000000, market_cap=(503-i)*1e9,
              net_income=1e7 if i else -1e7), index=index) for i, symbol in enumerate(members)}
    resolve = lambda reference, timestamp: members
    runner = StrategyV2BacktestRunner(code=source, frames=frames, initial_capital=10000,
                                    commission=.001, slippage=.0005, universe_resolver=resolve)
    result = runner.run(start_date=index[61], end_date=index[-1])
    assert result['audit']['passed']
    assert len(result['executions']) == 20
    held = {}
    for trade in result['executions']:
        assert trade['symbol'] in members[1:51]
        if trade['side'] == 'buy':
            assert trade['notional'] + trade['commission'] <= 1000
            held[trade['symbol']] = held.get(trade['symbol'], 0) + trade['quantity']
        else:
            held[trade['symbol']] -= trade['quantity']
        assert sum(q > 1e-8 for q in held.values()) <= 10
        assert all(q >= -1e-8 for q in held.values())
    assert all(abs(q) < 1e-8 for q in held.values())

    signal_time = pd.Timestamp(result['executions'][0]['signal_time']).tz_localize(None)
    signal_frames = {symbol: values.loc[:signal_time] for symbol, values in frames.items()}
    session = StrategyV2LiveSession(code=source, frames=signal_frames, initial_capital=10000, universe_resolver=resolve)
    intents, _, _ = session.process(signal_frames, schedule_time=signal_time)
    assert len(intents) == 10
    assert all(intent.order_type == 'limit' and intent.value * intent.limit_price * 1.001 <= 1000 for intent in intents)
    restored = StrategyV2LiveSession(code=source, frames=signal_frames, initial_capital=10000, universe_resolver=resolve)
    restored.restore_session_snapshot(session.session_snapshot())
    assert len(restored.program.state.pending) == 10
    assert not restored.process(signal_frames, schedule_time=signal_time)[0]
    next_day = index[index.get_loc(signal_time) + 1]
    next_frames = {symbol: values.loc[:next_day] for symbol, values in frames.items()}
    assert not restored.process(next_frames, schedule_time=next_day)[0]
    assert len(restored.context._cancelled_order_ids) == 10
    assert all(restored.context.get_order_status(ref)['status'] == 'cancel_pending'
               for ref in restored.context._cancelled_order_ids)
