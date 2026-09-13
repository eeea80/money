from app.services.live_trading.bitget import BitgetMixClient


def test_normalized_contract_size_is_reported_back_in_base_asset_units():
    client = BitgetMixClient.__new__(BitgetMixClient)
    client._contract_cache = {}
    client._contract_cache_ttl_sec = 300.0
    contract = {
        "contractSize": "0.001",
        "sizeMultiplier": "0.1",
        "minTradeNum": "0.1",
    }
    client.get_contract = lambda **_kwargs: contract

    normalized = client.normalize_base_order_size(
        symbol="BTC/USDT",
        product_type="USDT-FUTURES",
        base_size=0.037993191620,
    )

    assert normalized == 0.0379


def test_normalized_size_without_contract_unit_remains_base_quantity():
    client = BitgetMixClient.__new__(BitgetMixClient)
    client._contract_cache = {}
    client._contract_cache_ttl_sec = 300.0
    client.get_contract = lambda **_kwargs: {
        "sizePlace": "4",
        "minTradeNum": "0.0001",
    }

    normalized = client.normalize_base_order_size(
        symbol="BTC/USDT",
        product_type="USDT-FUTURES",
        base_size=0.037993191620,
    )

    assert normalized == 0.0379
