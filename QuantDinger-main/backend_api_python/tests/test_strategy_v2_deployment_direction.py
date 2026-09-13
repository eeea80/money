import json

import pytest

from app.services.strategy_v2.contract import StrategyV2ContractError
from app.services.strategy_v2.deployment import StrategyV2DeploymentService
from app.services.strategy_v2 import deployment


SOURCE = """
def initialize(context):
    context.set_universe(["Crypto:BTC/USDT@okx:swap"])
    context.subscribe(frequency="1h")
    context.set_metadata(direction_mode="both")

def handle_data(context, data):
    pass
"""


class _Cursor:
    lastrowid = 41
    rowcount = 1

    def __init__(self):
        self.params = ()

    def execute(self, _query, params=()):
        self.params = params

    def close(self):
        return None


class _Db:
    def __init__(self, cursor):
        self._cursor = cursor

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def cursor(self):
        return self._cursor

    def commit(self):
        return None


class _Sources:
    @staticmethod
    def get_source(_source_id, user_id=None):
        return {"id": 9, "name": "Dual strategy", "code": SOURCE}


def _payload(direction_mode):
    return {
        "sourceId": 9,
        "name": "Dual strategy",
        "initialCapital": 1_000,
        "executionMode": "signal",
        "directionMode": direction_mode,
    }


def test_deployment_persists_manifest_direction_and_legacy_position_side(monkeypatch):
    cursor = _Cursor()
    monkeypatch.setattr(deployment, "get_script_source_service", lambda: _Sources())
    monkeypatch.setattr(deployment, "get_db_connection", lambda: _Db(cursor))

    strategy_id = StrategyV2DeploymentService().save(user_id=7, payload=_payload("both"))
    trading_config = json.loads(cursor.params[-1])

    assert strategy_id == 41
    assert trading_config["direction_mode"] == "both"
    assert trading_config["position_side"] == "neutral"
    assert trading_config["strategy_manifest"]["directionMode"] == "both"


def test_deployment_rejects_direction_override_that_conflicts_with_manifest(monkeypatch):
    monkeypatch.setattr(deployment, "get_script_source_service", lambda: _Sources())

    with pytest.raises(StrategyV2ContractError, match="strategyV2.directionModeMismatch"):
        StrategyV2DeploymentService().save(user_id=7, payload=_payload("long_only"))


def test_deployment_recovers_legacy_visual_grid_runtime_from_executor_type(monkeypatch):
    class _GridSources:
        @staticmethod
        def get_source(_source_id, user_id=None):
            return {
                "id": 9,
                "name": "Grid strategy",
                "code": SOURCE,
                "metadata": {
                    "last_run_config": {
                        "strategy_family": "robot",
                        "executor_type": "grid",
                        "executor_config": {"grid_count": 4},
                        "bot_params": {
                            "gridCount": 4,
                            "gridCountUnit": "cells",
                            "amountPerGrid": 2,
                        },
                    },
                },
            }

    cursor = _Cursor()
    monkeypatch.setattr(deployment, "get_script_source_service", lambda: _GridSources())
    monkeypatch.setattr(deployment, "get_db_connection", lambda: _Db(cursor))

    StrategyV2DeploymentService().save(user_id=7, payload=_payload("both"))
    trading_config = json.loads(cursor.params[-1])

    assert trading_config["bot_type"] == "grid"
    assert trading_config["executor_type"] == "grid"
    assert trading_config["bot_params"]["amountPerGridPct"] == pytest.approx(0.25)


def test_deployment_recovers_grid_contract_from_legacy_root_metadata(monkeypatch):
    class _LegacyGridSources:
        @staticmethod
        def get_source(_source_id, user_id=None):
            return {
                "id": 9,
                "name": "Legacy grid strategy",
                "code": SOURCE,
                "metadata": {
                    "executor_type": "grid",
                    "executor_config": {
                        "side": "long",
                        "start_price": 90,
                        "end_price": 110,
                        "grid_count": 5,
                        "total_amount_quote": 500,
                        "initial_position_pct": 0.6,
                        "max_open_orders": 4,
                        "dynamic_anchor": True,
                    },
                },
            }

    cursor = _Cursor()
    monkeypatch.setattr(deployment, "get_script_source_service", lambda: _LegacyGridSources())
    monkeypatch.setattr(deployment, "get_db_connection", lambda: _Db(cursor))

    StrategyV2DeploymentService().save(user_id=7, payload=_payload("both"))
    trading_config = json.loads(cursor.params[-1])

    assert trading_config["strategy_family"] == "robot"
    assert trading_config["executor_type"] == "grid"
    assert trading_config["bot_type"] == "grid"
    assert trading_config["entry_trigger_mode"] == "exchange_resting_orders"
    assert trading_config["bot_params"]["gridCount"] == 5
    assert trading_config["bot_params"]["lowerPrice"] == pytest.approx(90)
    assert trading_config["bot_params"]["upperPrice"] == pytest.approx(110)
    assert trading_config["bot_params"]["amountPerGridPct"] == pytest.approx(0.2)


def test_deployment_manifest_overrides_stale_editor_symbol_and_market_type(monkeypatch):
    stock_source = """
def initialize(context):
    context.set_universe(["USStock:SPY"])
    context.subscribe(frequency="1d")

def handle_data(context, data):
    pass
"""

    class _StockSources:
        @staticmethod
        def get_source(_source_id, user_id=None):
            return {
                "id": 9,
                "name": "Stock strategy",
                "code": stock_source,
                "metadata": {
                    "last_run_config": {
                        "symbol": "BTC/USDT",
                        "market_type": "swap",
                    },
                },
            }

    cursor = _Cursor()
    monkeypatch.setattr(deployment, "get_script_source_service", lambda: _StockSources())
    monkeypatch.setattr(deployment, "get_db_connection", lambda: _Db(cursor))

    StrategyV2DeploymentService().save(user_id=7, payload=_payload(""))
    trading_config = json.loads(cursor.params[-1])

    assert trading_config["symbol"] == "SPY"
    assert trading_config["market_type"] == "spot"
