"""Persistent universe fundamental jobs; external IO never holds a DB connection."""
import json
import uuid
from app.services.fundamental_data import FUNDAMENTAL_FIELDS, get_fundamental_data_service
from app.services.universe import get_universe_service
from app.utils.db import get_db_connection
from app.utils.logger import get_logger

logger = get_logger(__name__)
DEFAULT_FIELDS = list(FUNDAMENTAL_FIELDS)


def query(sql, params=(), many=False):
    with get_db_connection() as db:
        cur = db.cursor()
        try:
            cur.execute(sql, params)
            returns_rows = sql.lstrip().upper().startswith('SELECT') or 'RETURNING' in sql.upper()
            rows = (cur.fetchall() if many else cur.fetchone()) if returns_rows else None
            db.commit()
            return rows
        finally:
            cur.close()


def fields_for(raw=None):
    values = raw if raw is not None else DEFAULT_FIELDS
    if not isinstance(values, list) or not values or any(value not in FUNDAMENTAL_FIELDS for value in values):
        raise ValueError('fundamentalSync.invalidFields')
    return sorted(set(values))


def members_for(user_id, universe_id):
    members = get_universe_service().resolve_members(user_id, universe_id)
    members = list({(m['market'], m['symbol']): m for m in members}.values())
    if not members or len(members) > 5000 or any(m['market'] not in {'USStock', 'HKStock', 'CNStock'} for m in members):
        raise ValueError('fundamentalSync.unsupportedUniverse')
    return members


def start_job(user_id, universe_id, mode='history', fields=None, retry_job=None, incremental=True):
    if not isinstance(incremental, bool):
        raise ValueError('fundamentalSync.invalidPolicy')
    fields = fields_for(fields)
    members = members_for(user_id, universe_id)
    if retry_job:
        previous = query('SELECT * FROM qd_fundamental_sync_jobs WHERE id=%s AND universe_id=%s', (retry_job, universe_id))
        if not previous or previous['status'] in {'queued', 'running'}:
            raise ValueError('fundamentalSync.invalidRetry')
        mode, fields = previous['mode'], previous['fields_json']
        failed = query("SELECT market,symbol FROM qd_fundamental_sync_items WHERE job_id=%s AND status='failed'", (retry_job,), True)
        identities = {(item['market'], item['symbol']) for item in failed}
        members = [item for item in members if (item['market'], item['symbol']) in identities]
        if not members:
            raise ValueError('fundamentalSync.invalidRetry')
    if mode not in {'history', 'current'} or (mode == 'history' and any(m['market'] != 'USStock' for m in members)):
        raise ValueError('fundamentalSync.unsupportedMode')
    skipped = 0
    policy = 'retry' if retry_job else 'incremental' if incremental else 'full'
    if incremental and not retry_job:
        from app.services.fundamental_refresh import due_members
        selected = due_members(members, fields, mode)
        skipped = len(members) - len(selected)
        members = selected
    with get_db_connection() as db:
        cur = db.cursor()
        try:
            cur.execute('''INSERT INTO qd_fundamental_sync_jobs(universe_id,user_id,mode,fields_json,refresh_policy,skipped_count)
                VALUES (%s,%s,%s,%s::jsonb,%s,%s) ON CONFLICT DO NOTHING RETURNING id''',
                (universe_id, user_id, mode, json.dumps(fields), policy, skipped))
            row = cur.fetchone()
            if not row:
                cur.execute("SELECT id FROM qd_fundamental_sync_jobs WHERE universe_id=%s AND status IN ('queued','running')", (universe_id,))
                return dict(started=False, job_id=cur.fetchone()['id'])
            for member in members:
                cur.execute('''INSERT INTO qd_fundamental_sync_items(job_id,market,symbol)
                    VALUES (%s,%s,%s) RETURNING id''', (row['id'], member['market'], member['symbol']))
            if not members:
                cur.execute("UPDATE qd_fundamental_sync_jobs SET status='complete' WHERE id=%s", (row['id'],))
            db.commit()
            return dict(started=True, job_id=row['id'])
        finally:
            cur.close()


