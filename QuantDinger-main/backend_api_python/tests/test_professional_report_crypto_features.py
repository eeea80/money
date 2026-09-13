import copy

import pytest

from app.professional_report.features import build_crypto_features, extract_crypto_features


def _codes(result):
    return {item["code"] for item in result["warnings"]}


def test_builds_perpetual_features_without_guessing_units():
    payload = {
        "instrument": {
            "asset": "BTC",
            "symbol": "BTCUSDT",
            "venue": "Binance",
            "product_type": "perpetual_swap",
            "quote_asset": "USDT",
            "settlement_asset": "USDT",
        },
        "crypto_factors": {
            "funding_rate": {"value": 0.0001, "unit": "decimal", "evidence_ref": "funding:1"},
            "open_interest": {"value": 12500, "unit": "contracts", "evidence_ref": "oi:1"},
            "basis": {"value": 1.25, "unit": "percent", "evidence_ref": "basis:1"},
            "liquidations": {
                "long": 1200000,
                "short": 300000,
                "unit": "usd",
                "evidence_ref": "liq:1",
            },
            "long_short_ratio": {"value": 1.5, "unit": "ratio", "evidence_ref": "ls:1"},
            "market_cap": {"value": 1_000_000_000, "unit": "usd", "currency": "USD", "evidence_ref": "cap:1"},
            "volume_24h": {"value": 250_000_000, "unit": "usd", "currency": "USD", "evidence_ref": "vol:1"},
        },
    }

    result = build_crypto_features(payload)
    derivatives = result["features"]["derivatives"]

    assert result["version"] == "crypto_features.v1"
    assert result["market"]["venue"] == "binance"
    assert result["market"]["product_type"] == "perpetual"
    assert derivatives["funding_rate"]["decimal"] == pytest.approx(0.0001)
    assert derivatives["funding_rate"]["percent"] == pytest.approx(0.01)
    assert derivatives["basis"]["decimal"] == pytest.approx(0.0125)
    assert derivatives["liquidations"]["total"] == 1_500_000
    assert derivatives["long_short_ratio"]["long_share"] == pytest.approx(0.6)
    assert result["features"]["market_activity"]["volume_to_market_cap"]["ratio"] == pytest.approx(0.25)
    assert result["evidence_refs"] == [
        "funding:1",
        "oi:1",
        "basis:1",
        "liq:1",
        "ls:1",
        "vol:1",
        "cap:1",
    ]
    assert result["warnings"] == []
    assert result["quality_flags"]["usable_for_directional_analysis"] is True


def test_direct_factors_dict_and_percent_funding_are_supported():
    result = extract_crypto_features(
        {
            "venue": "bybit",
            "product_type": "perp",
            "funding_rate": {"value": 0.01, "unit": "%", "evidence_id": "bybit-funding"},
            "long_short_ratio": {"long_pct": 55, "short_pct": 45, "evidence_ref": "accounts"},
        }
    )

    funding = result["features"]["derivatives"]["funding_rate"]
    ratio = result["features"]["derivatives"]["long_short_ratio"]
    assert funding["decimal"] == pytest.approx(0.0001)
    assert funding["percent"] == pytest.approx(0.01)
    assert ratio["ratio"] == pytest.approx(55 / 45)
    assert ratio["long_share"] == pytest.approx(0.55)
    assert result["quality_flags"]["unit_ambiguity"] is False


def test_ambiguous_rate_unit_is_preserved_but_not_normalised():
    result = build_crypto_features(
        {
            "venue": "okx",
            "product_type": "perpetual",
            "funding_rate": 0.01,
            "basis": {"value": 25},
        }
    )

    funding = result["features"]["derivatives"]["funding_rate"]
    assert funding["raw_value"] == 0.01
    assert funding["decimal"] is None
    assert funding["percent"] is None
    assert _codes(result) == {"AMBIGUOUS_RATE_UNIT", "AMBIGUOUS_BASIS_UNIT"}
    assert result["quality_flags"]["unit_ambiguity"] is True
    assert result["quality_flags"]["usable_for_directional_analysis"] is False


def test_derivative_metrics_tagged_as_spot_are_rejected_for_directional_use():
    result = build_crypto_features(
        {
            "instrument": {"venue": "coinbase", "product_type": "spot", "symbol": "BTC-USD"},
            "crypto_factors": {
                "funding_rate": {"value": 0.01, "unit": "percent"},
                "open_interest": {"value": 1_000, "unit": "contracts"},
            },
        }
    )

    assert "DERIVATIVE_METRIC_ON_SPOT" in _codes(result)
    assert result["quality_flags"]["derivative_metric_on_spot"] is True
    assert result["quality_flags"]["usable_for_directional_analysis"] is False


