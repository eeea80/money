from contextlib import contextmanager
from decimal import Decimal

from app.routes import backtest_center
from app.services import billing_service
from app.services.billing_config import load_billing_config


def test_backtest_cost_defaults_to_30_and_can_be_overridden(monkeypatch):
    monkeypatch.delenv("BILLING_COST_BACKTEST", raising=False)
    assert load_billing_config()["cost_backtest"] == 30

    monkeypatch.setenv("BILLING_COST_BACKTEST", "45")
    assert load_billing_config()["cost_backtest"] == 45


def test_backtest_charge_reports_insufficient_credits(monkeypatch):
    class FakeBilling:
        def is_billing_enabled(self):
            return True

        def get_feature_cost(self, feature):
            assert feature == "backtest"
            return 30

        def get_user_credits(self, user_id):
            assert user_id == 7
            return Decimal("12")

        def check_and_consume(self, **kwargs):
            assert kwargs["feature"] == "backtest"
            return False, "insufficient_credits:12:30"

    monkeypatch.setattr(backtest_center, "get_billing_service", lambda: FakeBilling())

    _billing, charge = backtest_center._consume_backtest_credits(7)

    assert charge["error"] == "insufficient_credits"
    assert charge["current"] == 12
    assert charge["required"] == 30
    assert charge["shortage"] == 18
    assert charge["charged"] == 0


def test_backtest_charge_consumes_configured_cost_and_reports_balance(monkeypatch):
    class FakeBilling:
        def __init__(self):
            self.balance_reads = iter((Decimal("100"), Decimal("70")))

        def is_billing_enabled(self):
            return True

        def get_feature_cost(self, feature):
            return 30

        def get_user_credits(self, user_id):
            return next(self.balance_reads)

        def check_and_consume(self, **kwargs):
            assert kwargs["user_id"] == 7
            assert kwargs["feature"] == "backtest"
            assert kwargs["reference_id"].startswith("backtest:")
            return True, "consumed"

    monkeypatch.setattr(backtest_center, "get_billing_service", FakeBilling)

    _billing, charge = backtest_center._consume_backtest_credits(7)

    assert charge["cost"] == 30
    assert charge["charged"] == 30
    assert charge["remaining"] == 70


def test_failed_backtest_refunds_the_original_charge_reference():
    calls = []

    class FakeBilling:
        def add_credits(self, **kwargs):
            calls.append(kwargs)
            return True, "100"

    backtest_center._refund_backtest_credits(
        FakeBilling(),
        7,
        {"charged": 30, "referenceId": "backtest:request-1"},
    )

    assert calls == [{
        "user_id": 7,
        "amount": 30,
        "action": "refund",
        "remark": "Automatic refund: backtest execution failed",
        "reference_id": "backtest:request-1",
    }]


def test_credit_deduction_is_atomic(monkeypatch):
    statements = []

    class FakeCursor:
        def __init__(self):
            self._next_row = None

        def execute(self, sql, params=()):
            statements.append((" ".join(sql.split()), params))
            if "UPDATE qd_users" in sql:
                self._next_row = {"credits": Decimal("70")}

        def fetchone(self):
            row = self._next_row
            self._next_row = None
            return row

        def close(self):
            pass

    class FakeDb:
        def __init__(self):
            self.committed = False

        def cursor(self):
            return FakeCursor()

        def commit(self):
            self.committed = True

        def rollback(self):
            raise AssertionError("successful deduction must not roll back")

    db = FakeDb()

    @contextmanager
    def fake_connection():
        yield db

    monkeypatch.setattr(billing_service, "get_db_connection", fake_connection)
    service = billing_service.BillingService()
    monkeypatch.setattr(service, "is_billing_enabled", lambda: True)
    monkeypatch.setattr(service, "get_feature_cost", lambda feature: 30)

    success, message = service.check_and_consume(5, "backtest", "backtest:test")

    assert (success, message) == (True, "consumed")
    assert db.committed is True
    update_sql, update_params = statements[0]
    assert "credits = credits - ?" in update_sql
    assert "credits >= ?" in update_sql
    assert "RETURNING credits" in update_sql
    assert update_params == (30, 5, 30)
    assert any("INSERT INTO qd_credits_log" in sql for sql, _params in statements)
