from app.services.market import technical_indicators


def _klines(count=40, latest_volume=200.0):
    rows = []
    for idx in range(count):
        close = 100.0 + idx
        rows.append({
            "open": close - 0.5,
            "high": close + 1.0,
            "low": close - 1.0,
            "close": close,
            "volume": latest_volume if idx == count - 1 else 100.0,
        })
    return rows


def test_macd_bullish_alignment_is_not_mislabeled_as_new_cross(monkeypatch):
    monkeypatch.setattr(
        technical_indicators,
        "calc_macd",
        lambda _closes: {
            "MACD": 2.0,
            "MACD_signal": 1.0,
            "MACD_histogram": 1.0,
            "previous_MACD": 1.5,
            "previous_MACD_signal": 0.5,
        },
    )

    macd = technical_indicators.calculate_indicators(_klines())["macd"]

    assert macd["signal"] == "bullish"
    assert macd["trend"] == "bullish_alignment"
    assert macd["cross_event"] is None


def test_macd_cross_requires_previous_bar_transition(monkeypatch):
    monkeypatch.setattr(
        technical_indicators,
        "calc_macd",
        lambda _closes: {
            "MACD": 2.0,
            "MACD_signal": 1.0,
            "MACD_histogram": 1.0,
            "previous_MACD": 0.5,
            "previous_MACD_signal": 1.0,
        },
    )

    macd = technical_indicators.calculate_indicators(_klines())["macd"]

    assert macd["trend"] == "golden_cross"
    assert macd["cross_event"] == "golden_cross"


def test_volume_ratio_uses_previous_twenty_bars_only():
    indicators = technical_indicators.calculate_indicators(_klines(count=21, latest_volume=200.0))

    assert indicators["volume_ratio"] == 2.0
    assert indicators["volume_ratio_meta"]["baseline"] == "previous_20_bars"
    assert indicators["levels"]["is_estimate"] is True
