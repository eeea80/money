import ccxt

from app.data_sources import crypto
from app.services import symbol_master_sync
from app.services.symbol_master_sync import (
    SymbolMasterRow,
    _okx_public_payload_to_rows,
    fetch_crypto_symbols,
    fetch_crypto_symbols_with_diagnostics,
)
from app.services.market.symbol_search import _classify_asset


class FakeExchange:
    def __init__(self, config):
        market_type = (config.get("options") or {}).get("defaultType") or "spot"
        is_swap = market_type in {"swap", "linear"}
        self.markets = {
            "AAPL/USDT:USDT" if is_swap else "AAPL/USDT": {
                "active": True,
                "spot": not is_swap,
                "swap": is_swap,
                "base": "AAPL",
                "quote": "USDT",
                "settle": "USDT" if is_swap else None,
                "id": "AAPLUSDT",
                "displayName": "Apple",
            }
        }

    def load_markets(self):
        return self.markets


def test_full_catalog_keeps_same_equity_separate_by_venue_and_product(monkeypatch):
    monkeypatch.setattr(
        crypto,
        "resolve_ccxt_for_live_trading",
        lambda exchange_id, market_type: (
            exchange_id,
            {"defaultType": market_type},
        ),
    )
    for exchange_id in crypto.PUBLIC_KLINE_EXCHANGE_IDS:
        monkeypatch.setattr(ccxt, exchange_id, FakeExchange)

    rows = fetch_crypto_symbols()

    assert len(rows) == 12
    assert {
        (row.exchange, row.market_type)
        for row in rows
    } == {
        (exchange_id, market_type)
        for exchange_id in crypto.PUBLIC_KLINE_EXCHANGE_IDS
        for market_type in ("spot", "swap")
    }


def test_equity_metadata_is_classified_without_ticker_hardcoding():
    assert _classify_asset({"info": {"instCategory": "3"}}) == "equity"
    assert _classify_asset({"info": {"symbolType": "xstocks"}}) == "equity"
    assert _classify_asset({"info": {"symbolType": "stock"}}) == "equity"
    assert _classify_asset({"info": {"isRwa": "YES"}}) == "rwa"
    assert _classify_asset({"info": {}}) == "crypto"


def test_catalog_diagnostics_report_every_venue_product(monkeypatch):
    monkeypatch.setattr(
        crypto,
        "resolve_ccxt_for_live_trading",
        lambda exchange_id, market_type: (exchange_id, {"defaultType": market_type}),
    )
    for exchange_id in crypto.PUBLIC_KLINE_EXCHANGE_IDS:
        monkeypatch.setattr(ccxt, exchange_id, FakeExchange)

    rows, contexts = fetch_crypto_symbols_with_diagnostics()

    assert len(rows) == 12
    assert len(contexts) == 12
    assert all(context["ok"] and context["rows"] == 1 for context in contexts)


def test_okx_ccxt_config_uses_current_public_hostname():
    config = crypto.apply_public_ccxt_endpoint_config({"enableRateLimit": True}, "okx")

    assert config["hostname"] == "openapi.okx.com"


def test_okx_public_payload_parser_keeps_only_live_usdt_instruments():
    spot_payload = {
        "code": "0",
        "data": [
            {"instId": "BTC-USDT", "baseCcy": "BTC", "quoteCcy": "USDT", "state": "live"},
            {"instId": "ETH-USDC", "baseCcy": "ETH", "quoteCcy": "USDC", "state": "live"},
            {"instId": "OLD-USDT", "baseCcy": "OLD", "quoteCcy": "USDT", "state": "suspend"},
        ],
    }
    swap_payload = {
        "code": "0",
        "data": [
            {"instId": "BTC-USDT-SWAP", "ctValCcy": "BTC", "settleCcy": "USDT", "state": "live"},
            {"instId": "BTC-USD-SWAP", "ctValCcy": "BTC", "settleCcy": "BTC", "state": "live"},
        ],
    }

    spot_rows = _okx_public_payload_to_rows(spot_payload, "spot", _classify_asset)
    swap_rows = _okx_public_payload_to_rows(swap_payload, "swap", _classify_asset)

    assert [(row.symbol, row.instrument_id) for row in spot_rows] == [("BTC/USDT", "BTC-USDT")]
    assert [(row.symbol, row.instrument_id) for row in swap_rows] == [("BTC/USDT", "BTC-USDT-SWAP")]


def test_okx_catalog_uses_official_public_fallback_when_ccxt_fails(monkeypatch):
    class FailingExchange:
        def __init__(self, config):
            self.markets = {}

        def load_markets(self, reload=False):
            raise RuntimeError("primary endpoint unavailable")

    monkeypatch.setattr(
        crypto,
        "resolve_ccxt_for_live_trading",
        lambda exchange_id, market_type: (exchange_id, {"defaultType": market_type}),
    )
    for exchange_id in crypto.PUBLIC_KLINE_EXCHANGE_IDS:
        monkeypatch.setattr(ccxt, exchange_id, FailingExchange if exchange_id == "okx" else FakeExchange)

    def fake_okx_rows(market_type, classify_asset):
        instrument_id = "BTC-USDT" if market_type == "spot" else "BTC-USDT-SWAP"
        return [SymbolMasterRow(
            "Crypto", "BTC/USDT", "BTC", "okx", "USDT", market_type,
            instrument_id, "USDT", "crypto",
        )]

    monkeypatch.setattr(symbol_master_sync, "_fetch_okx_public_symbol_rows", fake_okx_rows)

    rows, contexts = fetch_crypto_symbols_with_diagnostics()
    okx_contexts = [context for context in contexts if context["exchange"] == "okx"]

    assert len(rows) == 12
    assert len(okx_contexts) == 2
    assert all(context["ok"] and context["fallback"] for context in okx_contexts)
