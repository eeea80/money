"""Contract tests for security-sensitive human API mutations."""

import pytest
from marshmallow import ValidationError

from app.openapi.schemas.high_risk import (
    CredentialCreateRequestSchema,
    QuickTradeOrderRequestSchema,
)


HIGH_RISK_REQUESTS = (
    ("/api/auth/login", "post"),
    ("/api/auth/register", "post"),
    ("/api/auth/reset-password", "post"),
    ("/api/auth/change-password", "post"),
    ("/api/strategies/{strategy_id}/start", "post"),
    ("/api/strategies/{strategy_id}/stop", "post"),
    ("/api/strategies/{strategy_id}", "delete"),
    ("/api/credentials/create", "post"),
    ("/api/credentials/delete", "delete"),
    ("/api/billing/usdt/create", "post"),
    ("/api/quick-trade/place-order", "post"),
    ("/api/quick-trade/close-position", "post"),
)


def test_high_risk_mutations_have_typed_requests(app):
    from app.openapi import get_openapi_api
    from app.openapi.register import enrich_spec

    api = get_openapi_api(app)
    with app.app_context():
        paths = enrich_spec(api.spec.to_dict())["paths"]

    for path, method in HIGH_RISK_REQUESTS:
        operation = paths[path][method]
        assert "requestBody" in operation or operation.get("parameters"), path


def test_login_validation_uses_human_error_envelope(client):
    response = client.post("/api/auth/login", json={"username": "demo"})

    assert response.status_code == 400
    assert response.get_json() == {
        "code": 0,
        "msg": "Invalid request data",
        "data": {"errors": {"json": {"password": ["Missing data for required field."]}}},
    }


def test_quick_trade_contract_normalizes_legacy_values():
    loaded = QuickTradeOrderRequestSchema().load(
        {
            "credential_id": 7,
            "symbol": "BTC/USDT",
            "side": "BUY",
            "order_type": "LIMIT",
            "amount": "50.5",
            "price": "60000",
            "market_type": "PERP",
            "marginMode": "ISOLATED",
        }
    )

    assert loaded["side"] == "buy"
    assert loaded["order_type"] == "limit"
    assert loaded["amount"] == 50.5
    assert loaded["market_type"] == "perp"
    assert loaded["marginMode"] == "isolated"


def test_credential_contract_requires_secrets_except_ibkr():
    with pytest.raises(ValidationError):
        CredentialCreateRequestSchema().load({"exchange_id": "binance"})

    loaded = CredentialCreateRequestSchema().load(
        {"exchange_id": "IBKR", "ibkr_port": 7497}
    )
    assert loaded["exchange_id"] == "ibkr"
