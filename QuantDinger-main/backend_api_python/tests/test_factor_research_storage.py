import json

from app.services.strategy_v2.storage import FactorResearchRepository


def test_factor_research_history_hydrates_summary_and_full_result():
    result = {
        "rankIc": 0.12,
        "icir": 1.4,
        "coverage": 0.95,
        "netLongShortReturn": 0.08,
        "icSeries": [{"time": "2026-01-01", "value": 0.12}],
    }
    row = {
        "id": 7,
        "manifest_json": json.dumps({"strategyType": "portfolio"}),
        "result_json": json.dumps(result),
    }

    summary = FactorResearchRepository._hydrate(dict(row), include_result=False)
    detail = FactorResearchRepository._hydrate(dict(row), include_result=True)

    assert summary["rank_ic"] == 0.12
    assert summary["observation_count"] == 1
    assert "result" not in summary
    assert detail["manifest"]["strategyType"] == "portfolio"
    assert detail["result"] == result


def test_factor_research_persisted_summary_does_not_require_result_json():
    summary = FactorResearchRepository._hydrate_summary({
        "id": 8,
        "manifest_json": json.dumps({"strategyType": "portfolio"}),
        "rank_ic": 0.2,
        "icir": 1.8,
        "coverage": 0.91,
        "net_long_short_return": 0.07,
        "observation_count": 20,
    })

    assert summary["rank_ic"] == 0.2
    assert summary["observation_count"] == 20
    assert "result" not in summary
