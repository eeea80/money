"""Field-level coverage at a user-selected observation date."""
import json
import math
from datetime import date

from app.services.fundamental_data import FUNDAMENTAL_FIELDS, get_fundamental_data_service
from app.services.fundamental_sync import fields_for, members_for, query

STALE_REPORT_AGE_DAYS = 200


def member_coverage(members, fields, as_of, source=None):
    get_fundamental_data_service().ensure_schema()
    fields = fields_for(fields)
    as_of = date.fromisoformat(str(as_of)[:10])
    rows = query('''SELECT DISTINCT ON (market,symbol) * FROM qd_fundamental_snapshots
        WHERE symbol=ANY(%s) AND available_at<=%s AND (%s IS NULL OR source=%s)
        ORDER BY market,symbol,available_at DESC,ingested_at DESC,period_end DESC''',
        ([item['symbol'] for item in members], as_of, source, source), True)
    found = {(r['market'], r['symbol']): r for r in rows}
    result = []
    for member in members:
        row = found.get((member['market'], member['symbol'])) or {}
        missing = []
        for field in fields:
            value = row.get(field)
            valid = isinstance(value, (float, int)) and math.isfinite(value)
            if field in {'market_cap', 'shares_outstanding'}:
                valid = valid and value > 0
            if not valid:
                missing.append(field)
        period_end = row.get('period_end')
        age_days = (as_of - period_end).days if period_end else None
        stale = age_days is not None and age_days > STALE_REPORT_AGE_DAYS
        state = 'no_data' if not row else 'stale' if stale else 'partial' if missing else 'ready'
        metadata = row.get('metadata_json') or {}
        if isinstance(metadata, str):
            try:
                metadata = json.loads(metadata)
            except (TypeError, ValueError):
                metadata = {}
        result.append(dict(market=member['market'], symbol=member['symbol'], missing=missing, stale=stale,
            age_days=age_days, stale_after_days=STALE_REPORT_AGE_DAYS, state=state,
            available_at=row.get('available_at'), period_end=period_end, source=row.get('source'),
            availability_basis=metadata.get('availabilitySource') or 'provider_snapshot' if row else None,
            ingested_at=row.get('ingested_at'), ready=state == 'ready'))
    return result


def coverage_for(user_id, universe_id, fields=None, as_of=None, mode=None):
    fields = fields_for(fields)
    members = members_for(user_id, universe_id)
    source = 'yfinance_quarterly' if mode == 'history' else None
    rows = member_coverage(members, fields, as_of or date.today(), source=source)
    return dict(as_of=str(as_of or date.today()), fields=fields, acceptance_fields=fields,
        collected_fields=list(FUNDAMENTAL_FIELDS), available_fields=list(FUNDAMENTAL_FIELDS),
        stale_after_days=STALE_REPORT_AGE_DAYS, total=len(rows),
        ready=sum(item['ready'] for item in rows), items=rows)
