from app.services.strategy_v2 import live_execution
from app.services.strategy_v2.live_execution import LiveOrderRequest, StrategyV2OrderGateway


class _Cursor:
    def __init__(self, row):
        self.row = row
        self.params = ()

    def execute(self, _query, params):
        self.params = tuple(params)

    def fetchone(self):
        return self.row

    def close(self):
        return None


class _Db:
    def __init__(self, cursor):
        self._cursor = cursor

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def cursor(self):
        return self._cursor


def _request(action="open_long"):
    return LiveOrderRequest(
        strategy_id=7,
        strategy_run_id=42,
        user_id=12,
        symbol="BTC/USDT",
        action=action,
        quantity=0.01,
        reference_price=60_000.0,
        signal_timestamp=123,
        market_type="swap",
        execution_mode="live",
    )


def test_inflight_lookup_serializes_the_same_long_position_leg(monkeypatch):
    cursor = _Cursor({"id": 99})
    monkeypatch.setattr(live_execution, "get_db_connection", lambda: _Db(cursor))

    assert StrategyV2OrderGateway().has_inflight(_request("close_long")) is True
    assert cursor.params[:3] == (7, 42, "BTC/USDT")
    assert cursor.params[3:7] == (
        "open_long",
        "add_long",
        "reduce_long",
        "close_long",
    )
    assert cursor.params[7:] == ("pending", "processing", "sent", "syncing")


def test_inflight_lookup_keeps_short_hedge_leg_independent(monkeypatch):
    cursor = _Cursor({})
    monkeypatch.setattr(live_execution, "get_db_connection", lambda: _Db(cursor))

    assert StrategyV2OrderGateway().has_inflight(_request("open_short")) is False
    assert cursor.params[3:7] == (
        "open_short",
        "add_short",
        "reduce_short",
        "close_short",
    )
