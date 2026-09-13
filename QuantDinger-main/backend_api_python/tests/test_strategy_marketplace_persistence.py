import json

from app.services import community_service
from app.services.community_service import CommunityService


SOURCE = '''
def initialize(context):
    g.symbol = "USStock:SPY"
    context.set_universe([g.symbol])
    context.subscribe(frequency="1d")
    context.set_metadata(direction_mode="long_only")

def handle_data(context, data):
    pass
'''


class _Cursor:
    lastrowid = 77

    def __init__(self):
        self.executions = []
        self._fetch_results = []

    def execute(self, sql, params=()):
        params = tuple(params)
        self.executions.append((sql, params))
        assert sql.count('?') == len(params), (sql, params)

    def fetchone(self):
        return self._fetch_results.pop(0) if self._fetch_results else None

    def close(self):
        return None


class _Db:
    def __init__(self, cursor):
        self._cursor = cursor
        self.committed = False

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def cursor(self):
        return self._cursor

    def commit(self):
        self.committed = True


def test_publish_persists_derived_contract_and_search_indexes(monkeypatch):
    cursor = _Cursor()
    db = _Db(cursor)
    monkeypatch.setattr(community_service, 'get_db_connection', lambda: db)

    ok, message, data = CommunityService().publish_script_template_from_strategy(
        user_id=9,
        strategy_id=0,
        source_id=12,
        name='Portable SPY strategy',
        description='test',
        code=SOURCE,
        is_admin=True,
    )

    assert ok is True
    assert message == 'success'
    assert data['indicator_id'] == 77
    assert data['marketplace_contract']['binding_mode'] == 'parameterized'
    assert data['marketplace_contract']['bound_instruments'] == ['USStock:SPY']
    assert db.committed is True

    sql, params = cursor.executions[-1]
    assert 'marketplace_contract' in sql
    assert 'marketplace_binding_mode' in sql
    assert 'marketplace_execution_frequency' in sql
    assert 'marketplace_confirmation_frequencies' in sql
    contract = next(json.loads(value) for value in params if isinstance(value, str) and value.startswith('{'))
    assert contract['contract_version'] == 2
    assert contract['binding_mode'] == 'parameterized'


def test_republish_updates_listing_resolved_by_source_id(monkeypatch):
    cursor = _Cursor()
    cursor._fetch_results = [{'id': 41}]
    db = _Db(cursor)
    monkeypatch.setattr(community_service, 'get_db_connection', lambda: db)

    ok, message, data = CommunityService().publish_script_template_from_strategy(
        user_id=9,
        strategy_id=0,
        source_id=12,
        name='Updated SPY strategy',
        description='new version',
        code=SOURCE,
        is_admin=True,
    )

    assert ok is True
    assert message == 'success'
    assert data['indicator_id'] == 41
    assert data['publication_action'] == 'updated'
    statements = [sql for sql, _params in cursor.executions]
    assert any('pg_advisory_xact_lock' in sql for sql in statements)
    assert any('source_script_source_id = ?' in sql and 'SELECT id' in sql for sql in statements)
    assert any('UPDATE qd_indicator_codes' in sql for sql in statements)
    assert not any('INSERT INTO qd_indicator_codes' in sql for sql in statements)
