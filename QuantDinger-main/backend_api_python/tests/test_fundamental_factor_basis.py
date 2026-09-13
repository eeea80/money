import pandas as pd
import pytest

from app.services.factors import FactorError, compute_factor
from app.services.fundamental_sync import fields_for


def test_book_to_price_uses_company_equity_not_per_share_book_value():
    frame = pd.DataFrame(dict(shareholder_equity=[200], book_value=[2], market_cap=[1000]))
    assert compute_factor('book_to_price', frame) == pytest.approx(0.2)


def test_growth_uses_reported_growth_despite_repeated_daily_revenue():
    frame = pd.DataFrame(dict(revenue=[100, 100], revenue_growth=[0.25, 0.25]))
    assert compute_factor('revenue_growth', frame) == pytest.approx(0.25)


def test_missing_latest_field_cannot_silently_reuse_earlier_report():
    with pytest.raises(FactorError):
        compute_factor('earnings_yield', pd.DataFrame(dict(net_income=[10, None], market_cap=[1000, 1000])))


@pytest.mark.parametrize('fields', [[], ['unknown'], 'market_cap', ['net_income', 'net_income; DROP TABLE qd_users']])
def test_sync_field_validation(fields):
    with pytest.raises(ValueError, match='invalidFields'):
        fields_for(fields)
