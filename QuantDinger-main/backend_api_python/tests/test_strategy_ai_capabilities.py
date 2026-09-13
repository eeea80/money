import pytest

from app.services.strategy_ai_capabilities import resolve_strategy_generation_intent
from app.services.strategy_ai_generation import (
    build_strategy_generation_request,
    build_strategy_system_prompt,
    validate_generated_strategy,
)
from app.services.strategy_authoring import get_strategy_authoring_contract
from app.services.strategy_v2 import StrategyV2ContractError


def _swap_source(*, direction_mode: str = "both", body: str = "    pass") -> str:
    return f'''"""
ETH Swap Capability Test

Exercises strict AI authoring semantics for a perpetual contract.
"""

def initialize(context):
    g.symbol = "Crypto:ETH/USDT@swap"
    context.set_universe([g.symbol])
    context.subscribe(frequency="1h")
    context.set_metadata(direction_mode="{direction_mode}")

def handle_data(context, data):
{body}
'''


VALID_BOTH_BODY = '''    long_position = get_position(g.symbol, position_side="long")
    short_position = get_position(g.symbol, position_side="short")
    if abs(long_position.amount) == 0:
        order_target_percent(
            g.symbol, 0.4, position_side="long", reason="long_entry"
        )
    if abs(short_position.amount) == 0:
        order_target_percent(
            g.symbol, -0.4, position_side="short", reason="short_entry"
        )'''


def test_capability_resolver_maps_chinese_bidirectional_request_to_both():
    intent = resolve_strategy_generation_intent(
        prompt="交易标的改成 ETH/USDT 永续，并且多空都交易",
        context={"instrument": "Crypto:ETH/USDT@swap"},
    )

    assert intent.requested_direction_mode == "both"
    assert set(intent.capabilities) >= {"crypto_swap", "bidirectional"}


@pytest.mark.parametrize(
    "prompt,expected",
    [
        ("把 direction_mode 从 both 改为 long_only", "long_only"),
        ("change direction from short_only to both", "both"),
        ("不是 long only，是多空都交易", "both"),
    ],
)
def test_direction_resolver_uses_the_requested_target_not_an_old_mode(prompt, expected):
    intent = resolve_strategy_generation_intent(prompt=prompt)

    assert intent.requested_direction_mode == expected


def test_perpetual_alias_without_canonical_context_loads_swap_capability():
    for prompt in ("交易 ETHUSDTSWAP", "交易 ETH 永续", "Build an ETH perpetual strategy"):
        intent = resolve_strategy_generation_intent(prompt=prompt)
        assert "crypto_swap" in intent.capabilities


def test_supertrend_request_loads_the_canonical_indicator_capability():
    intent = resolve_strategy_generation_intent(prompt="构建 ETH 永续 Supertrend 策略")

    assert "supertrend" in intent.capabilities
    assert "technical_factors" in intent.capabilities
    assert intent.factor_ids == ("supertrend",)
    assert intent.required_factor_ids == ("supertrend",)
    assert "crypto_swap" in intent.capabilities


def test_registered_factor_resolver_selects_only_requested_factor_definitions():
    prompt, intent = build_strategy_system_prompt(
        prompt="构建使用 MACD 和 KDJ 的 BTC 永续策略",
        asset_type="script",
    )

    assert intent.factor_ids == ("kdj", "macd")
    assert intent.required_factor_ids == ("kdj", "macd")
    assert "technical_factors" in intent.capabilities
    assert '"kdj": {' in prompt
    assert '"macd": {' in prompt
    assert '"rsi": {' not in prompt
    assert "Never guess output names or parameter aliases" in prompt


