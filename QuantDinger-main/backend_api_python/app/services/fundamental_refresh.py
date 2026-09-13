"""Select due symbols using persisted observations and bounded polling intervals."""
from datetime import datetime, timedelta, timezone


def refresh_due(coverage, attempt, fields, mode, now):
    def age(value):
        if not value:
            return timedelta.max
        stamp = datetime.fromisoformat(str(value))
        return now - (stamp.replace(tzinfo=timezone.utc) if stamp.tzinfo is None else stamp)

    same_fields = attempt and set(fields).issubset(attempt['fields_json'])
    if same_fields and attempt['status'] == 'failed' and age(attempt['updated_at']) < timedelta(days=1):
        return False
    if not coverage['ready']:
        if same_fields and attempt['status'] == 'success':
            period_end = coverage.get('period_end')
            old_period = bool(period_end and (now.date() - period_end).days >= 100)
            interval = timedelta(days=1 if mode == 'current' or old_period else 7)
            return age(attempt['updated_at']) >= interval
        return True
    interval = timedelta(days=1 if mode == 'current' or (now.date() - coverage['period_end']).days >= 100 else 7)
    checked_age = age(coverage['ingested_at'])
    if same_fields and attempt['status'] == 'success':
        checked_age = min(checked_age, age(attempt['updated_at']))
    return checked_age >= interval


def due_members(members, fields, mode):
    from app.services.fundamental_coverage import member_coverage
    from app.services.fundamental_sync import query
    now = datetime.now(timezone.utc)
    coverage = member_coverage(members, fields, now.date(), source='yfinance_quarterly' if mode == 'history' else None)
    attempts = query('''SELECT DISTINCT ON (i.market,i.symbol) i.market,i.symbol,i.status,i.updated_at,j.fields_json
        FROM qd_fundamental_sync_items i JOIN qd_fundamental_sync_jobs j ON j.id=i.job_id
        WHERE i.symbol=ANY(%s) AND j.mode=%s AND i.status IN ('success','failed')
        ORDER BY i.market,i.symbol,i.updated_at DESC,i.id DESC''', ([m['symbol'] for m in members], mode), True)
    latest = {(a['market'], a['symbol']): a for a in attempts}
    due = {(c['market'], c['symbol']) for c in coverage
           if refresh_due(c, latest.get((c['market'], c['symbol'])), fields, mode, now)}
    return [m for m in members if (m['market'], m['symbol']) in due]
