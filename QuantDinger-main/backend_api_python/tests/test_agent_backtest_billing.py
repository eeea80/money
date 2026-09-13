"""Agent HTTP billing contracts; real money-state concurrency is checked in PostgreSQL integration."""
from contextlib import contextmanager
from unittest.mock import Mock

import pytest

from app.routes.agent_v1 import backtests
from app.services.billing_service import BillingError
from app.utils import agent_auth


@pytest.fixture
def submission(monkeypatch):
    token = {"id": 7, "user_id": 5, "scopes": "R,B", "markets": "*", "instruments": "*",
             "status": "active", "rate_limit_per_min": 100, "expires_at": None}
    agent_auth._schema_ready = True
    agent_auth._rate_state.clear()
    monkeypatch.setattr(agent_auth, "_lookup_token", lambda _: token)
    monkeypatch.setattr(agent_auth, "_touch_token_last_used", lambda *_: None)
    monkeypatch.setattr(agent_auth, "_audit", lambda *a, **kw: None)
    monkeypatch.setattr(agent_auth, "_reserve_idempotency", lambda *_: ("reserved", None))
    monkeypatch.setattr(agent_auth, "_complete_idempotency", lambda *_: None)
    monkeypatch.setattr(backtests, "count_active_jobs", lambda **kw: 0)
    monkeypatch.setattr(backtests, "_validate_request", lambda _: (None, None))

    @contextmanager
    def no_existing(_):
        yield None

    monkeypatch.setattr(backtests, "with_idempotency", no_existing)
    submit = Mock(return_value={"job_id": "job-1", "status": "queued", "billing": {
        "charged": 30, "remaining": 70, "referenceId": "agent-backtest:job-1", "transactionId": 10}})
    monkeypatch.setattr(backtests, "submit_job", submit)
    yield submit
    agent_auth._rate_state.clear()


def post(client, **payload):
    return client.post("/api/agent/v1/backtest/run", json={"code": "test", **payload}, headers={
        "Authorization": "Bearer qd_agent_BILLINGTEST12345", "Idempotency-Key": "billing-test"})


def test_submit_returns_billing_receipt_and_uses_token_owner(client, submission):
    response = post(client)
    assert response.status_code == 202
    assert response.get_json()["data"]["billing"]["transactionId"] == 10
    assert submission.call_args.kwargs["user_id"] == 5
    assert submission.call_args.kwargs["request_payload"]["__user_id"] == 5


def test_insufficient_balance_returns_402_with_shortage(client, submission):
    submission.side_effect = BillingError("INSUFFICIENT_CREDITS", status=402,
        details={"feature": "backtest", "current": 12, "required": 30, "shortage": 18})
    response = post(client)
    assert response.status_code == 402
    assert response.get_json()["details"]["shortage"] == 18
    assert response.get_json()["retriable"] is False


def test_database_failure_is_not_accepted_as_a_free_job(client, submission):
    submission.side_effect = RuntimeError("database unavailable")
    response = post(client)
    assert response.status_code == 503
    assert response.get_json()["message"] == "BILLING_OR_JOB_UNAVAILABLE"


def test_dispatch_failure_returns_refund_receipt(client, submission):
    submission.return_value = {"job_id": "job-1", "status": "failed", "billing": {
        "charged": 30, "refunded": 30, "status": "refunded", "refundTransactionId": 11}}
    response = post(client)
    assert response.status_code == 503
    assert response.get_json()["details"]["billing"]["refundTransactionId"] == 11


def test_invalid_request_is_not_charged(client, submission, monkeypatch):
    monkeypatch.setattr(backtests, "_validate_request", lambda _: (None, backtests.error(400, "invalid")))
    assert post(client).status_code == 400
    submission.assert_not_called()


def test_replay_receipt_precedes_concurrency_limit(client, submission, monkeypatch):
    @contextmanager
    def existing(_):
        yield {"job_id": "original", "status": "queued", "request": {"__billing": {"charged": 30}}}

    monkeypatch.setattr(backtests, "with_idempotency", existing)
    monkeypatch.setattr(backtests, "count_active_jobs", lambda **kw: 999)
    response = post(client)
    assert response.status_code == 200
    assert response.get_json()["data"]["billing"]["charged"] == 30
    assert response.get_json()["data"]["duplicate"] is True
    submission.assert_not_called()


def test_client_cannot_inject_billing_receipt(app):
    with app.test_request_context("/"):
        _, error = backtests._validate_request({"code": "test", "__billing": {"charged": 0}})
        assert error[1] == 400


@pytest.mark.parametrize("status", ["succeeded", "failed", "cancelled", "running"])
def test_celery_delivery_does_not_repeat_claimed_or_terminal_job(monkeypatch, status):
    from app.tasks import agent_jobs as tasks
    from app.utils import agent_jobs

    monkeypatch.setattr(agent_jobs, "get_job_for_worker", lambda _: {"status": status, "kind": "backtest"})
    monkeypatch.setattr(agent_jobs, "_set_status", lambda *a, **kw: False)
    execute = Mock()
    monkeypatch.setattr(tasks, "_execute", execute)
    tasks.execute_agent_job.run("existing")
    execute.assert_not_called()


@pytest.mark.parametrize("fails", [False, True])
def test_celery_worker_uses_atomic_terminal_helpers(monkeypatch, fails):
    from app.tasks import agent_jobs as tasks
    from app.utils import agent_jobs

    monkeypatch.setattr(agent_jobs, "get_job_for_worker", lambda _: {
        "status": "queued", "kind": "backtest", "request": {"__billing": {"charged": 30}}})
    monkeypatch.setattr(agent_jobs, "_set_status", lambda *a, **kw: True)
    monkeypatch.setattr(agent_jobs, "_publish_progress", Mock())
    success, failure = Mock(return_value=True), Mock(return_value=True)
    monkeypatch.setattr(agent_jobs, "_set_result", success)
    monkeypatch.setattr(agent_jobs, "_set_failure", failure)
    monkeypatch.setattr(tasks, "_execute", Mock(side_effect=ValueError("test failure")) if fails
                        else Mock(return_value={"runId": 123}))
    if fails:
        with pytest.raises(ValueError, match="test failure"):
            tasks.execute_agent_job.run("new")
        failure.assert_called_once_with("new", "test failure")
        success.assert_not_called()
    else:
        tasks.execute_agent_job.run("new")
        success.assert_called_once_with("new", {"runId": 123})
        failure.assert_not_called()


def test_periodic_orphan_recovery_is_scheduled():
    from app.celery_app import celery_app

    schedule = celery_app.conf.beat_schedule["expire-billed-agent-jobs"]
    assert schedule["task"] == "quantdinger.tasks.expire_agent_jobs"
    assert schedule["schedule"] == 60
    assert celery_app.conf.task_routes[schedule["task"]]["queue"] == "maintenance"
