"""Saved prompt and coarse Copilot event contracts."""

import inspect
import json

from flask import g

from app.routes import ai_chat as routes
from app.services.ai_copilot_store import ensure_tables


class RecordingCursor:
    def __init__(self):
        self.calls = []
        self.rowcount = 1
        self._one = None
        self._many = []

    def execute(self, sql, params=None):
        normalized = " ".join(str(sql).split())
        self.calls.append((normalized, params))
        if "INSERT INTO qd_ai_saved_prompts" in normalized:
            self._one = {"id": 17}
        elif "SELECT event_type, COUNT(*)" in normalized:
            self._many = [{"event_type": "prompt_used", "count": 4}]
        elif "SELECT task_key, COUNT(*)" in normalized:
            self._many = [{"task_key": "diagnose", "count": 3}]
        return self

    def fetchone(self):
        return self._one

    def fetchall(self):
        rows = self._many
        self._many = []
        return rows

    def close(self):
        return None


class RecordingDb:
    def __init__(self):
        self.cur = RecordingCursor()
        self.committed = False

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def cursor(self):
        return self.cur

    def commit(self):
        self.committed = True


def test_prompt_and_event_tables_are_created():
    cur = RecordingCursor()
    ensure_tables(cur)
    sql = "\n".join(statement for statement, _params in cur.calls)

    assert "CREATE TABLE IF NOT EXISTS qd_ai_saved_prompts" in sql
    assert "CREATE TABLE IF NOT EXISTS qd_ai_copilot_events" in sql
    assert "idx_qd_ai_copilot_events_task" in sql


def test_saved_prompt_is_scoped_and_normalized(app, monkeypatch):
    db = RecordingDb()
    monkeypatch.setattr(routes, "get_db_connection", lambda: db)
    with app.test_request_context(
        "/api/ai/prompt-library",
        method="POST",
        json={
            "title": "  BTC   setup  ",
            "prompt": "Analyze BTC/USDT risk and key levels",
            "category": "trade plan!",
            "context": {"market": "Crypto", "symbol": "BTC/USDT"},
        },
    ):
        g.user_id = 23
        response = inspect.unwrap(routes.save_prompt_library_item)()

    payload = response.get_json()
    insert = next(call for call in db.cur.calls if "INSERT INTO qd_ai_saved_prompts" in call[0])
    assert payload["code"] == 1
    assert payload["data"]["id"] == 17
    assert insert[1] == (23, "BTC setup", "Analyze BTC/USDT risk and key levels", "tradeplan", "Crypto", "BTC/USDT")
    assert db.committed is True


def test_event_tracking_discards_prompt_text_and_unknown_metadata(app, monkeypatch):
    db = RecordingDb()
    monkeypatch.setattr(routes, "get_db_connection", lambda: db)
    with app.test_request_context(
        "/api/ai/events",
        method="POST",
        json={
            "event_type": "prompt_used",
            "task_key": "trade-plan!",
            "prompt": "sensitive prompt text",
            "context": {"market": "USStock", "symbol": "MSFT", "private": "drop"},
            "metadata": {"source": "welcome", "mode": "plan", "secret": "drop"},
        },
    ):
        g.user_id = 23
        response = inspect.unwrap(routes.track_copilot_event)()

    insert = next(call for call in db.cur.calls if "INSERT INTO qd_ai_copilot_events" in call[0])
    stored_context = json.loads(insert[1][3])
    stored_metadata = json.loads(insert[1][4])
    assert response.get_json()["code"] == 1
    assert insert[1][0:3] == (23, "prompt_used", "trade-plan")
    assert stored_context == {"market": "USStock", "symbol": "MSFT"}
    assert stored_metadata == {"source": "welcome", "mode": "plan"}
    assert "sensitive prompt text" not in str(insert[1])


def test_event_summary_returns_personalized_task_counts(app, monkeypatch):
    db = RecordingDb()
    monkeypatch.setattr(routes, "get_db_connection", lambda: db)
    with app.test_request_context("/api/ai/events/summary"):
        g.user_id = 23
        response = inspect.unwrap(routes.get_copilot_event_summary)()

    assert response.get_json()["data"] == {
        "event_counts": {"prompt_used": 4},
        "task_usage": {"diagnose": 3},
    }


def test_event_tracking_rejects_unknown_event_type(app):
    with app.test_request_context(
        "/api/ai/events",
        method="POST",
        json={"event_type": "raw_prompt_dump"},
    ):
        g.user_id = 23
        response, status = inspect.unwrap(routes.track_copilot_event)()

    assert status == 400
    assert response.get_json()["msg"] == "invalid_event_type"