def test_generation_prompt_injects_only_relevant_capability_packs():
    stock_prompt, stock_intent = build_strategy_system_prompt(
        prompt="生成 SPY 日线均线策略",
        asset_type="script",
    )
    swap_prompt, swap_intent = build_strategy_system_prompt(
        prompt="ETH 永续多空双向，带止盈止损",
        asset_type="script",
        context={"instrument": "Crypto:ETH/USDT@swap"},
    )

    assert stock_intent.capabilities == ()
    assert "# Active capability contracts" not in stock_prompt
    assert set(swap_intent.capabilities) >= {"crypto_swap", "bidirectional", "protection"}
    assert "## Crypto perpetual contract" in swap_prompt
    assert "## Bidirectional swap behavior" in swap_prompt
    assert "## Native position protection" in swap_prompt
    assert "## Restart-safe strategy state" not in swap_prompt


def test_structured_request_exposes_machine_readable_capability_intent():
    request = build_strategy_generation_request(
        prompt="改成多空双向",
        asset_type="script",
        existing_code=_swap_source(direction_mode="long_only"),
    )

    assert '"requested_direction_mode": "both"' in request
    assert '"bidirectional"' in request
    assert '"crypto_swap"' in request

    factor_request = build_strategy_generation_request(
        prompt="使用 RSI 和布林带",
        asset_type="script",
    )
    assert '"requested_factor_ids": ["bollinger_bands", "rsi"]' in factor_request


def test_existing_factor_context_is_active_but_not_a_new_hard_requirement():
    source = _swap_source(
        direction_mode="long_only",
        body='''    # Legacy KDJ implementation remains valid for an unrelated edit.
    values = indicator("MACD", g.symbol, output="histogram")
    if len(values.dropna()) >= 2:
        order_target_percent(
            g.symbol, 0.4, position_side="long", reason="macd_entry"
        )''',
    )
    intent = resolve_strategy_generation_intent(
        prompt="我让你改啊",
        existing_code=source,
    )

    assert intent.factor_ids == ("macd",)
    assert intent.required_factor_ids == ()
    validate_generated_strategy(source, asset_type="script", intent=intent)


def test_requested_registered_factor_must_be_used_through_native_api():
    source = '''"""SPY factor contract test."""

def initialize(context):
    g.symbol = "USStock:SPY"
    context.set_universe([g.symbol])
    context.subscribe(frequency="1d")
    context.set_metadata(direction_mode="long_only")

def handle_data(context, data):
    order_target_percent(g.symbol, 0.2, reason="entry")
'''

    with pytest.raises(StrategyV2ContractError, match="aiRequestedFactorMissing:rsi"):
        validate_generated_strategy(
            source,
            asset_type="script",
            prompt="使用 RSI 构建策略",
        )

    native = source.replace(
        '    order_target_percent(g.symbol, 0.2, reason="entry")',
        '''    values = indicator("rsi", g.symbol, period=14).dropna()
    if len(values) >= 2 and float(values.iloc[-1]) > 50:
        order_target_percent(g.symbol, 0.2, reason="rsi_entry")''',
    )
    validate_generated_strategy(native, asset_type="script", prompt="使用 RSI 构建策略")


@pytest.mark.parametrize(
    "call,error",
    [
        ('indicator("rsi", g.symbol, timeperiod=14)', "aiFactorParameterUnsupported:rsi:timeperiod"),
        ('indicator("rsi", g.symbol, period=0)', "aiFactorParameterInvalid:rsi:period"),
        ('indicator("macd", g.symbol, output="unknown")', "aiFactorParameterInvalid:macd:output"),
    ],
)
def test_requested_factor_parameters_follow_registry_schema(call, error):
    source = '''"""Native factor parameter test."""

def initialize(context):
    g.symbol = "USStock:SPY"
    context.set_universe([g.symbol])
    context.subscribe(frequency="1d")
    context.set_metadata(direction_mode="long_only")

def handle_data(context, data):
    values = FACTOR_CALL
    if len(values.dropna()) >= 2:
        order_target_percent(g.symbol, 0.2, reason="factor_entry")
'''.replace("FACTOR_CALL", call)
    prompt = "使用 MACD 构建策略" if '"macd"' in call else "使用 RSI 构建策略"

    with pytest.raises(StrategyV2ContractError, match=error):
        validate_generated_strategy(source, asset_type="script", prompt=prompt)


