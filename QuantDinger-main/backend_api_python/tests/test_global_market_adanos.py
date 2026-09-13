"""Tests for the optional Adanos global-market endpoint."""


def _auth_headers(monkeypatch):
    from app.utils import auth

    monkeypatch.setattr(
        auth,
        "verify_token",
        lambda token: {
            "sub": "tester",
            "user_id": 1,
            "role": "user",
            "token_version": 1,
            "_verified_username": "tester",
            "_verified_user_role": "user",
        },
    )
    return {"Authorization": "Bearer test-token"}


def test_adanos_sentiment_endpoint_requires_login(client):
    resp = client.get("/api/global-market/adanos-sentiment?tickers=AAPL")

    assert resp.status_code == 401
    assert resp.get_json()["msg"] == "Token missing"


def test_adanos_sentiment_endpoint_returns_provider_result(client, monkeypatch):
    from app.routes import global_market

    calls = []

    def fake_fetch(tickers, *, source=None, days=7):
        calls.append({"tickers": tickers, "source": source, "days": days})
        return {
            "enabled": False,
            "provider": "adanos",
            "source": source,
            "days": days,
            "tickers": ["AAPL", "TSLA"],
            "stocks": [],
            "error": "ADANOS_API_KEY is not configured",
        }

    monkeypatch.setattr(global_market, "fetch_adanos_market_sentiment", fake_fetch)

    resp = client.get(
        "/api/global-market/adanos-sentiment?tickers=aapl,$tsla&source=x&days=14",
        headers=_auth_headers(monkeypatch),
    )

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["code"] == 1
    assert body["data"]["enabled"] is False
    assert calls == [{"tickers": "aapl,$tsla", "source": "x", "days": 14}]


def test_adanos_sentiment_endpoint_rejects_invalid_days(client, monkeypatch):
    resp = client.get(
        "/api/global-market/adanos-sentiment?tickers=AAPL&days=bad",
        headers=_auth_headers(monkeypatch),
    )

    assert resp.status_code == 400
    assert resp.get_json()["code"] == 0
