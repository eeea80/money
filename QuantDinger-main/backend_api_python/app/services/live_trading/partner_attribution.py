"""Built-in exchange partner attribution metadata.

Partner identifiers affect platform revenue and must never be supplied by a
user credential, strategy payload, or agent request.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, repr=False)
class PartnerAttribution:
    binance_spot_broker_id: str
    binance_futures_broker_id: str
    okx_broker_code: str
    bitget_channel_api_code: str
    bybit_referer: str
    gate_channel_id: str
    htx_broker_id: str
    htx_spot_source: str


PARTNER_CONFIG_KEYS = frozenset(
    {
        "spot_broker_id",
        "spotBrokerId",
        "futures_broker_id",
        "futuresBrokerId",
        "broker_id",
        "brokerId",
        "broker_code",
        "brokerCode",
        "channel_api_code",
        "channelApiCode",
        "channel_code",
        "channelCode",
        "bybit_referer",
        "broker_referer",
        "brokerReferer",
        "gate_channel_id",
        "gateChannelId",
        "htx_spot_source",
        "htxSpotSource",
    }
)


def get_partner_attribution() -> PartnerAttribution:
    from app.services.live_trading.binance import BinanceFuturesClient
    from app.services.live_trading.binance_spot import BinanceSpotClient
    from app.services.live_trading.bitget import BitgetMixClient
    from app.services.live_trading.bybit import BybitClient
    from app.services.live_trading.gate import _GateBase
    from app.services.live_trading.htx import HtxClient
    from app.services.live_trading.okx import OkxClient

    return PartnerAttribution(
        binance_spot_broker_id=BinanceSpotClient._BROKER_ID,
        binance_futures_broker_id=BinanceFuturesClient._BROKER_ID,
        okx_broker_code=OkxClient._DEFAULT_BROKER_CODE,
        bitget_channel_api_code=BitgetMixClient._CHANNEL_API_CODE,
        bybit_referer=BybitClient._DEFAULT_BROKER_REFERER,
        gate_channel_id=_GateBase._CHANNEL_ID,
        htx_broker_id=HtxClient._BROKER_ID,
        htx_spot_source=HtxClient._SPOT_SOURCE,
    )


_SENSITIVE_PARTNER_KEYS = frozenset(
    str(key).replace("_", "").lower()
    for key in PARTNER_CONFIG_KEYS
) | {
    "xchannelapicode",
    "xgatechannelid",
    "referer",
}


def redact_partner_attribution(value: Any) -> Any:
    profile = get_partner_attribution()
    secret_values = tuple(
        item
        for item in (
            profile.binance_spot_broker_id,
            profile.binance_futures_broker_id,
            profile.okx_broker_code,
            profile.bitget_channel_api_code,
            profile.bybit_referer,
            profile.gate_channel_id,
            profile.htx_broker_id,
        )
        if str(item or "")
    )
    def walk(item: Any) -> Any:
        if isinstance(item, dict):
            output = {}
            for key, nested in item.items():
                normalized_key = "".join(ch for ch in str(key).lower() if ch.isalnum())
                output[key] = "***" if normalized_key in _SENSITIVE_PARTNER_KEYS else walk(nested)
            return output
        if isinstance(item, list):
            return [walk(nested) for nested in item]
        if isinstance(item, tuple):
            return tuple(walk(nested) for nested in item)
        if isinstance(item, str):
            result = item
            for secret in secret_values:
                result = result.replace(secret, "***")
            return result
        return item

    return walk(value)


def strip_partner_config(values: dict | None) -> dict:
    """Return a copy without revenue attribution overrides."""
    if not isinstance(values, dict):
        return {}
    return {key: value for key, value in values.items() if key not in PARTNER_CONFIG_KEYS}
