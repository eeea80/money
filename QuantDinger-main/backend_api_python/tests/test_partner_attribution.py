from decimal import Decimal

from app.services.exchange_execution import resolve_exchange_config
from app.services.live_trading.factory import create_client
from app.services.live_trading.partner_attribution import (
    get_partner_attribution,
    redact_partner_attribution,
)


def test_strategy_cannot_override_partner_attribution(monkeypatch):
    monkeypatch.setenv("QD_BYBIT_BROKER_REFERER", "server-owned")
    profile = get_partner_attribution()
    resolved = resolve_exchange_config(
        {
            "exchange_id": "bybit",
            "api_key": "key",
            "secret_key": "secret",
            "brokerReferer": "user-owned",
        }
    )
    assert "brokerReferer" not in resolved
    client = create_client(resolved, market_type="swap")
    assert client.broker_referer == profile.bybit_referer
    assert client.broker_referer not in {"server-owned", "user-owned"}


def test_htx_spot_source_is_server_owned(monkeypatch):
    monkeypatch.setenv("QD_HTX_SPOT_SOURCE", "assigned-source")
    monkeypatch.setenv("QD_HTX_BROKER_ID", "server-owned")
    profile = get_partner_attribution()
    client = create_client(
        {
            "exchange_id": "htx",
            "api_key": "key",
            "secret_key": "secret",
            "htxSpotSource": "user-source",
        },
        market_type="spot",
    )
    assert client.spot_source == profile.htx_spot_source
    assert client.broker_id == profile.htx_broker_id


def test_partner_attribution_does_not_require_environment(monkeypatch):
    monkeypatch.delenv("QD_OKX_BROKER_CODE", raising=False)
    monkeypatch.setattr("app.services.settings.env_file.read_env_file", lambda: {})
    profile = get_partner_attribution()
    client = create_client(
        {
            "exchange_id": "okx",
            "api_key": "key",
            "secret_key": "secret",
            "passphrase": "pass",
        },
        market_type="swap",
    )

    assert client.broker_code == profile.okx_broker_code


def test_all_exchange_request_attribution_is_built_in():
    profile = get_partner_attribution()
    clients = {
        "binance_spot": create_client(
            {"exchange_id": "binance", "api_key": "key", "secret_key": "secret"},
            market_type="spot",
        ),
        "binance_swap": create_client(
            {"exchange_id": "binance", "api_key": "key", "secret_key": "secret"},
            market_type="swap",
        ),
        "okx": create_client(
            {
                "exchange_id": "okx",
                "api_key": "key",
                "secret_key": "secret",
                "passphrase": "pass",
            },
            market_type="spot",
        ),
        "bitget_spot": create_client(
            {
                "exchange_id": "bitget",
                "api_key": "key",
                "secret_key": "secret",
                "passphrase": "pass",
            },
            market_type="spot",
        ),
        "bitget_swap": create_client(
            {
                "exchange_id": "bitget",
                "api_key": "key",
                "secret_key": "secret",
                "passphrase": "pass",
            },
            market_type="swap",
        ),
        "bybit": create_client(
            {"exchange_id": "bybit", "api_key": "key", "secret_key": "secret"},
            market_type="swap",
        ),
        "gate": create_client(
            {"exchange_id": "gate", "api_key": "key", "secret_key": "secret"},
            market_type="spot",
        ),
        "htx": create_client(
            {"exchange_id": "htx", "api_key": "key", "secret_key": "secret"},
            market_type="spot",
        ),
    }

    assert clients["binance_spot"]._format_client_order_id("order").startswith(
        f"x-{profile.binance_spot_broker_id}"
    )
    assert clients["binance_swap"]._format_client_order_id("order").startswith(
        f"x-{profile.binance_futures_broker_id}"
    )

    captured = {}
    clients["okx"]._normalize_order_size = lambda **_kwargs: (Decimal("1"), None)
    clients["okx"]._signed_request = lambda _method, _path, **kwargs: captured.update(kwargs) or {"data": []}
    clients["okx"].place_market_order(symbol="BTCUSDT", side="buy", size=1, market_type="spot")
    assert captured["json_body"]["tag"] == profile.okx_broker_code

    assert clients["bitget_spot"]._headers(
        "1", "sign", "/api/v2/spot/trade/place-order"
    )["X-CHANNEL-API-CODE"] == profile.bitget_channel_api_code
    assert clients["bitget_swap"]._headers(
        "1", "sign", "/api/v2/mix/order/place-order"
    )["X-CHANNEL-API-CODE"] == profile.bitget_channel_api_code
    assert clients["bybit"]._headers("1", "sign")["Referer"] == profile.bybit_referer
    assert clients["gate"]._headers("1", "sign")["X-Gate-Channel-Id"] == profile.gate_channel_id
    assert clients["htx"]._format_spot_client_order_id("order").startswith(profile.htx_broker_id)
    assert clients["htx"].spot_source == profile.htx_spot_source


def test_partner_values_are_redacted_from_exchange_payloads():
    profile = get_partner_attribution()

    redacted = redact_partner_attribution(
        {
            "clientOrderId": f"x-{profile.binance_spot_broker_id}-order-9",
            "X-CHANNEL-API-CODE": profile.bitget_channel_api_code,
            "status": "filled",
        }
    )

    assert redacted["clientOrderId"] == "x-***-order-9"
    assert redacted["X-CHANNEL-API-CODE"] == "***"
    assert redacted["status"] == "filled"
