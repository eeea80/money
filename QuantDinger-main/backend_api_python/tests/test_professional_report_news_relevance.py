from app.services.fast_analysis import FastAnalysisService


def _service():
    return FastAnalysisService.__new__(FastAnalysisService)


def test_background_global_news_does_not_change_asset_sentiment_score():
    news = [{
        "headline": "War escalates in unrelated region",
        "sentiment": "negative",
        "is_global_event": True,
        "asset_relevance": "background",
    }]

    assert _service()._calculate_sentiment_score(news) == 0
    assert _service()._has_major_news(news) is False


def test_direct_material_event_remains_eligible_for_risk_scoring():
    news = [{
        "headline": "Sanctions target the issuer's principal operating subsidiary",
        "sentiment": "negative",
        "asset_relevance": "material",
    }]

    assert _service()._calculate_sentiment_score(news) < 0
    assert _service()._has_major_news(news) is True
