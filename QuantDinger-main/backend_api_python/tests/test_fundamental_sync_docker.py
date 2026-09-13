"""Opt-in integration checks for durable jobs and point-in-time coverage."""
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from types import SimpleNamespace

import pandas as pd
import pytest

from app.services import fundamental_sync as sync
from app.services.fundamental_coverage import coverage_for
from app.services.fundamental_data import FundamentalDataService
from app.services.market_data_collector import MarketDataCollector
from app.services.universe import get_universe_service

pytestmark = [pytest.mark.integration, pytest.mark.skipif(
    os.getenv('QD_SP500_DOCKER_TEST') != '1' or 'qd_portfolio_test' not in os.getenv('DATABASE_URL', ''),
    reason='Requires isolated portfolio Docker database',
)]


@pytest.fixture
def pool():
    uid = sync.query('INSERT INTO qd_users(username,password_hash) VALUES (%s,%s) RETURNING id', ('fundamental-' + uuid.uuid4().hex, '!'))['id']
    symbols = ['T' + uuid.uuid4().hex[:8].upper() for _ in range(2)]
    universe = get_universe_service().create_manual(uid, dict(name='Fundamental test', market='USStock', members=[dict(symbol=s) for s in symbols]))
    yield uid, universe['id'], symbols
    sync.query('DELETE FROM qd_fundamental_snapshots WHERE symbol=ANY(%s)', (symbols,))
    sync.query('DELETE FROM qd_universes WHERE id=%s', (universe['id'],))
    sync.query('DELETE FROM qd_users WHERE id=%s', (uid,))


def write_snapshot(market, symbol, available=None, net_income=10, source='integration-fixture'):
    FundamentalDataService.upsert(dict(market=market, symbol=symbol, period_end=date.today()-timedelta(days=60),
        available_at=available or date.today()-timedelta(days=10), source=source,
        market_cap=1000, shares_outstanding=10, net_income=net_income))


def test_batch_job_persists_then_supplies_live_panel(pool, monkeypatch):
    uid, universe, symbols = pool
    calls = []
    def provider(**kw):
        calls.append(kw['symbol'])
        write_snapshot(**kw)
    monkeypatch.setattr(sync, 'get_fundamental_data_service', lambda: SimpleNamespace(sync_history=provider))
    accepted = ['market_cap', 'net_income']
    initial = coverage_for(uid, universe, accepted)
    assert initial['ready'] == 0
    job = sync.start_job(uid, universe)
    assert not sync.start_job(uid, universe)['started']
    assert sync.run_one()
    assert sync.run_one()
    assert not sync.run_one()
    result = sync.status_for(uid, universe)
    assert result['job']['id'] == job['job_id']
    assert result['job']['status'] == 'complete'
    assert sorted(calls) == sorted(symbols)
    assert coverage_for(uid, universe, accepted)['ready'] == 2
    service = FundamentalDataService()
    members = [dict(key='USStock:' + symbol, market='USStock', symbol=symbol) for symbol in symbols]
    frames = {item['key']: pd.DataFrame({'close': [105]}, index=[pd.Timestamp(date.today())]) for item in members}
    panel = service.enrich_panel(frames, members)
    from app.services.strategy_v2.readiness import validate_fundamentals
    validate_fundamentals(panel, ['market_cap', 'net_income'])
    assert all(frame.iloc[-1]['market_cap'] == 1050 for frame in panel.values())


def test_failure_retry_and_new_job_only_contains_failed_symbols(pool, monkeypatch):
    uid, universe, symbols = pool
    failing = {symbols[0]}
    def provider(**kw):
        if kw['symbol'] in failing:
            raise TimeoutError('injected')
        write_snapshot(**kw)
    monkeypatch.setattr(sync, 'get_fundamental_data_service', lambda: SimpleNamespace(sync_history=provider))
    job = sync.start_job(uid, universe)
    for _ in range(4):
        sync.query("UPDATE qd_fundamental_sync_items SET retry_at=NOW() WHERE job_id=%s", (job['job_id'],))
        assert sync.run_one()
    assert sync.status_for(uid, universe)['job']['status'] == 'partial'
    failing.clear()
    retry = sync.start_job(uid, universe, retry_job=job['job_id'])
    assert len(sync.status_for(uid, universe)['job']['items']) == 1
    assert sync.run_one()
    assert sync.status_for(uid, universe)['job']['id'] == retry['job_id']
    assert coverage_for(uid, universe, ['market_cap', 'net_income'])['ready'] == 2


