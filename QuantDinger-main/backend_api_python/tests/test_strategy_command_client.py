"""Durable strategy command client tests."""

from __future__ import annotations

from dataclasses import replace

import pytest

from app.services.strategy_command_client import StrategyCommandClient
from app.services.strategy_command_repository import StrategyCommand


class FakeRepository:
    def __init__(self, status: str = "pending") -> None:
        self.status = status
        self.commands = []

    def enqueue(self, *, strategy_id, command_type, **kwargs):
        command = StrategyCommand(
            id=len(self.commands) + 1,
            strategy_id=int(strategy_id),
            user_id=0,
            command_type=command_type,
            status=self.status,
            idempotency_key=f"key-{len(self.commands) + 1}",
            payload=dict(kwargs.get("payload") or {}),
        )
        self.commands.append(command)
        return command

    def get(self, command_id):
        command = self.commands[int(command_id) - 1]
        return replace(command, status=self.status, error_message="executor failed")

    def has_active_strategy_lease(self, strategy_id):
        return int(strategy_id) == 42


def test_start_is_accepted_while_worker_is_processing():
    repository = FakeRepository(status="processing")
    client = StrategyCommandClient(repository)

    assert client.start_strategy(42) is True
    running, detail = client.wait_strategy_running(42, timeout=0)

    assert running is True
    assert detail == "strategyV2.startQueued"
    assert repository.commands[0].command_type == "start"


def test_start_reports_terminal_worker_failure():
    repository = FakeRepository(status="failed")
    client = StrategyCommandClient(repository)

    assert client.start_strategy(7) is True
    running, detail = client.wait_strategy_running(7, timeout=0)

    assert running is False
    assert detail == "executor failed"


def test_stop_uses_durable_command(monkeypatch):
    repository = FakeRepository(status="succeeded")
    client = StrategyCommandClient(repository)
    monkeypatch.setenv("STRATEGY_COMMAND_STOP_WAIT_SEC", "0")

    assert client.stop_strategy(9, persist_status=False) is True
    assert repository.commands[0].command_type == "stop"


def test_is_running_uses_durable_runtime_lease():
    client = StrategyCommandClient(FakeRepository())

    assert client.is_running(42) is True
    assert client.is_running(7) is False


def test_stop_policy_forwards_close_positions(monkeypatch):
    repository = FakeRepository(status="succeeded")
    client = StrategyCommandClient(repository)
    monkeypatch.setenv("STRATEGY_COMMAND_STOP_WAIT_SEC", "0")

    result = client.stop_strategy_with_policy(9, close_positions=True)

    assert result["success"] is True
    assert result["close_requested"] is True
    assert repository.commands[0].payload == {"close_positions": True}


@pytest.mark.parametrize("status", ["pending", "processing"])
@pytest.mark.parametrize("close_positions", [False, True])
def test_stop_wait_timeout_preserves_accepted_command(monkeypatch, status, close_positions):
    repository = FakeRepository(status=status)
    client = StrategyCommandClient(repository)
    monkeypatch.setenv("STRATEGY_COMMAND_STOP_WAIT_SEC", "5")
    monkeypatch.setattr(client, "_wait", lambda command_id, timeout: repository.get(command_id))

    result = client.stop_strategy_with_policy(9, close_positions=close_positions)

    assert result["success"] is True
    assert result["status"] == "stopping"
    assert result["command_id"] == repository.commands[0].id
    assert result["close_requested"] is close_positions
    assert result["close_orders_queued"] == 0
    assert result["close_errors"] == []


@pytest.mark.parametrize("status", ["failed", "cancelled"])
def test_terminal_stop_failure_is_not_accepted(monkeypatch, status):
    client = StrategyCommandClient(FakeRepository(status=status))
    result = client.stop_strategy_with_policy(9)
    assert result["success"] is False
    assert result["status"] == "running"
    assert result["command_id"] == 1


def test_stop_enqueue_failure_is_not_accepted(monkeypatch):
    repository = FakeRepository()
    def fail(**kwargs):
        raise RuntimeError("queue unavailable")
    monkeypatch.setattr(repository, "enqueue", fail)
    result = StrategyCommandClient(repository).stop_strategy_with_policy(9)
    assert result["success"] is False
    assert "command_id" not in result
