from datetime import datetime, timedelta, timezone

import pytest

from app.services.fundamental_refresh import refresh_due

NOW = datetime(2026, 9, 13, tzinfo=timezone.utc)


@pytest.mark.parametrize('mode,period_age,check_age,due', [
    ('history', 60, 1, False), ('history', 60, 6.9, False), ('history', 60, 7, True),
    ('history', 100, 0.9, False), ('history', 100, 1, True),
    ('current', 60, 0.9, False), ('current', 60, 1, True),
])
def test_refresh_intervals(mode, period_age, check_age, due):
    coverage = dict(ready=True, period_end=NOW.date()-timedelta(days=period_age),
                    ingested_at=NOW-timedelta(days=check_age))
    assert refresh_due(coverage, None, ['net_income'], mode, NOW) is due


def test_missing_fields_retry_next_day_but_new_requirements_are_not_blocked():
    coverage = dict(ready=False)
    attempt = dict(status='failed', fields_json=['net_income'], updated_at=NOW)
    assert not refresh_due(coverage, attempt, ['net_income'], 'history', NOW)
    assert refresh_due(coverage, attempt, ['net_income'], 'history', NOW+timedelta(days=1))
    assert refresh_due(coverage, attempt, ['revenue'], 'history', NOW)
    assert refresh_due(coverage, None, ['net_income'], 'history', NOW)


def test_successful_check_without_new_report_delays_next_poll():
    coverage = dict(ready=True, period_end=NOW.date()-timedelta(days=120),
                    ingested_at=NOW-timedelta(days=30))
    attempt = dict(status='success', fields_json=['net_income'], updated_at=NOW)
    assert not refresh_due(coverage, attempt, ['net_income'], 'history', NOW)


def test_successful_partial_collection_is_not_retried_immediately():
    coverage = dict(ready=False, period_end=NOW.date()-timedelta(days=60))
    attempt = dict(status='success', fields_json=['net_income'], updated_at=NOW)
    assert not refresh_due(coverage, attempt, ['net_income'], 'history', NOW)
    assert refresh_due(coverage, attempt, ['net_income'], 'history', NOW+timedelta(days=7))