def test_expired_claim_recovers_and_concurrent_ticks_do_not_duplicate(pool, monkeypatch):
    uid, universe, symbols = pool
    job = sync.start_job(uid, universe)
    sync.query("UPDATE qd_fundamental_sync_items SET status='running',attempts=1,token='dead',lease_until=NOW()-INTERVAL '1 minute' WHERE job_id=%s AND symbol=%s", (job['job_id'], symbols[0]))
    calls = []
    def provider(**kw):
        calls.append(kw['symbol'])
        write_snapshot(**kw)
    monkeypatch.setattr(sync, 'get_fundamental_data_service', lambda: SimpleNamespace(sync_history=provider))
    with ThreadPoolExecutor(max_workers=2) as executor:
        assert all(executor.map(lambda _: sync.run_one(), range(2)))
    assert sorted(calls) == sorted(symbols)
    assert sync.status_for(uid, universe)['job']['status'] == 'complete'


def test_current_snapshot_does_not_backfill_and_missing_is_not_profit_zero(pool):
    uid, universe, symbols = pool
    write_snapshot('USStock', symbols[0], available=date.today(), net_income=0)
    write_snapshot('USStock', symbols[1], available=date.today(), net_income=None)
    accepted = ['market_cap', 'net_income']
    assert coverage_for(uid, universe, accepted, as_of=date.today()-timedelta(days=1))['ready'] == 0
    result = coverage_for(uid, universe, accepted)
    assert result['ready'] == 1
    assert next(row for row in result['items'] if row['symbol'] == symbols[1])['missing'] == ['net_income']


def test_same_day_provider_correction_replaces_older_coverage_row(pool):
    _, universe, symbols = pool
    symbol = symbols[0]
    today = date.today()
    FundamentalDataService.upsert(dict(
        market='USStock', symbol=symbol, period_end=today, available_at=today,
        source='old-incomplete', market_cap=1000, net_income=None,
    ))
    FundamentalDataService.upsert(dict(
        market='USStock', symbol=symbol, period_end=today-timedelta(days=60), available_at=today,
        source='corrected-provider', market_cap=1000, net_income=25,
    ))

    result = coverage_for(pool[0], universe, ['market_cap', 'net_income'])
    corrected = next(row for row in result['items'] if row['symbol'] == symbol)

    assert corrected['ready'] is True
    assert corrected['source'] == 'corrected-provider'
    assert corrected['period_end'] == today-timedelta(days=60)


def test_successful_provider_collection_is_not_failed_by_optional_field_coverage(pool, monkeypatch):
    uid, universe, symbols = pool
    monkeypatch.setattr(sync, 'get_fundamental_data_service', lambda: SimpleNamespace(
        sync_history=lambda **kw: write_snapshot(**kw, source='yfinance_quarterly')))
    job = sync.start_job(uid, universe)
    assert sync.run_one() and sync.run_one()
    status = sync.status_for(uid, universe)['job']
    assert status['status'] == 'complete'
    assert all(item['status'] == 'success' and item['attempts'] == 1 for item in status['items'])
    assert coverage_for(uid, universe)['ready'] == 0


def test_schedule_persists_and_permission_does_not_cross_private_universes(pool):
    uid, universe, _ = pool
    sync.set_schedule(uid, universe, True)
    sync.enqueue_scheduled()
    assert sync.status_for(uid, universe)['job']['status'] == 'queued'
    sync.enqueue_scheduled()
    assert sync.query('SELECT COUNT(*) AS n FROM qd_fundamental_sync_jobs WHERE universe_id=%s', (universe,))['n'] == 1
    sync.set_schedule(uid, universe, False)
    assert not sync.status_for(uid, universe)['schedule']['enabled']
    with pytest.raises(ValueError):
        sync.status_for(uid + 10000, universe)


def test_admin_routes_enforce_role_and_use_real_database(pool, app):
    from app.utils.auth import generate_token
    uid, universe, _ = pool
    user = sync.query('SELECT username,token_version FROM qd_users WHERE id=%s', (uid,))
    headers = {'Authorization': 'Bearer ' + generate_token(uid, user['username'], 'user', user['token_version'])}
    client = app.test_client()
    url = f'/api/factors/fundamentals/universe/{universe}'
    assert client.get(url).status_code == 401
    assert client.get(url, headers=headers).status_code == 403
    sync.query("UPDATE qd_users SET role='admin' WHERE id=%s", (uid,))
    headers = {'Authorization': 'Bearer ' + generate_token(uid, user['username'], 'admin', user['token_version'])}
    response = client.get(url, headers=headers)
    assert response.status_code == 200
    assert response.json['data']['coverage']['ready'] == 0
    assert client.post(url + '/sync', json={'fields': ['bad']}, headers=headers).status_code == 400
    assert client.post(url + '/sync', json={'incremental': 'false'}, headers=headers).status_code == 400
    assert client.post(url + '/sync', json={'mode': 'history'}, headers=headers).json['data']['started']
    assert not client.post(url + '/sync', json={'mode': 'history'}, headers=headers).json['data']['started']


