from app.routes.script_source_routes import _attach_v2_manifest


def test_v2_portfolio_source_is_classified_from_compiled_manifest():
    payload = _attach_v2_manifest({
        "asset_type": "script",
        "code": """
def initialize(context):
    context.set_universe(pool="sp500")
    context.subscribe(frequency="1d")

def handle_data(context, data):
    for symbol in get_universe_stocks():
        order_target_percent(symbol, 0.0)
""",
    })

    assert payload["asset_type"] == "portfolio_strategy"
    assert payload["metadata"]["strategy_manifest"]["strategyType"] == "portfolio"
    assert "apiVersion" not in payload["metadata"]
    assert "api_version" not in payload["metadata"]


def test_v2_cta_source_is_classified_from_compiled_manifest():
    payload = _attach_v2_manifest({
        "asset_type": "portfolio_strategy",
        "code": """
def initialize(context):
    context.set_universe(["USStock:SPY"])
    context.subscribe(frequency="1d")

def handle_data(context, data):
    order_target_percent("USStock:SPY", 1.0)
""",
    })

    assert payload["asset_type"] == "script"
    assert payload["metadata"]["strategy_manifest"]["strategyType"] == "cta"
