import pytest

from app.services.live_trading import funding_reconciliation


def test_funding_allocation_includes_legacy_credentials_and_symbol_aliases(monkeypatch):
    captured = {}

    class Cursor:
        def execute(self, sql, params):
            captured["sql"] = sql
            captured["params"] = params

        def fetchall(self):
            return [
                {
                    "strategy_id": 1,
                    "symbol": "BTCUSDT",
                    "symbol_canonical": "",
                    "size": 1.0,
                },
                {
                    "strategy_id": 2,
                    "symbol": "BTC/USDT:USDT",
                    "symbol_canonical": "",
                    "size": 3.0,
                },
                {
                    "strategy_id": 3,
                    "symbol": "ETH/USDT",
                    "symbol_canonical": "",
                    "size": 8.0,
                },
            ]

        def close(self):
            return None

    class Db:
        def cursor(self):
            return Cursor()

    class DbContext:
        def __enter__(self):
            return Db()

        def __exit__(self, *_args):
            return False

    monkeypatch.setattr(
        funding_reconciliation,
        "get_db_connection",
        lambda: DbContext(),
    )

    result = funding_reconciliation._position_allocations(
        credential_id=7,
        symbol="BTC/USDT",
        fallback_strategy_id=9,
    )

    assert result == [(1, pytest.approx(0.25)), (2, pytest.approx(0.75))]
    assert "s.exchange_config::jsonb" in captured["sql"]
    assert captured["params"] == (7, "7")
