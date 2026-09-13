import pandas as pd

from app.data_providers.hk_research import (
    fetch_hk_analyst_expectations,
    fetch_hk_security_profile,
    fetch_hk_southbound_holdings,
    fetch_hkma_hibor,
)


class FakeAkShare:
    @staticmethod
    def stock_hk_security_profile_em(symbol):
        return pd.DataFrame([{
            "证券代码": f"{symbol}.HK",
            "证券类型": "非H股",
            "是否沪港通标的": "是",
            "是否深港通标的": "是",
            "上市日期": "2004-06-16",
            "ISIN（国际证券识别编码）": "KYG875721634",
        }])

    @staticmethod
    def stock_hsgt_individual_em(symbol):
        return pd.DataFrame([
            {"持股日期": "2026-09-05", "持股数量": 100, "持股市值": 44000, "持股数量占A股百分比": 1.0},
            {"持股日期": "2026-09-07", "持股数量": 110, "持股市值": 49500, "持股数量占A股百分比": 1.1},
        ])

    @staticmethod
    def stock_hk_profit_forecast_et(symbol, indicator):
        if indicator == "评级总览":
            return pd.DataFrame([{"方向": "买入", "评级数量": "18份", "平均评级": 1.94}])
        return pd.DataFrame([
            {"证券商": "甲", "目标价": 600, "更新日期": "2026-09-05"},
            {"证券商": "乙", "目标价": 700, "更新日期": "2026-09-06"},
            {"证券商": "丙", "目标价": 800, "更新日期": "2026-09-07"},
        ])


class FakeResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {
            "result": {
                "records": [
                    {"end_of_day": "2026-09-06", "ir_1m": 2.1},
                    {"end_of_day": "2026-09-07", "ir_overnight": 2.0, "ir_1m": 2.2, "ir_3m": 2.3},
                ]
            }
        }


def test_hk_profile_marks_non_h_share_and_stock_connect_eligibility():
    profile = fetch_hk_security_profile("700.HK", ak_client=FakeAkShare)

    assert profile["symbol"] == "00700"
    assert profile["is_h_share"] is False
    assert profile["southbound_eligible_sh"] is True


def test_southbound_normalization_uses_holdings_change_proxy():
    result = fetch_hk_southbound_holdings("00700", ak_client=FakeAkShare)

    assert result["holding_shares"] == 110
    assert result["holding_change_shares_1d"] == 10
    assert result["holding_change_pct_1d"] == 10
    assert result["scope"] == "stock_connect_holdings_change_proxy"


def test_analyst_expectations_are_aggregated_without_raw_row_leakage():
    result = fetch_hk_analyst_expectations("00700", ak_client=FakeAkShare)

    assert result["rating_direction"] == "买入"
    assert result["analyst_count"] == 3
    assert result["target_price_median_hkd"] == 700
    assert "rows" not in result


def test_hkma_hibor_uses_latest_official_observation():
    result = fetch_hkma_hibor(http_get=lambda *args, **kwargs: FakeResponse())

    assert result["end_of_day"] == "2026-09-07"
    assert result["one_month_pct"] == 2.2
    assert result["source"] == "hkma_open_api"
