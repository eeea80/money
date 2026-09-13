from app.professional_report.providers import PROVIDER_CATALOG
from app.routes.settings import CONFIG_SCHEMA


def _setting_keys() -> set[str]:
    return {
        item["key"]
        for group in CONFIG_SCHEMA.values()
        for item in group.get("items", [])
    }


def test_every_active_keyed_report_provider_is_configurable_in_settings():
    setting_keys = _setting_keys()
    active_keyed = [
        provider
        for provider in PROVIDER_CATALOG
        if provider.integration_status == "active" and not provider.keyless
    ]

    missing = {
        provider.key: sorted(set(provider.api_env_keys) - setting_keys)
        for provider in active_keyed
        if not set(provider.api_env_keys).intersection(setting_keys)
    }
    assert missing == {}


def test_professional_report_runtime_controls_are_exposed_in_settings():
    assert {
        "PROFESSIONAL_REPORT_DATA_TIER",
        "PROFESSIONAL_REPORT_RISK_BUDGET_PCT",
        "FAST_ANALYSIS_INCLUDE_GLOBAL_NEWS",
    }.issubset(_setting_keys())


def test_report_data_tier_only_exposes_the_two_supported_classes():
    item = next(
        item
        for item in CONFIG_SCHEMA["data_source"]["items"]
        if item["key"] == "PROFESSIONAL_REPORT_DATA_TIER"
    )
    assert [option["value"] for option in item["options"]] == [
        "community",
        "professional",
    ]