def test_strict_authoring_rejects_metadata_only_bidirectional_strategy():
    with pytest.raises(StrategyV2ContractError, match="aiBidirectionalOrderLegsRequired"):
        validate_generated_strategy(
            _swap_source(),
            asset_type="script",
            prompt="策略支持多空双向",
        )


def test_strict_authoring_rejects_swap_order_without_position_side():
    body = '''    order_target_percent(g.symbol, 0.4, reason="entry")'''

    with pytest.raises(StrategyV2ContractError, match="aiSwapPositionSideRequired"):
        validate_generated_strategy(
            _swap_source(direction_mode="long_only", body=body),
            asset_type="script",
        )


def test_strict_authoring_requires_explicit_swap_direction_metadata():
    source = _swap_source(body=VALID_BOTH_BODY).replace(
        '    context.set_metadata(direction_mode="both")\n',
        "",
    )

    with pytest.raises(StrategyV2ContractError, match="aiSwapDirectionModeRequired"):
        validate_generated_strategy(source, asset_type="script")


@pytest.mark.parametrize(
    "metadata_call",
    [
        'context.set_metadata("direction_mode", "both")',
        'context.set_metadata({"direction_mode": "both"})',
    ],
)
def test_direction_metadata_accepts_all_supported_declaration_forms(metadata_call):
    source = _swap_source(body=VALID_BOTH_BODY).replace(
        'context.set_metadata(direction_mode="both")',
        metadata_call,
    )

    program = validate_generated_strategy(source, asset_type="script")

    assert program.manifest.direction_mode == "both"


def test_direction_metadata_declared_only_in_handler_is_rejected():
    source = _swap_source(body=VALID_BOTH_BODY).replace(
        '    context.set_metadata(direction_mode="both")\n',
        "",
    ).replace(
        "def handle_data(context, data):\n",
        'def handle_data(context, data):\n    context.set_metadata(direction_mode="both")\n',
    )

    with pytest.raises(StrategyV2ContractError, match="aiSwapDirectionModeRequired"):
        validate_generated_strategy(source, asset_type="script")


def test_strict_authoring_accepts_genuine_bidirectional_swap_behavior():
    program = validate_generated_strategy(
        _swap_source(body=VALID_BOTH_BODY),
        asset_type="script",
        prompt="策略支持多空双向",
    )

    assert program.manifest.direction_mode == "both"


def test_requested_direction_must_match_manifest():
    long_body = '''    order_target_percent(
        g.symbol, 0.4, position_side="long", reason="long_entry"
    )'''

    with pytest.raises(StrategyV2ContractError, match="aiDirectionModeMismatch:both:long_only"):
        validate_generated_strategy(
            _swap_source(direction_mode="long_only", body=long_body),
            asset_type="script",
            prompt="改成多空双向",
        )


def test_requested_protection_requires_executable_native_protection():
    source = '''"""SPY Protection Test"""

def initialize(context):
    g.symbol = "USStock:SPY"
    context.set_universe([g.symbol])
    context.subscribe(frequency="1d")
    context.set_metadata(direction_mode="long_only")

def handle_data(context, data):
    order_target_percent(g.symbol, 0.5, reason="entry")
'''

    with pytest.raises(StrategyV2ContractError, match="aiProtectionImplementationRequired"):
        validate_generated_strategy(
            source,
            asset_type="script",
            prompt="增加 3% 止损",
        )

    protected = source.replace(
        'reason="entry")',
        'reason="entry", stop_loss_pct=0.03)',
    )
    validate_generated_strategy(protected, asset_type="script", prompt="增加 3% 止损")


