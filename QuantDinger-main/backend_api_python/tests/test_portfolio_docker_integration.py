"""Opt-in integration checks against an isolated Docker database and fake broker."""
import json
import os
import uuid
from types import SimpleNamespace

import pytest

from app.utils.db import get_db_connection
from app.services.strategy_runtime.cancellations import persist_cancellations
from app.services.strategy_runtime.order_intents import OrderIntentService

pytestmark = [pytest.mark.integration, pytest.mark.skipif(
    os.getenv('QD_SP500_DOCKER_TEST') != '1' or 'qd_portfolio_test' not in os.getenv('DATABASE_URL', ''),
    reason='Requires the isolated portfolio Docker test database',
)]


def query(sql, params=(), many=False):
    with get_db_connection() as db:
        cur = db.cursor()
        cur.execute(sql, params)
        rows = (cur.fetchall() if many else cur.fetchone()) if 'RETURNING' in sql.upper() or sql.lstrip().upper().startswith('SELECT') else None
        db.commit()
        cur.close()
        return rows


@pytest.fixture
def owner():
    uid = query('INSERT INTO qd_users(username,password_hash) VALUES (%s,%s) RETURNING id',
                ('portfolio-test-' + uuid.uuid4().hex[:12], '!'))['id']
    sid = query('INSERT INTO qd_strategies_trading(user_id,strategy_name,market_category) VALUES (%s,%s,%s) RETURNING id',
                (uid, 'Portfolio Docker integration', 'USStock'))['id']
    yield uid, sid
    query('DELETE FROM strategy_order_fills WHERE strategy_id=%s', (sid,))
    query('DELETE FROM strategy_order_intents WHERE strategy_id=%s', (sid,))
    query('DELETE FROM qd_users WHERE id=%s', (uid,))


def seed_order(owner, status, reference, run=900001):
    uid, sid = owner
    intent = query('''INSERT INTO strategy_order_intents(strategy_id,strategy_run_id,idempotency_key,
        symbol,side,status,client_order_id,quantity) VALUES (%s,%s,%s,'AAA','buy','submitted',%s,10) RETURNING id''',
        (sid, run, uuid.uuid4().hex, reference))['id']
    row = query('''INSERT INTO pending_orders(user_id,strategy_id,strategy_run_id,order_intent_id,
        idempotency_key,symbol,signal_type,status,exchange_id,exchange_order_id,payload_json,amount,price)
        VALUES (%s,%s,%s,%s,%s,'AAA','open_long',%s,'alpaca',%s,'{}',10,100) RETURNING *''',
        (uid, sid, run, intent, uuid.uuid4().hex, status, 'broker-' + reference if status == 'sent' else ''))
    return row


def test_cancel_is_scoped_and_durable_then_broker_confirmation_closes_it(owner, monkeypatch):
    import app.services.pending_order_worker as worker_module
    pending = seed_order(owner, 'pending', 'entry')
    sent = seed_order(owner, 'sent', 'resting')
    other_run = seed_order(owner, 'pending', 'entry', run=900002)
    statuses = {}
    context = SimpleNamespace(_cancelled_order_ids={'entry', 'resting'},
                              get_order_status=lambda ref: dict(status=statuses.get(ref, 'cancel_pending')))
    service = OrderIntentService(strategy_id=owner[1], strategy_run_id=900001)
    persist_cancellations(context, service)
    assert not context._cancelled_order_ids
    assert query('SELECT status FROM pending_orders WHERE id=%s', (pending['id'],))['status'] == 'cancelled'
    assert query('SELECT status FROM pending_orders WHERE id=%s', (other_run['id'],))['status'] == 'pending'
    sent_row = query('SELECT * FROM pending_orders WHERE id=%s', (sent['id'],))
    assert sent_row['status'] == 'sent'
    assert json.loads(sent_row['payload_json'])['strategy_cancel_requested']
    assert service.statuses_by_client_order_ids(['resting'])['resting']['status'] == 'cancel_pending'

    calls = []
    class Broker:
        def cancel_order(self, order_id):
            calls.append(order_id)
            return True
        def get_order_status(self, order_id):
            return SimpleNamespace(status='canceled', filled=4, avg_price=100, raw={'id': order_id, 'status': 'canceled'})
    config = dict(exchange_id='alpaca')
    monkeypatch.setattr(worker_module, 'AlpacaClient', Broker)
    monkeypatch.setattr(worker_module, 'create_client', lambda *a, **kw: Broker())
    monkeypatch.setattr(worker_module, 'resolve_exchange_config', lambda *a, **kw: config)
    monkeypatch.setattr(worker_module, 'load_strategy_configs', lambda sid: dict(user_id=owner[0], exchange_config=config, market_category='USStock'))
    worker = object.__new__(worker_module.PendingOrderWorker)
    worker._sync_one_alpaca_sent_order(sent_row)
    actual = query('SELECT status, filled FROM pending_orders WHERE id=%s', (sent['id'],))
    assert actual['status'] == 'cancelled'
    assert float(actual['filled']) == 4
    assert calls == ['broker-resting']
    assert service.statuses_by_client_order_ids(['resting'])['resting']['status'] == 'cancelled'
    positions = query('SELECT size FROM qd_strategy_positions WHERE strategy_id=%s', (owner[1],), many=True)
    assert sum(float(row['size']) for row in positions) == 4
    worker._sync_one_alpaca_sent_order(sent_row)
    assert calls == ['broker-resting']


