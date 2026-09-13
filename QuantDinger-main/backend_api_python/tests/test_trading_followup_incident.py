"""Exchange request and legacy-schema regressions from the production incident."""
import hashlib
import hmac
import json
from unittest.mock import Mock

import pytest

from app.services.execution_streams.repository import ExecutionEventRepository
from app.services.execution_streams.adapters import OkxExecutionAdapter
from app.services.grid.exchange_orders import cancel_grid_order, query_grid_order_fill, wait_grid_market_fill
from app.services.live_trading.gate import GateSpotClient
from app.services.pending_orders.live_order_phases import cancel_live_limit_order, wait_live_order_fill


@pytest.mark.parametrize('operation', ['grid_cancel', 'grid_query', 'grid_wait', 'live_cancel', 'live_wait'])
def test_gate_spot_requests_include_and_sign_currency_pair(monkeypatch, operation):
    monkeypatch.setattr('app.services.live_trading.gate.time.time', lambda: 1000)
    client = GateSpotClient(api_key='fixture-key', secret_key='fixture-secret')
    calls = []
    def request(method, path, **kwargs):
        calls.append((method, path, kwargs))
        if kwargs.get('params', {}).get('currency_pair') != 'BTC_USDT':
            return 400, {}, 'Missing required parameter: currency_pair'
        return 200, {'id': '28201', 'status': 'closed', 'filled_amount': '0.01',
                     'filled_total': '650', 'fee': '0.1', 'fee_currency': 'USDT'}, ''
    monkeypatch.setattr(client, '_request', request)
    common = dict(client=client, symbol='BTC/USDT', market_type='spot', exchange_config={})
    if operation == 'grid_cancel':
        cancel_grid_order(**common, exchange_order_id='28201', client_order_id='grid-168')
    elif operation == 'grid_query':
        fill = query_grid_order_fill(**common, exchange_order_id='28201', client_order_id='grid-168')
        assert fill == (0.01, 65000, 'filled')
    elif operation == 'grid_wait':
        fill = wait_grid_market_fill(**common, exchange_order_id='28201', client_order_id='grid-168', max_wait_sec=0)
        assert fill == (0.01, 65000)
    elif operation == 'live_cancel':
        cancel_live_limit_order(**common, order_id='28201', client_order_id='grid-168')
    else:
        fill = wait_live_order_fill(**common, order_id='28201', client_order_id='grid-168', max_wait_sec=0, phase='market')
        assert fill['filled'] == 0.01
    assert len(calls) == 1
    method, path, kwargs = calls[0]
    assert path == '/api/v4/spot/orders/28201'
    assert kwargs['params'] == {'currency_pair': 'BTC_USDT'}
    message = '\n'.join((method, path, 'currency_pair=BTC_USDT', hashlib.sha512(b'').hexdigest(), '1000'))
    assert kwargs['headers']['SIGN'] == hmac.new(b'fixture-secret', message.encode(), hashlib.sha512).hexdigest()


def test_okx_recent_login_does_not_defer_ping_past_disconnect_deadline(monkeypatch):
    now = [0.0]
    monkeypatch.setattr('app.services.execution_streams.adapters.time.monotonic', lambda: now[0])
    adapter = OkxExecutionAdapter(credential_id=1, user_id=1, exchange_id='okx', market_type='swap',
                                 config={}, symbols=[], on_event=Mock(), on_state=Mock())
    adapter._last_message_at = 0.2
    sent = []
    socket = Mock()
    socket.send.side_effect = lambda payload: sent.append((now[0], payload))
    class Timer:
        def wait(self, interval):
            now[0] += interval
            return now[0] > 20
    adapter._application_heartbeat_loop(socket, Timer())
    assert sent == [(20.0, 'ping')]


@pytest.mark.parametrize('as_text', [True, False])
def test_grid_binding_resolves_legacy_config_without_credential_column(as_text):
    config = {'exchange_id': 'gate', 'credential_id': 7}
    row = dict(user_id=8, market_type='spot', exchange_config=json.dumps(config) if as_text else config,
               trading_config='{}', owner_type='grid', id=1, strategy_id=168)
    event = dict(user_id=8, market_type='spot', exchange_id='gate', credential_id=7)
    binding = ExecutionEventRepository._matching_grid_binding(row, event)
    assert binding['credential_id'] == 7


@pytest.mark.parametrize('override', [dict(credential_id=9), dict(user_id=99), dict(exchange_id='binance'), dict(market_type='swap')])
def test_grid_binding_never_claims_another_accounts_order(override):
    row = dict(user_id=8, market_type='spot', exchange_config='{}',
               trading_config=json.dumps({'exchange_id': 'gate', 'credential_id': 7}))
    event = dict(user_id=8, market_type='spot', exchange_id='gate', credential_id=7)
    event.update(override)
    assert ExecutionEventRepository._matching_grid_binding(row, event) is None


def test_grid_binding_rejects_malformed_legacy_json():
    assert ExecutionEventRepository._matching_grid_binding({'exchange_config': '{broken'}, {}) is None