def test_incremental_skips_fresh_reports_and_fetches_only_new_member(pool, monkeypatch):
    uid, universe, symbols = pool
    calls = []
    def provider(**kw):
        calls.append(kw['symbol'])
        write_snapshot(**kw, source='yfinance_quarterly')
    monkeypatch.setattr(sync, 'get_fundamental_data_service', lambda: SimpleNamespace(sync_history=provider))
    sync.start_job(uid, universe)
    assert sync.run_one() and sync.run_one()
    calls.clear()
    sync.set_schedule(uid, universe, True)
    sync.enqueue_scheduled()
    job = sync.status_for(uid, universe)['job']
    assert job['status'] == 'complete' and job['skipped_count'] == 2
    assert not sync.run_one() and not calls
    new_symbol = 'T' + uuid.uuid4().hex[:8].upper()
    symbols.append(new_symbol)
    get_universe_service().replace_manual_members(uid, universe, [dict(symbol=s) for s in symbols])
    sync.start_job(uid, universe)
    assert sync.run_one()
    assert calls == [new_symbol]
    assert sync.status_for(uid, universe)['job']['skipped_count'] == 2
    sync.start_job(uid, universe, incremental=False)
    assert len(sync.status_for(uid, universe)['job']['items']) == 3


def test_recent_snapshot_does_not_suppress_first_historical_import(pool):
    uid, universe, symbols = pool
    for symbol in symbols:
        write_snapshot('USStock', symbol)
    sync.start_job(uid, universe)
    assert len(sync.status_for(uid, universe)['job']['items']) == 2


def test_automatic_failures_cool_down_and_explicit_retry_bypasses_wait(pool, monkeypatch):
    uid, universe, symbols = pool
    def provider(**kw):
        if kw['symbol'] == symbols[0]:
            raise TimeoutError('injected')
        write_snapshot(**kw, source='yfinance_quarterly')
    monkeypatch.setattr(sync, 'get_fundamental_data_service', lambda: SimpleNamespace(sync_history=provider))
    job = sync.start_job(uid, universe)
    for _ in range(4):
        sync.query('UPDATE qd_fundamental_sync_items SET retry_at=NOW() WHERE job_id=%s', (job['job_id'],))
        assert sync.run_one()
    sync.start_job(uid, universe)
    assert sync.status_for(uid, universe)['job']['skipped_count'] == 2
    sync.start_job(uid, universe, retry_job=job['job_id'])
    assert [i['symbol'] for i in sync.status_for(uid, universe)['job']['items']] == [symbols[0]]


def test_ai_fundamentals_write_through_and_reuse_rich_snapshot(pool, monkeypatch):
    _, _, symbols = pool
    symbol = symbols[0]
    provider_payload = {
        'source': 'integration-provider',
        'market_cap': 1_500_000_000.0,
        'net_income': 125_000_000.0,
        'roe': 18.5,
        'financial_statements': {
            'latest_quarter': {
                'period_end': (date.today() - timedelta(days=30)).isoformat(),
                'currency': 'USD',
                'income_statement': {
                    'total_revenue': 450_000_000.0,
                    'net_income': 125_000_000.0,
                },
            },
        },
        'earnings': {
            'history': [
                {
                    'date': (date.today() - timedelta(days=30)).isoformat(),
                    'eps_actual': 2.1,
                    'eps_estimate': 1.9,
                },
            ],
        },
    }

    writer = MarketDataCollector.__new__(MarketDataCollector)
    monkeypatch.setattr(writer, '_fetch_fundamental_uncached', lambda market, requested: provider_payload)
    first = writer._get_fundamental('USStock', symbol)
    assert first['data_quality']['storage']['writeback'] == 'success'

    row = sync.query(
        '''SELECT metadata_json FROM qd_fundamental_snapshots
           WHERE market=%s AND symbol=%s ORDER BY ingested_at DESC LIMIT 1''',
        ('USStock', symbol),
    )
    stored = row['metadata_json']['analysisPayload']
    assert stored['financial_statements']['latest_quarter']['income_statement']['net_income'] == 125_000_000.0
    assert stored['earnings']['history'][0]['eps_actual'] == 2.1

    write_snapshot(
        'USStock',
        symbol,
        available=date.today(),
        source='yfinance_quarterly',
    )

    provider_calls = []
    reader = MarketDataCollector.__new__(MarketDataCollector)
    monkeypatch.setattr(
        reader,
        '_fetch_fundamental_uncached',
        lambda market, requested: provider_calls.append((market, requested)),
    )
    second = reader._get_fundamental('USStock', symbol)
    assert provider_calls == []
    assert second['data_quality']['storage']['served_from'] == 'database'
    assert second['financial_statements'] == provider_payload['financial_statements']
    assert second['earnings'] == provider_payload['earnings']
