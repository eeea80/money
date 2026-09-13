from unittest.mock import Mock

import pytest

from app.routes.agent_v1 import backtests


def _payload():
    return {
        "__user_id": 42,
        "code": "def initialize(context): pass",
        "startDate": "2026-06-13",
        "endDate": "2026-09-10",
        "initialCapital": 10000,
        "commission": 0.001,
        "slippage": 0.0005,
    }


def test_agent_backtest_persists_for_job_owner_and_returns_history_id(monkeypatch):
    original_result = {"totalReturn": 16.05, "executions": [{"side": "buy"}]}
    service = Mock()
    service.run.return_value = (123, original_result)
    monkeypatch.setattr(backtests, "_backtest", service)
    progress = []

    result = backtests._run_backtest(_payload(), on_progress=progress.append)

    service.run.assert_called_once()
    arguments = service.run.call_args.kwargs
    assert arguments["persist"] is True
    assert arguments["user_id"] == 42
    assert arguments["initial_capital"] == 10000
    assert arguments["commission"] == 0.001
    assert arguments["slippage"] == 0.0005
    assert arguments["start_date"].isoformat() == "2026-06-13T00:00:00"
    assert arguments["end_date"].isoformat() == "2026-09-10T23:59:59"
    assert result == {**original_result, "runId": 123}
    assert "runId" not in original_result
    assert progress[-1]["phase"] == "finalizing"


def test_agent_backtest_persistence_failure_is_not_reported_as_success(monkeypatch):
    service = Mock()
    service.run.side_effect = RuntimeError("database unavailable")
    monkeypatch.setattr(backtests, "_backtest", service)
    progress = []

    with pytest.raises(RuntimeError, match="database unavailable"):
        backtests._run_backtest(_payload(), on_progress=progress.append)

    assert service.run.call_args.kwargs["persist"] is True
    assert all(event["phase"] != "finalizing" for event in progress)
