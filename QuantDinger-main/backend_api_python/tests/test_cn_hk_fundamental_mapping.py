import sys
import types

import pandas as pd

from app.data_sources import cn_hk_fundamentals as fundamentals


def test_current_hk_indicator_columns_are_mapped_and_fetched_once(monkeypatch):
    frame = pd.DataFrame(
        [
            {
                "基本每股收益(元)": 12.5,
                "每股净资产(元)": 125.0,
                "已发行股本(股)": 9_000_000_000,
                "每股经营现金流(元)": 17.0,
                "总市值(港元)": 3_900_000_000_000,
                "营业总收入": 400_000_000_000,
                "营业总收入滚动环比增长(%)": 2.6,
                "销售净利率(%)": 29.2,
                "净利润": 114_000_000_000,
                "净利润滚动环比增长(%)": 0.16,
                "股东权益回报率(%)": 9.9,
                "市盈率": 14.6,
                "市净率": 2.98,
            }
        ]
    )
    calls = []
    fake_akshare = types.SimpleNamespace(
        stock_hk_financial_indicator_em=lambda symbol: calls.append(symbol) or frame,
    )
    monkeypatch.setitem(sys.modules, "akshare", fake_akshare)
    fundamentals._HK_INDICATOR_CACHE.clear()

    summary = fundamentals.fetch_hk_fundamental_akshare("HK00700")
    indicators = fundamentals.fetch_hk_financial_indicators("HK00700")
    statements = fundamentals.fetch_hk_financial_statements("HK00700")

    assert calls == ["00700"]
    assert summary["revenue"] == 400_000_000_000
    assert summary["net_income"] == 114_000_000_000
    assert summary["shares_outstanding"] == 9_000_000_000
    assert summary["shareholder_equity"] == 1_125_000_000_000
    assert indicators["revenue_growth"] == 2.6
    assert indicators["operating_cash_flow"] == 153_000_000_000
    assert statements["income_statement"]["total_revenue"] == 400_000_000_000
    assert statements["income_statement"]["net_income"] == 114_000_000_000
