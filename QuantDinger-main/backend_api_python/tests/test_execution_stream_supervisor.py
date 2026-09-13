from __future__ import annotations

import json

from app.services.execution_streams import supervisor as supervisor_module
from app.services.execution_streams.supervisor import ExecutionStreamSupervisor


def test_stream_discovery_only_loads_credentials_used_by_active_work(monkeypatch):
    service = ExecutionStreamSupervisor()
    service._max_adapters = 64
    requested_ids: list[int] = []

    monkeypatch.setattr(service, "_symbols_by_credential", lambda: {7: {"BTC/USDT"}})

    def credential_rows(ids):
        requested_ids.extend(ids)
        return [{
            "id": 7,
            "user_id": 3,
            "exchange_id": "binance",
            "encrypted_config": "encrypted",
        }]

    monkeypatch.setattr(service, "_credential_rows", credential_rows)
    monkeypatch.setattr(
        supervisor_module,
        "decrypt_credential_blob",
        lambda _value: json.dumps({"market_scope": "spot"}),
    )

    specs = service._discover_specs()

    assert requested_ids == [7]
    assert [spec.key for spec in specs] == ["binance:7:spot"]
    assert specs[0].symbols == ("BTC/USDT",)


def test_stream_discovery_applies_adapter_cap_and_uses_rest_for_overflow(monkeypatch):
    service = ExecutionStreamSupervisor()
    service._max_adapters = 1
    monkeypatch.setattr(
        service,
        "_symbols_by_credential",
        lambda: {7: {"BTC/USDT"}, 8: {"ETH/USDT"}},
    )
    monkeypatch.setattr(
        service,
        "_credential_rows",
        lambda _ids: [
            {
                "id": 7,
                "user_id": 3,
                "exchange_id": "binance",
                "encrypted_config": "first",
            },
            {
                "id": 8,
                "user_id": 3,
                "exchange_id": "gate",
                "encrypted_config": "second",
            },
        ],
    )
    monkeypatch.setattr(
        supervisor_module,
        "decrypt_credential_blob",
        lambda _value: json.dumps({"market_scope": "spot"}),
    )

    specs = service._discover_specs()

    assert len(specs) == 1
    assert specs[0].key == "binance:7:spot"


def test_active_stream_query_excludes_stopped_and_signal_strategies(monkeypatch):
    executed: list[str] = []

    class Cursor:
        def execute(self, sql, _params=None):
            executed.append(sql)

        def fetchall(self):
            return []

        def close(self):
            return None

    class Connection:
        def cursor(self):
            return Cursor()

    class Context:
        def __enter__(self):
            return Connection()

        def __exit__(self, *_args):
            return False

    monkeypatch.setattr(supervisor_module, "get_db_connection", lambda: Context())

    assert ExecutionStreamSupervisor._symbols_by_credential() == {}
    normalized = " ".join(executed[0].lower().split())
    assert "status, '')) = 'running'" in normalized
    assert "execution_mode, 'signal')) = 'live'" in normalized


def test_symbol_discovery_accepts_legacy_text_configs_and_pending_orders(monkeypatch):
    from contextlib import contextmanager
    from unittest.mock import Mock
    cursor = Mock()
    cursor.fetchall.return_value = [
        {'exchange_config': '{"credential_id": 7}', 'symbol': 'BTC/USDT'},
        {'exchange_config': '{"credentials_id": "8"}', 'symbol': 'ETH/USDT'},
        {'exchange_config': None, 'credential_id': 7, 'symbol': 'SOL/USDT'},
        {'exchange_config': 'invalid legacy JSON', 'symbol': 'XRP/USDT'},
        {'exchange_config': '[]', 'symbol': 'DOGE/USDT'},
    ]
    @contextmanager
    def connection():
        yield Mock(cursor=lambda: cursor)
    monkeypatch.setattr(supervisor_module, 'get_db_connection', connection)
    assert ExecutionStreamSupervisor._symbols_by_credential() == {
        7: {'BTC/USDT', 'SOL/USDT'}, 8: {'ETH/USDT'},
    }
    assert 'exchange_config->>' not in cursor.execute.call_args.args[0]