def set_schedule(user_id, universe_id, enabled, mode='history', fields=None):
    members = members_for(user_id, universe_id)
    if mode not in {'history', 'current'} or (mode == 'history' and any(m['market'] != 'USStock' for m in members)):
        raise ValueError('fundamentalSync.unsupportedMode')
    if not isinstance(enabled, bool):
        raise ValueError('fundamentalSync.invalidSchedule')
    query('''INSERT INTO qd_fundamental_sync_schedules(universe_id,user_id,enabled,mode,fields_json)
        VALUES (%s,%s,%s,%s,%s::jsonb) ON CONFLICT(universe_id) DO UPDATE SET
        user_id=EXCLUDED.user_id,enabled=EXCLUDED.enabled,mode=EXCLUDED.mode,fields_json=EXCLUDED.fields_json,
        next_at=NOW() RETURNING id''', (universe_id, user_id, enabled, mode, json.dumps(fields_for(fields))))


def enqueue_scheduled():
    rows = query('''UPDATE qd_fundamental_sync_schedules SET next_at=NOW()+INTERVAL '1 day'
        WHERE enabled AND next_at <= NOW() RETURNING *''', many=True) or []
    for row in rows:
        try:
            start_job(row['user_id'], row['universe_id'], row['mode'], row['fields_json'])
        except Exception:
            logger.exception('Fundamental scheduled enqueue failed universe=%s', row['universe_id'])
            query("UPDATE qd_fundamental_sync_schedules SET next_at=NOW()+INTERVAL '10 minutes' WHERE id=%s", (row['id'],))


def run_one():
    query("""UPDATE qd_fundamental_sync_items SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'pending' END,
        token=NULL,error='fundamentalSync.interrupted',retry_at=NOW(),updated_at=NOW()
        WHERE status='running' AND lease_until < NOW()""")
    token = uuid.uuid4().hex
    row = query('''UPDATE qd_fundamental_sync_items SET status='running',attempts=attempts+1,
        token=%s,lease_until=NOW()+INTERVAL '5 minutes',updated_at=NOW()
        WHERE id=(SELECT i.id FROM qd_fundamental_sync_items i JOIN qd_fundamental_sync_jobs j ON j.id=i.job_id
            WHERE i.status='pending' AND i.retry_at<=NOW() AND j.status IN ('queued','running')
            ORDER BY i.id FOR UPDATE OF i SKIP LOCKED LIMIT 1) RETURNING *''', (token,))
    if not row:
        finish_jobs()
        return False
    job = query("UPDATE qd_fundamental_sync_jobs SET status='running',updated_at=NOW() WHERE id=%s RETURNING *", (row['job_id'],))
    error = ''
    error_detail = ''
    try:
        service = get_fundamental_data_service()
        method = service.sync_history if job['mode'] == 'history' else service.sync_current
        method(market=row['market'], symbol=row['symbol'])
    except Exception as exc:
        logger.exception('Fundamental sync failed job=%s market=%s symbol=%s', row['job_id'], row['market'], row['symbol'])
        error = 'fundamentalSync.providerFailed'
        error_detail = f'{type(exc).__name__}: {exc}'[:500]
    status = ('failed' if row['attempts'] >= 3 else 'pending') if error else 'success'
    query('''UPDATE qd_fundamental_sync_items SET status=%s,error=%s,error_detail=%s,token=NULL,lease_until=NULL,
        retry_at=NOW()+INTERVAL '60 seconds',updated_at=NOW() WHERE id=%s AND token=%s''',
        (status, error, error_detail, row['id'], token))
    finish_jobs()
    return True


def finish_jobs():
    query('''UPDATE qd_fundamental_sync_jobs j SET status=CASE
        WHEN NOT EXISTS(SELECT 1 FROM qd_fundamental_sync_items i WHERE i.job_id=j.id AND i.status='failed') THEN 'complete'
        WHEN EXISTS(SELECT 1 FROM qd_fundamental_sync_items i WHERE i.job_id=j.id AND i.status='success') THEN 'partial'
        ELSE 'failed' END,updated_at=NOW()
        WHERE j.status IN ('queued','running') AND NOT EXISTS(
            SELECT 1 FROM qd_fundamental_sync_items i WHERE i.job_id=j.id AND i.status IN ('pending','running'))''')


def status_for(user_id, universe_id):
    members_for(user_id, universe_id)
    job = query('SELECT * FROM qd_fundamental_sync_jobs WHERE universe_id=%s ORDER BY id DESC LIMIT 1', (universe_id,))
    if job:
        job['items'] = query('SELECT market,symbol,status,attempts,error,error_detail,updated_at FROM qd_fundamental_sync_items WHERE job_id=%s ORDER BY id', (job['id'],), True)
    schedule = query('SELECT enabled,mode,fields_json,next_at FROM qd_fundamental_sync_schedules WHERE universe_id=%s', (universe_id,))
    return dict(job=job, schedule=schedule)
