"""Opt-in PostgreSQL check using an isolated schema, removed after execution.

Run with DATABASE_URL and optional RELEASE_SOURCE_DIR containing the candidate
agent_auth.py and db_postgres.py. Never uses application tables.
"""
import importlib.util
import json
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from threading import Barrier

import psycopg2
from psycopg2 import sql
from psycopg2.extras import RealDictCursor
from flask import Flask, jsonify


def load_candidate(name):
    root = os.environ.get("RELEASE_SOURCE_DIR")
    if not root:
        return __import__("app.utils." + name, fromlist=[name])
    spec = importlib.util.spec_from_file_location("release_" + name, Path(root) / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    auth = load_candidate("agent_auth")
    cursor_type = load_candidate("db_postgres").PostgresCursor
    dsn = os.environ["DATABASE_URL"]
    schema = "qd_release_test_" + uuid.uuid4().hex
    app = Flask(__name__)
    admin = psycopg2.connect(dsn)
    admin.autocommit = True
    original = auth.get_db_connection

    class Connection:
        def __init__(self, native):
            self.native = native

        def cursor(self):
            return cursor_type(self.native.cursor(cursor_factory=RealDictCursor))

        def commit(self):
            self.native.commit()

    @contextmanager
    def isolated_connection():
        native = psycopg2.connect(dsn)
        try:
            with native.cursor() as cur:
                cur.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(schema)))
            yield Connection(native)
        finally:
            native.rollback()
            native.close()

    try:
        with admin.cursor() as cur:
            cur.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
            cur.execute(sql.SQL("""CREATE TABLE {}.qd_agent_idempotency (
                id BIGSERIAL PRIMARY KEY, agent_token_id BIGINT, method TEXT, route TEXT,
                idempotency_key TEXT, request_hash TEXT, status TEXT, response_body JSONB,
                response_status INTEGER, updated_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE (agent_token_id, method, route, idempotency_key))""").format(sql.Identifier(schema)))
        auth.get_db_connection = isolated_connection
        with app.test_request_context("/sources", method="POST", json={"code": "same"}):
            assert auth._reserve_idempotency(1, "replay")[0] == "reserved"
            assert auth._reserve_idempotency(1, "replay")[0] == "in_progress"
            auth._complete_idempotency(1, "replay", jsonify({"id": 42}))
            state, cached = auth._reserve_idempotency(1, "replay")
            assert state == "completed" and cached["response_body"] == {"id": 42}
        with app.test_request_context("/sources", method="POST", json={"code": "changed"}):
            assert auth._reserve_idempotency(1, "replay")[0] == "mismatch"
        barrier = Barrier(12)

        def reserve(_):
            with app.test_request_context("/sources", method="POST", json={"code": "same"}):
                barrier.wait(timeout=30)
                return auth._reserve_idempotency(1, "concurrent")[0]

        with ThreadPoolExecutor(max_workers=12) as pool:
            states = list(pool.map(reserve, range(12)))
        assert states.count("reserved") == 1, states
        assert states.count("in_progress") == 11, states
        with isolated_connection() as connection:
            cur = connection.cursor()
            cur.execute("SELECT count(*) AS total FROM qd_agent_idempotency")
            assert cur.fetchone()["total"] == 2
        print(json.dumps({"sequential_replay": "passed", "changed_payload": "rejected",
                          "concurrent_requests": 12, "reserved": 1, "blocked_duplicates": 11}))
    finally:
        auth.get_db_connection = original
        with admin.cursor() as cur:
            cur.execute(sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(schema)))
        admin.close()


if __name__ == "__main__":
    main()