@pytest.mark.parametrize(
    "body",
    [
        '    order_target_percent(g.symbol, 0.5, reason="entry", stop_loss_pct=0.0)',
        '''    custom_risk(stop_loss_pct=0.03)
    order_target_percent(g.symbol, 0.5, reason="entry")''',
    ],
)
def test_empty_or_unrelated_protection_does_not_satisfy_requested_stop(body):
    source = '''"""SPY Protection Test"""

def custom_risk(**kwargs):
    return kwargs

def initialize(context):
    g.symbol = "USStock:SPY"
    context.set_universe([g.symbol])
    context.subscribe(frequency="1d")
    context.set_metadata(direction_mode="long_only")

def handle_data(context, data):
{body}
'''.format(body=body)

    with pytest.raises(StrategyV2ContractError, match="aiProtectionImplementationRequired"):
        validate_generated_strategy(source, asset_type="script", prompt="增加止损")


def test_zero_only_orders_cannot_claim_bidirectional_opening_behavior():
    body = '''    order_target_percent(
        g.symbol, 0.0, position_side="long", reason="long_exit"
    )
    order_target_percent(
        g.symbol, 0.0, position_side="short", reason="short_exit"
    )'''

    with pytest.raises(StrategyV2ContractError, match="aiBidirectionalOrderLegsRequired"):
        validate_generated_strategy(
            _swap_source(body=body),
            asset_type="script",
            prompt="多空双向",
        )


def test_unresolved_dynamic_swap_side_is_rejected_in_strict_authoring():
    body = '''    side = context.params.get("side", "long")
    order_target_percent(g.symbol, 0.5, position_side=side, reason="entry")'''

    with pytest.raises(StrategyV2ContractError, match="aiPositionSideInvalid"):
        validate_generated_strategy(
            _swap_source(direction_mode="long_only", body=body),
            asset_type="script",
        )


def test_helper_position_side_is_resolved_from_literal_call_sites():
    source = _swap_source(body='''    submit(g.symbol, "long", 0.4)
    submit(g.symbol, "short", -0.4)''') + '''

def submit(symbol, side, target):
    order_target_percent(
        symbol,
        target,
        position_side=side,
        reason="helper_target",
    )
'''

    program = validate_generated_strategy(
        source,
        asset_type="script",
        prompt="改成多空双向",
    )

    assert program.manifest.direction_mode == "both"


def test_mixed_universe_enforces_position_side_only_for_swap_calls():
    source = '''"""Mixed Universe Position Side Test"""

def initialize(context):
    g.stock = "USStock:SPY"
    g.swap = "Crypto:ETH/USDT@swap"
    context.set_universe([g.stock, g.swap])
    context.subscribe(frequency="1h")
    context.set_metadata(direction_mode="long_only")

def handle_data(context, data):
    order_target_percent(g.stock, 0.2, reason="stock_entry")
    order_target_percent(g.swap, 0.2, reason="swap_entry")
'''

    with pytest.raises(StrategyV2ContractError, match="aiSwapPositionSideRequired"):
        validate_generated_strategy(source, asset_type="portfolio")

    validate_generated_strategy(
        source.replace(
            'order_target_percent(g.swap, 0.2, reason="swap_entry")',
            'order_target_percent(\n'
            '        g.swap, 0.2, position_side="long", reason="swap_entry"\n'
            '    )',
        ),
        asset_type="portfolio",
    )


def test_initialize_rejects_runtime_only_api_calls():
    source = _swap_source(direction_mode="long_only", body='''    order_target_percent(
        g.symbol, 0.4, position_side="long", reason="entry"
    )''').replace(
        '    context.set_metadata(direction_mode="long_only")',
        '    context.set_metadata(direction_mode="long_only")\n'
        '    get_position(g.symbol, position_side="long")',
    )

    with pytest.raises(StrategyV2ContractError, match="aiInitializeRuntimeApiUnsupported"):
        validate_generated_strategy(source, asset_type="script")


def test_simple_limit_request_does_not_require_order_lifecycle_pack():
    intent = resolve_strategy_generation_intent(prompt="把入场改成限价单")

    assert "advanced_execution" in intent.capabilities
    assert "order_lifecycle" not in intent.capabilities


