"""Pause API distinguishes queued work from terminal and partial failures."""
from unittest.mock import Mock
from inspect import unwrap

import pytest
from flask import Flask, g

from app.routes import strategy as routes


@pytest.mark.parametrize("close_positions,result,http_status,message,persist", [
    (False, {"success": True, "status": "stopping", "command_id": 7}, 202, "strategyV2.stopQueued", True),
    (True, {"success": True, "status": "stopping", "command_id": 7}, 202, "strategyV2.stopQueued", True),
    (False, {"success": True, "status": "stopped"}, 200, "strategyV2.paused", True),
    (True, {"success": True, "status": "stopped", "close_orders_queued": 1}, 200, "strategyV2.stoppedAndCloseQueued", True),
    (False, {"success": False, "status": "running"}, 409, "strategyV2.stopFailed", False),
    (True, {"success": False, "status": "running"}, 409, "strategyV2.stopFailed", False),
    (True, {"success": False, "status": "stopped", "close_errors": ["strategyV2.closeRunIdentityMissing"]}, 409, "strategyV2.stopClosePartialFailure", True),
])
def test_stop_response_matches_execution_state(monkeypatch, close_positions, result, http_status, message, persist):
    service = Mock()
    executor = Mock()
    executor.stop_strategy_with_policy.return_value = result
    monkeypatch.setattr(routes, "_strategy", lambda _: {"id": 20})
    monkeypatch.setattr(routes, "get_strategy_service", lambda: service)
    monkeypatch.setattr(routes, "get_trading_executor", lambda: executor)
    app = Flask(__name__)
    with app.test_request_context(json={"close_positions": close_positions}):
        g.user_id = 1
        response = app.make_response(unwrap(routes.stop_strategy)(20))
    assert response.status_code == http_status
    assert response.json["msg"] == message
    assert response.json["data"] == {"id": 20, **result}
    assert service.update_strategy_status.called is persist
    executor.stop_strategy_with_policy.assert_called_once_with(20, close_positions=close_positions)
