import inspect

from flask import g

from app.routes import fast_analysis as routes


def test_professional_response_payload_excludes_legacy_report_fields():
    report = {"schema_version": "professional_report_v1", "report_id": "report_test"}
    payload = routes._professional_response_payload({
        "professional_report": report,
        "memory_id": 12,
        "analysis_time_ms": 345,
        "decision": "BUY",
        "trading_plan": {"entry_price": 1},
    }, credits_charged=10, remaining_credits=90)

    assert payload["schema_version"] == "professional_analysis_envelope_v1"
    assert payload["report"] == report
    assert payload["runtime"]["memory_id"] == 12
    assert payload["billing"] == {"credits_charged": 10, "remaining_credits": 90}
    assert "decision" not in payload
    assert "trading_plan" not in payload


def test_data_source_route_exposes_two_tiers_without_secret_values(app, monkeypatch):
    monkeypatch.setenv("COINGLASS_API_KEY", "must-not-leak")
    with app.test_request_context("/api/fast-analysis/data-sources?market=Crypto"):
        g.user_id = 7
        response = inspect.unwrap(routes.get_professional_report_data_sources)()

    payload = response.get_json()
    assert payload["code"] == 1
    assert payload["data"]["tiers"] == ["community", "professional"]
    assert payload["data"]["default_tier"] == "community"
    assert all(item["markets"] == ["Crypto"] for item in payload["data"]["items"])
    assert "must-not-leak" not in str(payload)


def test_history_and_feedback_are_scoped_to_authenticated_user(app, monkeypatch):
    calls = {}

    class Memory:
        def get_recent(self, *args, **kwargs):
            calls["recent"] = (args, kwargs)
            return []

        def record_feedback(self, *args, **kwargs):
            calls["feedback"] = (args, kwargs)
            return True

    monkeypatch.setattr(routes, "get_analysis_memory", lambda: Memory())

    with app.test_request_context("/api/fast-analysis/history?market=Crypto&symbol=ETH/USDT"):
        g.user_id = 23
        response = inspect.unwrap(routes.get_history)()
    assert response.get_json()["code"] == 1
    assert calls["recent"][1]["user_id"] == 23

    with app.test_request_context(
        "/api/fast-analysis/feedback",
        method="POST",
        json={"memory_id": 9, "feedback": "helpful"},
    ):
        g.user_id = 23
        response = inspect.unwrap(routes.submit_feedback)()
    assert response.get_json()["code"] == 1
    assert calls["feedback"][1]["user_id"] == 23
