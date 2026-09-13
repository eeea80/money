import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi.testclient import TestClient


SERVER_DIR = Path(__file__).resolve().parents[1]
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

import database
from routes import create_app
from routes_shared import utc_now_iso_z


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class LeaderboardMetricTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        database.DATABASE_URL = ""
        database._SQLITE_DB_PATH = os.path.join(self.tmp.name, "test.db")
        database.init_database()
        self.client = TestClient(create_app())

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _create_agent(self, name: str, cash: float) -> int:
        now = utc_now_iso_z()
        conn = database.get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO agents (name, token, points, cash, created_at, updated_at)
            VALUES (?, ?, 0, ?, ?, ?)
            """,
            (name, f"token-{name}", cash, now, now),
        )
        agent_id = cursor.lastrowid
        conn.commit()
        conn.close()
        return agent_id

    def _insert_metric_snapshot(self, agent_id: int, *, quality_score_avg: float = 0, max_drawdown: float = 0) -> None:
        now = utc_now_iso_z()
        conn = database.get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO agent_metric_snapshots
            (agent_id, window_key, window_start_at, window_end_at, return_pct,
             max_drawdown, trade_count, strategy_count, discussion_count,
             reply_count, accepted_reply_count, citation_count, adoption_count,
             quality_score_avg, risk_violation_count, metadata_json, created_at)
            VALUES (?, '7d', ?, ?, 0, ?, 0, 0, 0, 0, 0, 0, 0, ?, 0, '{}', ?)
            """,
            (agent_id, now, now, max_drawdown, quality_score_avg, now),
        )
        conn.commit()
        conn.close()

    def _insert_profit_history(self, agent_id: int, profit: float, recorded_at: str) -> None:
        total_value = 100000.0 + profit
        conn = database.get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO profit_history (agent_id, total_value, cash, position_value, profit, recorded_at)
            VALUES (?, ?, ?, 0, ?, ?)
            """,
            (agent_id, total_value, total_value, profit, recorded_at),
        )
        conn.commit()
        conn.close()

    def test_quality_metric_sorts_before_pagination(self):
        high_return_agent = self._create_agent("high-return-low-quality", 200000.0)
        high_quality_agent = self._create_agent("high-quality-low-return", 100000.0)
        self._insert_metric_snapshot(high_return_agent, quality_score_avg=0)
        self._insert_metric_snapshot(high_quality_agent, quality_score_avg=5)

        response = self.client.get("/api/profit/history?limit=1&offset=0&metric=quality&include_history=false")

        self.assertEqual(response.status_code, 200, response.text)
        top_agents = response.json()["top_agents"]
        self.assertEqual(len(top_agents), 1)
        self.assertEqual(top_agents[0]["name"], "high-quality-low-return")
        self.assertEqual(top_agents[0]["quality_score_avg"], 5)

    def test_drawdown_metric_sorts_lowest_drawdown_first(self):
        high_return_high_drawdown = self._create_agent("high-return-high-drawdown", 200000.0)
        lower_return_low_drawdown = self._create_agent("lower-return-low-drawdown", 120000.0)
        self._insert_metric_snapshot(high_return_high_drawdown, max_drawdown=25)
        self._insert_metric_snapshot(lower_return_low_drawdown, max_drawdown=5)

        response = self.client.get("/api/profit/history?limit=1&offset=0&metric=drawdown&include_history=false")

        self.assertEqual(response.status_code, 200, response.text)
        top_agents = response.json()["top_agents"]
        self.assertEqual(len(top_agents), 1)
        self.assertEqual(top_agents[0]["name"], "lower-return-low-drawdown")
        self.assertEqual(top_agents[0]["max_drawdown"], 5)

    def test_active_leaderboard_exclusion_is_omitted_before_pagination(self):
        excluded_agent = self._create_agent("excluded-high-return", 300000.0)
        eligible_agent = self._create_agent("eligible-low-return", 100000.0)

        now = utc_now_iso_z()
        conn = database.get_db_connection()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO agent_leaderboard_exclusions
                (agent_id, reason, details_json, active, created_at, updated_at)
            VALUES (?, 'unit_test', '{}', 1, ?, ?)
            """,
            (excluded_agent, now, now),
        )
        conn.commit()
        conn.close()

        response = self.client.get("/api/profit/history?limit=10&offset=0&include_history=false")

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        agent_ids = [agent["agent_id"] for agent in payload["top_agents"]]
        self.assertNotIn(excluded_agent, agent_ids)
        self.assertIn(eligible_agent, agent_ids)
        self.assertEqual(payload["total"], 1)

    def test_profit_history_includes_running_max_drawdown(self):
        agent_id = self._create_agent("drawdown-agent", 113000.0)
        self._insert_metric_snapshot(agent_id, max_drawdown=50.0)
        now = datetime.now(timezone.utc)
        self._insert_profit_history(agent_id, 0.0, iso(now - timedelta(hours=3)))
        self._insert_profit_history(agent_id, 50000.0, iso(now - timedelta(hours=2)))
        self._insert_profit_history(agent_id, -25000.0, iso(now - timedelta(hours=1)))

        response = self.client.get("/api/profit/history?limit=1&offset=0&days=7&include_history=true")

        self.assertEqual(response.status_code, 200, response.text)
        agent = response.json()["top_agents"][0]
        drawdowns = [point["max_drawdown"] for point in agent["history"]]
        self.assertEqual(agent["max_drawdown"], 50.0)
        self.assertEqual(drawdowns[:3], [0.0, 0.0, 50.0])
        self.assertEqual(drawdowns[-1], 50.0)

    def test_profit_history_exposes_agent_identity_status(self):
        agent_id = self._create_agent("verified-leaderboard-agent", 150000.0)
        conn = database.get_db_connection()
        cursor = conn.cursor()
        cursor.execute("UPDATE agents SET identity_status = 'verified' WHERE id = ?", (agent_id,))
        conn.commit()
        conn.close()

        response = self.client.get("/api/profit/history?limit=1&offset=0&include_history=false")

        self.assertEqual(response.status_code, 200, response.text)
        agent = response.json()["top_agents"][0]
        self.assertEqual(agent["identity_status"], "verified")
        self.assertTrue(agent["is_verified"])


if __name__ == "__main__":
    unittest.main()