def test_legacy_limit_alias_still_requires_a_positive_price():
    body = '''    order_target_percent(
        g.symbol,
        0.4,
        position_side="long",
        type="limit",
        reason="limit_entry",
    )'''

    with pytest.raises(StrategyV2ContractError, match="limitPriceRequired"):
        validate_generated_strategy(
            _swap_source(direction_mode="long_only", body=body),
            asset_type="script",
            prompt="改成限价单",
        )

    validate_generated_strategy(
        _swap_source(
            direction_mode="long_only",
            body=body.replace('reason="limit_entry"', 'price=2000, reason="limit_entry"'),
        ),
        asset_type="script",
        prompt="改成限价单",
    )


def test_order_lifecycle_requires_ids_and_linked_status_checks():
    without_id = '''    order_ref = order_target_percent(
        g.symbol, 0.4, position_side="long", reason="entry"
    )
    get_order_status(order_ref)'''
    lifecycle_source = "PERSIST_RUNTIME_STATE = True\n\n" + _swap_source(
        direction_mode="long_only",
        body=without_id,
    )
    with pytest.raises(StrategyV2ContractError, match="aiClientOrderIdRequired"):
        validate_generated_strategy(
            lifecycle_source,
            asset_type="script",
            prompt="增加订单状态检查",
        )

    unrelated_status = without_id.replace(
        'position_side="long", reason="entry"',
        'position_side="long", client_order_id="entry-1", reason="entry"',
    ).replace("get_order_status(order_ref)", 'get_order_status("some-other-id")')
    with pytest.raises(StrategyV2ContractError, match="aiOrderStatusCheckRequired"):
        validate_generated_strategy(
            "PERSIST_RUNTIME_STATE = True\n\n"
            + _swap_source(direction_mode="long_only", body=unrelated_status),
            asset_type="script",
            prompt="增加订单状态检查",
        )

    linked_status = unrelated_status.replace(
        'get_order_status("some-other-id")',
        'status = get_order_status(order_ref)\n    status["status"]',
    )
    validate_generated_strategy(
        "PERSIST_RUNTIME_STATE = True\n\n"
        + _swap_source(direction_mode="long_only", body=linked_status),
        asset_type="script",
        prompt="增加订单状态检查",
    )


def test_order_status_mapping_must_read_its_status_field():
    body = '''    order_ref = order_target_percent(
        g.symbol,
        0.4,
        position_side="long",
        client_order_id="entry-1",
        reason="entry",
    )
    status = get_order_status(order_ref)
    if status == "filled":
        log.info("filled")'''
    source = "PERSIST_RUNTIME_STATE = True\n\n" + _swap_source(
        direction_mode="long_only",
        body=body,
    )

    with pytest.raises(StrategyV2ContractError, match="aiOrderStatusFieldRequired"):
        validate_generated_strategy(source, asset_type="script", prompt="检查订单状态")


def test_bidirectional_lifecycle_ids_must_vary_by_logical_order():
    body = '''    long_ref = order_target_percent(
        g.symbol,
        0.4,
        position_side="long",
        client_order_id="long-open",
        reason="long_entry",
    )
    short_ref = order_target_percent(
        g.symbol,
        -0.4,
        position_side="short",
        client_order_id="short-open",
        reason="short_entry",
    )
    long_status = get_order_status(long_ref)
    short_status = get_order_status(short_ref)
    long_status["status"]
    short_status["status"]'''
    source = "PERSIST_RUNTIME_STATE = True\n\n" + _swap_source(body=body)

    with pytest.raises(StrategyV2ContractError, match="aiClientOrderIdMustVary"):
        validate_generated_strategy(source, asset_type="script", prompt="多空订单状态对账")


def test_custom_supertrend_reimplementation_is_rejected():
    body = '''    atr = indicator("ATR", g.symbol, timeperiod=10)
    if len(atr) > 2:
        order_target_percent(
            g.symbol, 0.4, position_side="long", reason="long_entry"
        )'''

    with pytest.raises(StrategyV2ContractError, match="aiSupertrendNativeRequired"):
        validate_generated_strategy(
            _swap_source(direction_mode="long_only", body=body),
            asset_type="script",
            prompt="创建 Supertrend 策略",
        )


