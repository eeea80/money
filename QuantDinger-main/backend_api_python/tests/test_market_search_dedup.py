"""Execute search SQL against duplicate catalog rows before pagination."""
from contextlib import contextmanager
import sqlite3

import pytest

from app.data import market_symbols_seed as symbols


@pytest.fixture
def catalog(monkeypatch):
    db = sqlite3.connect(':memory:')
    db.row_factory = lambda cursor, row: dict(zip([x[0] for x in cursor.description], row))
    db.executescript('''
        CREATE TABLE qd_market_symbols (
            id INTEGER, market TEXT, symbol TEXT, name TEXT,
            sort_order INTEGER, is_active INTEGER, is_hot INTEGER
        );
        CREATE TABLE qd_market_symbol_aliases (
            market TEXT, symbol TEXT, alias TEXT, is_active INTEGER
        );
        INSERT INTO qd_market_symbols VALUES
            (1, 'USStock', 'NVDA', 'NVIDIA', 100, 1, 0),
            (2, 'USStock', 'nvda', 'Duplicate NVIDIA', 90, 1, 1),
            (3, 'USStock', 'NVDL', 'NVIDIA ETF', 80, 1, 1),
            (4, 'USStock', 'NVDX', 'NVIDIA inactive', 200, 0, 1),
            (5, 'HKStock', 'NVDA', 'Different market', 100, 1, 1);
        INSERT INTO qd_market_symbol_aliases VALUES
            ('USStock', 'NVDA', 'GPU', 1),
            ('USStock', 'NVDL', 'GPU', 1);
    ''')

    @contextmanager
    def connect():
        yield db

    monkeypatch.setattr(symbols, '_get_db_connection', connect)
    yield db
    db.close()


def test_exact_match_collapses_case_variants_and_preserves_market(catalog):
    assert symbols.search_symbols('USStock', 'nvda') == [
        {'market': 'USStock', 'symbol': 'NVDA', 'name': 'NVIDIA'}
    ]
    assert symbols.search_symbols('HKStock', 'NVDA')[0]['name'] == 'Different market'


@pytest.mark.parametrize('keyword', ['NVD', 'NVIDIA', 'GPU'])
def test_limit_applies_after_deduplication(catalog, keyword):
    rows = symbols.search_symbols('USStock', keyword, limit=2)
    assert [x['symbol'] for x in rows] == ['NVDA', 'NVDL']


def test_hot_symbols_and_missing_alias_table_still_deduplicate(catalog):
    assert [x['symbol'] for x in symbols.get_hot_symbols('USStock', limit=2)] == ['NVDA', 'NVDL']
    catalog.execute('DROP TABLE qd_market_symbol_aliases')
    assert [x['symbol'] for x in symbols.search_symbols('USStock', 'NVD', limit=2)] == ['NVDA', 'NVDL']
