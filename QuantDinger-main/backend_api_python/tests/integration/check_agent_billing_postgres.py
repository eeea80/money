"""Opt-in billing integration checks against isolated PostgreSQL tables.

Requires DATABASE_URL. RELEASE_SOURCE_DIR may contain candidate modules named
db_postgres.py, billing_service.py, and agent_jobs.py. Business tables are never
used; the uniquely named test schema is removed in finally.
"""
import importlib
import json
import os
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from threading import Barrier
from types import SimpleNamespace
from uuid import uuid4

import psycopg2
from psycopg2 import sql
from psycopg2.extras import RealDictCursor


def candidate(name):
    module = importlib.import_module(name)
    directory = os.environ.get("RELEASE_SOURCE_DIR")
    if directory:
        path = Path(directory) / (name.rsplit(".", 1)[-1] + ".py")
        exec(compile(path.read_bytes(), str(path), "exec"), module.__dict__)
    return module


def main():
    cursor_type = candidate("app.utils.db_postgres").PostgresCursor
    billing_module = candidate("app.services.billing_service")
    jobs = candidate("app.utils.agent_jobs")
    dsn = os.environ["DATABASE_URL"]
    schema = "qd_billing_test_" + uuid4().hex
    admin = psycopg2.connect(dsn)
    admin.autocommit = True
    service = billing_module.BillingService()
    callbacks = []
    jobs._get_executor = lambda: SimpleNamespace(submit=callbacks.append)
    jobs.get_billing_service = lambda: service
    os.environ["CELERY_TASKS_ENABLED"] = "false"
    os.environ["BILLING_ENABLED"] = "true"
    os.environ["BILLING_COST_BACKTEST"] = "30"

    class Connection:
        def __init__(self, native):
            self.native = native

        def cursor(self):
            return cursor_type(self.native.cursor(cursor_factory=RealDictCursor))

        def commit(self):
            self.native.commit()

    @contextmanager
    def connect():
        native = psycopg2.connect(dsn)
        try:
            with native.cursor() as cur:
                cur.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(schema)))
            yield Connection(native)
        finally:
            native.rollback()
            native.close()

    def query(statement, parameters=()):
        with connect() as db:
            cur = db.cursor()
            cur.execute(statement, parameters)
            rows = cur.fetchall() if cur._cursor.description else []
            db.commit()
            return rows

    def balance():
        return float(query("SELECT credits FROM qd_users WHERE id = 1")[0]["credits"])

    def reset(credits=100):
        query("TRUNCATE qd_agent_jobs, qd_credits_log, qd_users RESTART IDENTITY")
        query("INSERT INTO qd_users(id, credits) VALUES (1, %s)", (credits,))
        callbacks.clear()
        os.environ["BILLING_ENABLED"] = "true"
        os.environ["BILLING_COST_BACKTEST"] = "30"
        service.clear_config_cache()

    def submit(key="same", runner=None, payload=None):
        return jobs.submit_job(user_id=1, agent_token_id=7, kind="backtest",
            request_payload=payload or {"code": "test", "__user_id": 1},
            runner=runner or (lambda _: {"runId": 123}), idempotency_key=key)

    def assert_raises(call, error_type):
        try:
            call()
        except error_type as exc:
            return exc
        raise AssertionError("Expected failure")

    passed = []
    jobs.get_db_connection = connect
    try:
        with admin.cursor() as cur:
            cur.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
            cur.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(schema)))
            cur.execute("""CREATE TABLE qd_users(id BIGINT PRIMARY KEY, credits NUMERIC, updated_at TIMESTAMPTZ);
                CREATE TABLE qd_credits_log(id BIGSERIAL PRIMARY KEY, user_id BIGINT, action TEXT,
                    amount NUMERIC, balance_after NUMERIC, feature TEXT, reference_id TEXT, remark TEXT,
                    created_at TIMESTAMPTZ);
                CREATE TABLE qd_agent_jobs(id BIGSERIAL PRIMARY KEY, job_id TEXT UNIQUE, user_id BIGINT,
                    agent_token_id BIGINT, kind TEXT, status TEXT, request JSONB, result JSONB, error TEXT,
                    progress JSONB, idempotency_key TEXT, created_at TIMESTAMPTZ,
                    started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ);""")
        reset()
        first = submit()
        assert first["billing"]["charged"] == 30 and first["billing"]["transactionId"]
        assert balance() == 70
        assert submit()["job_id"] == first["job_id"] and len(callbacks) == 1
        callbacks.pop()()
        completed = jobs.get_job(first["job_id"], user_id=1)
        assert completed["status"] == "succeeded" and completed["result"]["runId"] == 123
        assert completed["result"]["billing"] == completed["billing"]
        assert not jobs._set_status(first["job_id"], "running")
        assert jobs.cancel_job(first["job_id"], user_id=1)["status"] == "succeeded"
        assert balance() == 70
        passed.append("success_receipt_replay_and_terminal_guard")

        error = assert_raises(lambda: submit(payload={"code": "changed"}), billing_module.BillingError)
        assert error.status == 409 and balance() == 70
        passed.append("same_key_different_payload_rejected")

        reset(12)
        error = assert_raises(submit, billing_module.BillingError)
        assert error.status == 402 and error.details["shortage"] == 18
        assert balance() == 12 and query("SELECT * FROM qd_agent_jobs") == []
        assert query("SELECT * FROM qd_credits_log") == [] and callbacks == []
        passed.append("insufficient_balance_no_job_no_ledger")

        for setting, value in [("BILLING_ENABLED", "false"), ("BILLING_COST_BACKTEST", "0")]:
            reset()
            os.environ[setting] = value
            service.clear_config_cache()
            assert submit()["billing"]["charged"] == 0 and balance() == 100
            assert query("SELECT * FROM qd_credits_log") == []
        passed.append("disabled_and_zero_cost_are_free")

        reset()
        def fail(_):
            raise ValueError("backtest failed")
        failed = submit(runner=fail)
        callbacks.pop()()
        row = jobs.get_job(failed["job_id"], user_id=1)
        assert row["status"] == "failed" and row["billing"]["refunded"] == 30 and balance() == 100
        assert row["billing"]["refundTransactionId"]
        assert not jobs._set_failure(failed["job_id"], "duplicate")
        assert len(query("SELECT * FROM qd_credits_log")) == 2
        passed.append("execution_failure_refunded_once")

        for running in (False, True):
            reset()
            queued = submit()
            if running:
                assert jobs._set_status(queued["job_id"], "running")
            assert jobs.cancel_job(queued["job_id"], user_id=2) is None and balance() == 70
            cancelled = jobs.cancel_job(queued["job_id"], user_id=1)
            assert cancelled["status"] == "cancelled" and cancelled["billing"]["refunded"] == 30
            jobs.cancel_job(queued["job_id"], user_id=1)
            assert not jobs._set_result(queued["job_id"], {"runId": 555})
            callbacks.pop()()
            assert balance() == 100 and len(query("SELECT * FROM qd_credits_log")) == 2
        passed.append("queued_running_cancel_tenant_scope_no_late_overwrite")

        reset()
        barrier = Barrier(12)
        def parallel(_):
            barrier.wait(timeout=30)
            return submit()
        with ThreadPoolExecutor(max_workers=12) as pool:
            receipts = list(pool.map(parallel, range(12)))
        assert len({r["job_id"] for r in receipts}) == 1 and balance() == 70
        assert len(callbacks) == 1 and len(query("SELECT * FROM qd_credits_log")) == 1
        passed.append("12_concurrent_replays_one_job_one_debit")

        reset(50)
        def spend(i):
            try:
                return submit(key=str(i))
            except billing_module.BillingError as exc:
                assert exc.status == 402
                return None
        with ThreadPoolExecutor(max_workers=6) as pool:
            receipts = list(pool.map(spend, range(6)))
        assert sum(r is not None for r in receipts) == 1 and balance() == 20
        passed.append("parallel_distinct_jobs_cannot_overspend")

        reset()
        original_executor = jobs._get_executor
        def dispatch_fail(_):
            raise RuntimeError("queue unavailable")
        jobs._get_executor = lambda: SimpleNamespace(submit=dispatch_fail)
        rejected = submit()
        jobs._get_executor = original_executor
        assert rejected["status"] == "failed" and rejected["billing"]["refunded"] == 30
        assert balance() == 100
        passed.append("dispatch_failure_atomic_refund")

        reset()
        first = submit()
        os.environ["BILLING_COST_BACKTEST"] = "90"
        os.environ["BILLING_ENABLED"] = "false"
        service.clear_config_cache()
        assert jobs.cancel_job(first["job_id"], user_id=1)["billing"]["refunded"] == 30
        assert balance() == 100
        passed.append("refund_uses_original_cost_even_after_settings_change")

        reset()
        first = submit()
        jobs._set_status(first["job_id"], "running")
        second = submit(key="lost-dispatch")
        query("UPDATE qd_agent_jobs SET created_at = NOW() - INTERVAL '3 hours'")
        assert jobs.expire_billed_jobs() == 2 and jobs.expire_billed_jobs() == 0
        assert balance() == 100 and not jobs._set_result(first["job_id"], {"runId": 12})
        jobs._publish_progress(first["job_id"], {"phase": "finalizing"})
        jobs._publish_terminal_state(first["job_id"])
        assert jobs.get_job(first["job_id"], user_id=1)["progress"]["phase"] == "failed"
        passed.append("orphaned_jobs_expire_and_refund_once")

        for _ in range(6):
            reset()
            first = submit()
            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(jobs._set_result, first["job_id"], {"runId": 123}),
                           pool.submit(jobs.cancel_job, first["job_id"], user_id=1)]
                for future in futures:
                    future.result()
            row = jobs.get_job(first["job_id"], user_id=1)
            if row["status"] == "succeeded":
                assert balance() == 70 and row["billing"]["refunded"] == 0
            else:
                assert row["status"] == "cancelled" and balance() == 100
                assert row["billing"]["refunded"] == 30
        passed.append("success_cancel_race_settles_once")

        reset()
        query("""CREATE FUNCTION reject_test_write() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'injected persistence failure'; END; $$""")
        query("CREATE TRIGGER reject_insert BEFORE INSERT ON qd_agent_jobs FOR EACH ROW EXECUTE FUNCTION reject_test_write()")
        assert_raises(submit, psycopg2.Error)
        assert balance() == 100 and query("SELECT * FROM qd_credits_log") == []
        query("DROP TRIGGER reject_insert ON qd_agent_jobs")
        first = submit()
        query("""CREATE TRIGGER reject_refund BEFORE INSERT ON qd_credits_log
            FOR EACH ROW WHEN (NEW.action = 'refund') EXECUTE FUNCTION reject_test_write()""")
        assert_raises(lambda: jobs.cancel_job(first["job_id"], user_id=1), psycopg2.Error)
        assert balance() == 70 and jobs.get_job(first["job_id"], user_id=1)["status"] == "queued"
        query("DROP TRIGGER reject_refund ON qd_credits_log")
        assert jobs.cancel_job(first["job_id"], user_id=1)["billing"]["refunded"] == 30
        assert balance() == 100
        passed.append("insert_and_refund_failure_roll_back_all_changes")
        print(json.dumps({"passed": passed, "count": len(passed)}))
    finally:
        with admin.cursor() as cur:
            cur.execute(sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(schema)))
        admin.close()


if __name__ == "__main__":
    main()
