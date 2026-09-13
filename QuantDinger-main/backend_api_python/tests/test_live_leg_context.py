from contextlib import contextmanager

from app.services.live_trading import leg_context
from app.services.live_trading.strategy_position_sync import strategy_uses_fill_ledger


def test_resolve_leg_context_accepts_postgres_jsonb_dict(monkeypatch):
    class Cursor:
        def execute(self, _query, _params):
            return None

        def fetchone(self):
            return {
                "market_type": "swap",
                "exchange_config": {
                    "credential_id": 42,
                    "exchange_id": "gate",
                },
            }

        def close(self):
            return None

    class Db:
        def cursor(self):
            return Cursor()

    @contextmanager
    def fake_connection():
        yield Db()

    monkeypatch.setattr(leg_context, "get_db_connection", fake_connection)

    resolved = leg_context.resolve_leg_context(
        strategy_id=9,
        symbol="BTC/USDT",
        market_type="swap",
        fill_source="grid_market",
    )

    assert resolved.credential_id == 42
    assert resolved.inst_id == "BTC-USDT-SWAP"
    assert resolved.fill_source == "grid_market"


def test_grid_defaults_to_fill_ledger_without_explicit_flag():
    assert strategy_uses_fill_ledger(
        {
            "bot_type": "grid",
            "trading_config": {"market_type": "swap"},
        }
    )
    assert strategy_uses_fill_ledger(
        {
            "trading_config": {
                "executor_type": "grid",
                "market_type": "swap",
            },
        }
    )


def test_grid_cannot_disable_fill_ledger_ownership():
    assert strategy_uses_fill_ledger(
        {
            "bot_type": "grid",
            "trading_config": {"position_ledger": "exchange"},
        }
    )
def test_alpaca_stock_and_crypto_fills_share_spot_bucket_with_unique_instruments():
    from app.services.live_trading.leg_context import resolve_leg_context, inst_id_for_symbol
    for symbol, asset_class in [("NVDA", "USStock"), ("AAPL", "USStock"), ("BTC/USD", "crypto")]:
        leg = resolve_leg_context(strategy_id=1, symbol=symbol, market_type=asset_class,
                                  exchange_config={"exchange_id": "alpaca", "credential_id": 33})
        assert leg.market_type == "spot"
        assert leg.inst_id == symbol
        assert inst_id_for_symbol(symbol, "spot", "alpaca") == symbol