def test_protection_dictionary_is_valid_executable_protection():
    source = '''"""SPY Dictionary Protection Test"""

def initialize(context):
    g.symbol = "USStock:SPY"
    context.set_universe([g.symbol])
    context.subscribe(frequency="1d")
    context.set_metadata(direction_mode="long_only")

def handle_data(context, data):
    order_target_percent(
        g.symbol,
        0.5,
        protection={"stop_loss_pct": 0.03, "take_profit_pct": 0.08},
        reason="entry",
    )
'''

    validate_generated_strategy(source, asset_type="script", prompt="增加止盈止损")


@pytest.mark.parametrize(
    "existing_code",
    [
        _swap_source(direction_mode="both", body=VALID_BOTH_BODY).replace(
            'context.set_metadata(direction_mode="both")',
            'context.set_metadata("direction_mode", "both")',
        ),
        _swap_source(direction_mode="both", body=VALID_BOTH_BODY).replace(
            'context.set_metadata(direction_mode="both")',
            'context.set_metadata({"direction_mode": "both"})',
        ),
    ],
)
def test_existing_direction_is_preserved_for_supported_metadata_forms(existing_code):
    intent = resolve_strategy_generation_intent(prompt="优化入场信号", existing_code=existing_code)

    assert intent.requested_direction_mode == "both"


def test_restart_sensitive_strategy_requires_persistent_state_contract():
    source = _swap_source(direction_mode="both", body=VALID_BOTH_BODY)

    with pytest.raises(StrategyV2ContractError, match="aiPersistentStateRequired"):
        validate_generated_strategy(
            source,
            asset_type="script",
            prompt="改成网格策略并支持重启恢复",
        )


def test_persistence_flag_must_be_declared_at_module_scope():
    source = _swap_source(
        direction_mode="both",
        body='''    PERSIST_RUNTIME_STATE = True
    long_ref = order_target_percent(
        g.symbol,
        0.4,
        position_side="long",
        client_order_id="grid-long",
        reason="grid_long",
    )
    short_ref = order_target_percent(
        g.symbol,
        -0.4,
        position_side="short",
        client_order_id="grid-short",
        reason="grid_short",
    )
    get_order_status(long_ref)
    get_order_status(short_ref)''',
    )

    with pytest.raises(StrategyV2ContractError, match="aiPersistentStateRequired"):
        validate_generated_strategy(
            source,
            asset_type="script",
            prompt="网格策略支持跨重启",
        )


def test_external_authoring_contract_exports_same_capability_catalog():
    contract = get_strategy_authoring_contract()

    assert contract["version"] == "strategy-api-v2-capability-packs-2026-09"
    assert contract["direction_modes"]["bidirectional"] == "both"
    assert set(contract["direction_modes"]["allowed"]) == {
        "long_only",
        "short_only",
        "both",
        "neutral",
    }
    assert set(contract["capability_packs"]) >= {
        "crypto_swap",
        "bidirectional",
        "order_lifecycle",
        "protection",
        "persistent_state",
        "scheduling",
        "supertrend",
        "technical_factors",
    }
    factor_catalog = {
        item["factor_id"]: item for item in contract["technical_factor_catalog"]
    }
    assert {"macd", "kdj", "rsi", "supertrend"} <= set(factor_catalog)
    assert factor_catalog["macd"]["parameter_schema"]
    assert contract["capability_packs"]["crypto_swap"]["rules"]["position_sides"] == [
        "long",
        "short",
    ]
    assert contract["capability_packs"]["protection"]["rules"]["ratio_limits"][
        "stop_loss_pct"
    ] == 1.0
    validate_generated_strategy(
        contract["multi_timeframe_template"],
        asset_type="script",
    )