def test_new_universe_members_refresh_without_losing_owned_old_member(owner):
    from app.services.strategy_runtime.live_portfolio import refresh_members
    query('''INSERT INTO qd_strategy_positions(strategy_id,symbol,side,size,entry_price,current_price)
             VALUES (%s,'OLD','long',2,100,100)''', (owner[1],))
    fresh = dict(key='USStock:NEW', symbol='NEW', market='USStock', market_type='spot')
    service = SimpleNamespace(resolve_candidates=lambda **kwargs: ([fresh], 1))
    manifest = SimpleNamespace(universe=SimpleNamespace(kind='dynamic'), markets=('USStock',))
    candidates = []
    refresh_members(service, candidates, manifest, owner[0], owner[1], '2026-09-12')
    assert {member['key'] for member in candidates} == {'USStock:NEW', 'USStock:OLD'}


@pytest.mark.parametrize('attempts,exchange_id,expected', [(0, '', 'cancelled'), (1, '', 'pending'), (1, 'broker-1', 'sent')])
def test_cancel_arriving_during_claim_never_resubmits_uncertain_order(owner, attempts, exchange_id, expected):
    from app.services.pending_order_worker import PendingOrderWorker
    from app.services.strategy_runtime.cancellations import intercept_cancelled_dispatch
    row = seed_order(owner, 'pending', 'racing')
    row['attempts'] = attempts
    query('UPDATE pending_orders SET attempts=%s,exchange_order_id=%s WHERE id=%s', (attempts, exchange_id, row['id']))
    worker = object.__new__(PendingOrderWorker)
    assert worker._mark_processing(row['id'])
    context = SimpleNamespace(_cancelled_order_ids={'racing'}, get_order_status=lambda ref: dict(status='cancel_pending'))
    persist_cancellations(context, OrderIntentService(strategy_id=owner[1], strategy_run_id=900001))
    assert intercept_cancelled_dispatch(row)
    actual = query('SELECT * FROM pending_orders WHERE id=%s', (row['id'],))
    assert actual['status'] == expected
    if expected == 'pending':
        assert actual['last_error'] == 'strategyV2.cancellationNeedsReconciliation'
        worker._stale_processing_sec = 0
        assert row['id'] not in {order['id'] for order in worker._fetch_pending_orders()}


def test_previous_attempt_without_broker_id_is_not_locally_confirmed_cancelled(owner):
    row = seed_order(owner, 'pending', 'uncertain')
    query('UPDATE pending_orders SET attempts=1 WHERE id=%s', (row['id'],))
    context = SimpleNamespace(_cancelled_order_ids={'uncertain'}, get_order_status=lambda ref: dict(status='cancel_pending'))
    persist_cancellations(context, OrderIntentService(strategy_id=owner[1], strategy_run_id=900001))
    assert query('SELECT status FROM pending_orders WHERE id=%s', (row['id'],))['status'] == 'pending'