def test_cross_venue_and_cross_product_inputs_are_detected():
    result = build_crypto_features(
        {
            "instrument": {"venue": "binance", "product_type": "perpetual"},
            "crypto_factors": {
                "funding_rate": {
                    "value": 0.0001,
                    "unit": "decimal",
                    "venue": "binance",
                    "product_type": "perpetual",
                },
                "open_interest": {
                    "value": 20_000,
                    "unit": "contracts",
                    "venue": "okx",
                    "product_type": "perpetual",
                },
                "volume_24h": {
                    "value": 1_000_000,
                    "unit": "usd",
                    "currency": "USD",
                    "venue": "binance",
                    "product_type": "spot",
                },
            },
        }
    )

    assert "MIXED_VENUES" in _codes(result)
    assert result["quality_flags"]["mixed_venues"] is True
    assert result["quality_flags"]["mixed_product_types"] is False
    assert result["quality_flags"]["usable_for_directional_analysis"] is False


def test_spot_context_does_not_invalidate_consistent_perpetual_derivatives():
    result = build_crypto_features(
        {
            "instrument": {"venue": "binance", "product_type": "perpetual"},
            "crypto_factors": {
                "funding_rate": {"value": 0.01, "unit": "percent", "venue": "binance", "product_type": "perpetual"},
                "open_interest": {"value": 20_000, "unit": "usd", "venue": "binance", "product_type": "perpetual"},
                "volume_24h": {"value": 1_000_000, "unit": "usd", "currency": "USD", "venue": "aggregate", "product_type": "spot"},
            },
        }
    )

    assert result["quality_flags"]["mixed_venues"] is False
    assert result["quality_flags"]["mixed_product_types"] is False
    assert result["quality_flags"]["usable_for_directional_analysis"] is True


def test_volume_to_market_cap_is_withheld_when_currency_differs():
    result = build_crypto_features(
        {
            "market_cap": {"value": 1000, "unit": "usd", "currency": "USD"},
            "volume_24h": {"value": 100, "unit": "usdt", "currency": "USDT"},
        }
    )

    activity = result["features"]["market_activity"]
    assert activity["volume_to_market_cap"] is None
    assert "TURNOVER_CURRENCY_MISMATCH" in _codes(result)


def test_bps_basis_and_explicit_turnover_remain_distinct_from_volume():
    result = build_crypto_features(
        {
            "venue": "deribit",
            "product_type": "perpetual",
            "basis_rate": {"value": 35, "unit": "bps"},
            "volume_24h": {"value": 10, "unit": "base", "currency": "BTC"},
            "turnover_24h": {"value": 700_000, "unit": "usd", "currency": "USD"},
        }
    )

    activity = result["features"]["market_activity"]
    assert result["features"]["derivatives"]["basis"]["percent"] == pytest.approx(0.35)
    assert activity["volume_24h"]["value"] == 10
    assert activity["turnover_24h"]["value"] == 700_000


def test_input_dictionary_is_not_mutated():
    payload = {
        "instrument": {"venue": "OKX", "product_type": "swap"},
        "crypto_factors": {"funding_rate": {"value": 0.01, "unit": "percent"}},
    }
    original = copy.deepcopy(payload)

    build_crypto_features(payload)

    assert payload == original


def test_flat_companion_units_preserve_legacy_payload_shape():
    result = build_crypto_features(
        {
            "symbol": "ETHUSDT",
            "venue": "binance",
            "product_type": "perpetual",
            "funding_rate": 0.01,
            "funding_rate_unit": "percent",
            "funding_rate_evidence_ref": "funding-flat",
            "open_interest_usd": 25_000_000,
            "open_interest_evidence_ref": "oi-flat",
            "market_cap_usd": 400_000_000_000,
            "volume_24h_usd": 20_000_000_000,
        }
    )

    derivatives = result["features"]["derivatives"]
    activity = result["features"]["market_activity"]
    assert derivatives["funding_rate"]["decimal"] == pytest.approx(0.0001)
    assert derivatives["open_interest"]["currency"] == "USD"
    assert activity["volume_to_market_cap"]["percent"] == pytest.approx(5.0)
    assert result["evidence_refs"] == ["funding-flat", "oi-flat"]
    assert result["quality_flags"]["unit_ambiguity"] is False


def test_derivative_scope_must_not_be_guessed():
    result = build_crypto_features(
        {
            "funding_rate": {"value": 0.01, "unit": "percent"},
            "open_interest": {"value": 1000, "unit": "contracts"},
        }
    )

    assert {"MISSING_METRIC_VENUE", "MISSING_PRODUCT_TYPE"}.issubset(_codes(result))
    assert result["quality_flags"]["scope_ambiguity"] is True
    assert result["quality_flags"]["usable_for_directional_analysis"] is False


def test_oi_change_and_absolute_basis_are_not_conflated_with_levels_or_rates():
    result = build_crypto_features(
        {
            "venue": "okx",
            "product_type": "perpetual",
            "open_interest": {"value": 50_000_000, "unit": "usd"},
            "open_interest_change_24h_percent": -4.5,
            "basis": {"value": 12.5, "unit": "usd"},
        }
    )

    derivatives = result["features"]["derivatives"]
    assert derivatives["open_interest"]["value"] == 50_000_000
    assert derivatives["open_interest_change_24h"]["decimal"] == pytest.approx(-0.045)
    assert derivatives["basis"]["kind"] == "absolute"
    assert derivatives["basis"]["absolute_value"] == pytest.approx(12.5)
    assert derivatives["basis"]["currency"] == "USD"
