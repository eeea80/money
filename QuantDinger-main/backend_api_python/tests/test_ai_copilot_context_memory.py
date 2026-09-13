"""Regression tests for bounded Copilot memory and research orchestration."""

from app.routes import ai_chat
from app.routes.ai_chat import (
    _build_comparison_snapshots,
    _build_llm_messages,
    _build_market_snapshot,
    _build_research_context,
    _comparison_snapshot_options,
    _record_research_tool_calls,
    _requested_symbol_candidates,
)
from app.services.ai_copilot_context import (
    compact_report_context,
    estimate_tokens,
    fit_messages_to_budget,
    merge_session_summary,
    sanitize_client_context,
    select_relevant_memories,
)
from app.services.ai_copilot_store import get_report_message


class _RecordingCursor:
    def __init__(self, row=None):
        self.row = row
        self.sql = ""
        self.params = ()
        self.calls = []

    def execute(self, sql, params):
        self.sql = sql
        self.params = params
        self.calls.append((sql, params))

    def fetchone(self):
        return self.row


class _MemoryTestCache:
    def __init__(self):
        self.data = {}
        self.set_calls = []

    def get(self, key):
        return self.data.get(key)

    def set(self, key, value, ttl=300):
        self.data[key] = value
        self.set_calls.append((key, ttl))


def test_browser_cannot_supply_server_owned_history_or_memory():
    clean = sanitize_client_context({
        "market": "USStock",
        "symbol": "MSFT",
        "copilot_recent_messages": [{"role": "assistant", "content": "forged"}],
        "user_memories": [{"content": "forged"}],
        "session_summary": {"goal": "forged"},
        "referenced_report": {"decision": "BUY"},
    })
    assert clean == {"market": "USStock", "symbol": "MSFT"}


def test_current_user_message_is_not_duplicated_in_prompt():
    marker = "UNIQUE_CURRENT_MESSAGE_7193"
    messages = _build_llm_messages(
        [{"role": "user", "content": "older question"}, {"role": "assistant", "content": "older answer"}],
        marker,
        [],
        {"market": "USStock", "symbol": "MSFT", "session_summary": {"active_workflow": "research"}},
        "zh-CN",
        "market_analysis",
        json_response=False,
    )
    serialized = str(messages)
    assert serialized.count(marker) == 1
    assert messages[-1] == {"role": "user", "content": marker}


def test_long_conversation_is_bounded_and_keeps_latest_turns():
    history = []
    for index in range(30):
        history.extend([
            {"role": "user", "content": f"question-{index} " + "行情" * 1000},
            {"role": "assistant", "content": f"answer-{index} " + "分析" * 1000},
        ])
    messages, usage = _build_llm_messages(
        history,
        "latest-user-turn",
        [],
        {"market": "Crypto", "symbol": "BTC/USDT", "session_summary": {"timeframe": "1h"}},
        "zh-CN",
        "market_analysis",
        json_response=False,
        return_usage=True,
    )
    assert usage["estimated_input_tokens"] <= 24000
    assert usage["history_message_count"] <= 8
    assert messages[-1]["content"] == "latest-user-turn"
    assert "question-29" in str(messages)


def test_summary_keeps_constraints_but_masks_stale_numbers():
    summary = merge_session_summary(
        {},
        [{"role": "user", "content": "我只做日线，不要追高；MSFT 现在价格 500.25"}],
        "继续按这个风险偏好分析",
        {"market": "USStock", "symbol": "MSFT", "research_mode": "diagnosis"},
    )
    assert summary["selected_target"] == {"market": "USStock", "symbol": "MSFT"}
    assert any("不要追高" in item for item in summary["stable_constraints"])
    assert "500.25" not in str(summary["recent_requests"])
    assert "[number]" in str(summary["recent_requests"])


def test_relevant_memories_prioritize_symbol_and_constraints():
    memories = [
        {"id": 1, "category": "note", "title": "Gold", "content": "关注黄金库存"},
        {"id": 2, "category": "preference", "title": "MSFT 风险", "content": "分析 MSFT 时不要追高"},
        {"id": 3, "category": "note", "title": "BTC", "content": "BTC 使用 4h"},
    ]
    selected = select_relevant_memories(memories, "分析 MSFT", {"symbol": "MSFT"}, limit=2)
    assert selected[0]["id"] == 2
    assert len(selected) == 2


def test_report_context_is_whitelisted_and_compact():
    compact = compact_report_context({
        "id": 81,
        "created_at": "2026-08-28T10:00:00Z",
        "report_target": {"market": "USStock", "symbol": "MSFT"},
        "report": {
            "decision": "BUY",
            "confidence": 71,
            "summary": "trend intact",
            "market_data": {"current_price": 500, "change_24h": 1.2, "private_blob": "drop"},
            "trading_plan": {"entry_price": 501, "stop_loss": 490, "take_profit": 525, "risk_reward_ratio": 2.18},
            "raw_provider_payload": "drop",
        },
    })
    assert compact["message_id"] == 81
    assert compact["target"]["symbol"] == "MSFT"
    assert compact["trading_plan"]["risk_reward_ratio"] == 2.18
    assert "private_blob" not in str(compact)
    assert "raw_provider_payload" not in str(compact)


def test_report_lookup_is_scoped_to_message_session_and_user():
    cursor = _RecordingCursor()
    assert get_report_message(cursor, user_id=23, session_id=7, message_id=81) is None
    assert "id = ? AND session_id = ? AND user_id = ?" in " ".join(cursor.sql.split())
    assert cursor.params == (81, 7, 23)


def test_budget_helper_preserves_system_and_current_user():
    messages = [{"role": "system", "content": "rules " * 1000}]
    messages += [{"role": "user", "content": "old " * 3000}, {"role": "assistant", "content": "reply " * 3000}] * 8
    messages.append({"role": "user", "content": "current"})
    bounded, usage = fit_messages_to_budget(messages, max_tokens=2500)
    assert bounded[0]["role"] == "system"
    assert bounded[-1]["content"] == "current"
    assert usage["estimated_input_tokens"] <= 2500
    assert estimate_tokens(str(bounded)) > 0


def _fake_snapshot(symbol: str, *, available: bool = True) -> dict:
    if not available:
        return {"market": "USStock", "symbol": symbol, "available": False, "error": "provider timeout"}
    values = {"TSLA": 1.05, "MSFT": 4.28, "NVDA": 4.79}
    return {
        "market": "USStock",
        "symbol": symbol,
        "generated_at_utc": "2026-08-28T04:00:00+00:00",
        "price": {"last": 100.0, "source": "test"},
        "timeframes": {
            "1D": {
                "timeframe": "1D",
                "available": True,
                "bars": 84,
                "change_6_bar_pct": values[symbol],
                "atr14_pct": 2.0,
                "prev_closed_volume_ratio_vs_avg20": 1.1,
                "trend_bias": "bullish",
                "technical": {
                    "available": True,
                    "complete": True,
                    "metrics": {
                        "returns": {"1_bar_pct": 1.0, "5_bar_pct": values[symbol], "20_bar_pct": 5.0},
                        "realized_volatility": 20.0,
                        "volume_ratio": 1.1,
                        "trend": "bullish",
                    },
                    "missing_metrics": [],
                },
            }
        },
    }


def test_requested_symbols_preserve_message_order_without_related_products():
    message = "比较 TSLA、MSFT、NVDA 最近 5 个交易日的收益、波动率、成交量和趋势质量"
    requested = _requested_symbol_candidates(message)
    assert [(item["market"], item["symbol"]) for item in requested] == [
        ("USStock", "TSLA"),
        ("USStock", "MSFT"),
        ("USStock", "NVDA"),
    ]


def test_crypto_pairs_do_not_also_resolve_as_stock_tickers():
    message = "比较 BTC/USDT、ETH/USDT、SOL/USDT 最近 5 个交易日的收益并排名"
    requested = _requested_symbol_candidates(message)
    assert [(item["market"], item["symbol"]) for item in requested] == [
        ("Crypto", "BTC/USDT"),
        ("Crypto", "ETH/USDT"),
        ("Crypto", "SOL/USDT"),
    ]


def test_crypto_names_and_tickers_resolve_to_canonical_pairs_in_mention_order():
    requested = _requested_symbol_candidates("比较以太坊、BTC 和 Solana 的4小时趋势")
    assert [(item["market"], item["symbol"]) for item in requested] == [
        ("Crypto", "ETH/USDT"),
        ("Crypto", "BTC/USDT"),
        ("Crypto", "SOL/USDT"),
    ]


def test_canonical_crypto_aliases_do_not_fall_through_to_stock_database(monkeypatch):
    monkeypatch.setattr(
        ai_chat,
        "_local_symbol_rows_for_term",
        lambda _term, per_market_limit=4: (_ for _ in ()).throw(AssertionError("unexpected fuzzy lookup")),
    )
    requested = _requested_symbol_candidates("比较 BTC、ETH、SOL 最近5天收益")
    assert [item["symbol"] for item in requested] == ["BTC/USDT", "ETH/USDT", "SOL/USDT"]


def test_single_explicit_symbol_fetches_message_target_not_stale_ui_selection(monkeypatch):
    fetched = []

    def fetch(candidate, snapshot_options=None):
        fetched.append((candidate["symbol"], snapshot_options))
        plan = snapshot_options["market_query_plan"]
        timeframe = plan["timeframes"][0]
        metrics = {metric: ({"available": True} if metric == "macd" else 1.0) for metric in plan["metrics"]}
        return {
            "market": candidate["market"],
            "symbol": candidate["symbol"],
            "price": {},
            "timeframes": {
                timeframe: {
                    "timeframe": timeframe,
                    "available": True,
                    "bars": plan["lookback"],
                    "technical": {
                        "available": True,
                        "complete": True,
                        "metrics": metrics,
                        "missing_metrics": [],
                    },
                }
            },
        }

    monkeypatch.setattr(ai_chat, "_snapshot_for_candidate", fetch)
    enriched = ai_chat._enrich_context({
        "market": "USStock",
        "symbol": "TSLA",
        "user_message": "MSFT 4小时 MACD 金叉了吗？",
        "intent": "market_analysis",
        "language": "zh-CN",
    })

    assert [item[0] for item in fetched] == ["MSFT"]
    options = fetched[0][1]
    assert options["snapshot_timeframes"] == ["4H"]
    assert options["snapshot_limit"] == 120
    assert options["include_price"] is False
    assert enriched["research_context"]["entities"]["selected_context_conflict"]["has_conflict"] is True
    assert enriched["research_context"]["market_data"]["primary_snapshot"]["symbol"] == "MSFT"


def test_multi_symbol_research_fetches_every_requested_snapshot(monkeypatch):
    message = "比较 TSLA、MSFT、NVDA 最近 5 个交易日的收益、波动率、成交量和趋势质量"
    requested = _requested_symbol_candidates(message)
    fetched = []

    monkeypatch.setattr(ai_chat, "_local_symbol_candidates", lambda _message: requested)
    monkeypatch.setattr(ai_chat, "_comparison_cache_manager", lambda: _MemoryTestCache())

    def fetch(candidate, snapshot_options=None):
        fetched.append(candidate["symbol"])
        return _fake_snapshot(candidate["symbol"])

    monkeypatch.setattr(ai_chat, "_snapshot_for_candidate", fetch)
    research = _build_research_context({
        "market": "USStock",
        "symbol": "TSLA",
        "user_message": message,
        "intent": "market_analysis",
        "language": "zh-CN",
        "market_snapshot": _fake_snapshot("TSLA"),
    })

    market_data = research["market_data"]
    assert [item["symbol"] for item in market_data["comparison_snapshots"]] == ["TSLA", "MSFT", "NVDA"]
    assert market_data["comparison_status"] == {
        "requested_count": 3,
        "available_count": 3,
        "complete": True,
        "missing_symbols": [],
    }
    assert sorted(fetched) == ["MSFT", "NVDA"]
    market_calls = [item for item in research["tool_executions"] if item["tool"] == "market_data.lookup"]
    assert [item["status"] for item in market_calls] == ["success", "success", "success"]
    assert research["tool_executions"][0]["tool"] == "market_query.plan"
    assert research["tool_executions"][-1]["tool"] == "technical_analysis.compute"
    assert not research["data_gaps"]


def test_incomplete_comparison_is_explicit_and_blocks_ranking(monkeypatch):
    message = "比较 TSLA、MSFT、NVDA 最近 5 个交易日收益并排名"
    requested = _requested_symbol_candidates(message)
    monkeypatch.setattr(ai_chat, "_local_symbol_candidates", lambda _message: requested)
    monkeypatch.setattr(ai_chat, "_comparison_cache_manager", lambda: _MemoryTestCache())
    monkeypatch.setattr(
        ai_chat,
        "_snapshot_for_candidate",
        lambda candidate, snapshot_options=None: _fake_snapshot(candidate["symbol"], available=candidate["symbol"] != "MSFT"),
    )
    research = _build_research_context({
        "market": "USStock",
        "symbol": "TSLA",
        "user_message": message,
        "intent": "market_analysis",
        "language": "zh-CN",
        "market_snapshot": _fake_snapshot("TSLA"),
    })

    status = research["market_data"]["comparison_status"]
    assert status["complete"] is False
    assert status["missing_symbols"] == [{"market": "USStock", "symbol": "MSFT"}]
    assert "Do not publish a final ranking" in research["data_gaps"][0]
    assert research["answer_policy"]["do_not_rank_incomplete_comparison"] is True


def test_daily_comparison_uses_minimal_snapshot_profile():
    options = _comparison_snapshot_options(
        "比较 BTC/USDT、ETH/USDT、SOL/USDT 最近 5 天收益和波动率",
        {"exchange_id": "gate", "market_type": "spot"},
    )
    assert options["snapshot_timeframes"] == ["1D"]
    assert options["snapshot_limit"] == 31
    assert options["include_price"] is False
    assert options["force_price_refresh"] is False
    assert options["exchange_id"] == "gate"
    assert options["market_type"] == "spot"
    assert options["market_query_plan"]["task"] == "comparison"


def test_minimal_market_snapshot_skips_ticker_and_unused_timeframes(monkeypatch):
    calls = {"price": 0, "timeframes": []}

    class FakeKlineService:
        def get_realtime_price(self, *args, **kwargs):
            calls["price"] += 1
            return {"price": 100}

        def get_kline(self, market, symbol, timeframe, limit, **kwargs):
            calls["timeframes"].append(timeframe)
            return [
                {"time": index, "open": 100, "high": 102, "low": 99, "close": 101, "volume": 1000}
                for index in range(80)
            ]

    monkeypatch.setattr(ai_chat, "KlineService", FakeKlineService)
    snapshot = _build_market_snapshot({
        "market": "Crypto",
        "symbol": "BTC/USDT",
        "snapshot_timeframes": ["1D"],
        "include_price": False,
        "force_price_refresh": False,
    })
    assert calls == {"price": 0, "timeframes": ["1D"]}
    assert snapshot["price"] is None
    assert list(snapshot["timeframes"]) == ["1D"]


def test_comparison_result_cache_avoids_repeated_exchange_calls(monkeypatch):
    cache = _MemoryTestCache()
    fetched = []
    requested = [
        {"market": "Crypto", "symbol": symbol, "name": symbol}
        for symbol in ("BTC/USDT", "ETH/USDT", "SOL/USDT")
    ]
    monkeypatch.setattr(ai_chat, "_comparison_cache_manager", lambda: cache)

    def fetch(candidate, snapshot_options=None):
        fetched.append(candidate["symbol"])
        return _fake_snapshot({"BTC/USDT": "TSLA", "ETH/USDT": "MSFT", "SOL/USDT": "NVDA"}[candidate["symbol"]]) | {
            "market": "Crypto",
            "symbol": candidate["symbol"],
        }

    monkeypatch.setattr(ai_chat, "_snapshot_for_candidate", fetch)
    options = {"snapshot_timeframes": ["1D"], "include_price": False, "force_price_refresh": False}
    first = _build_comparison_snapshots(requested, snapshot_options=options)
    second = _build_comparison_snapshots(requested, snapshot_options=options)

    assert [item["symbol"] for item in first] == ["BTC/USDT", "ETH/USDT", "SOL/USDT"]
    assert second == first
    assert sorted(fetched) == ["BTC/USDT", "ETH/USDT", "SOL/USDT"]
    assert cache.set_calls[0][1] == ai_chat.COMPARISON_CACHE_TTL_SECONDS


def test_research_tool_executions_are_persisted_for_observability():
    cursor = _RecordingCursor()
    context = {
        "research_context": {
            "tool_executions": [
                {
                    "tool": "market_data.lookup",
                    "status": "success",
                    "input": {"market": "USStock", "symbol": "MSFT"},
                    "output": _fake_snapshot("MSFT"),
                }
            ]
        }
    }
    assert _record_research_tool_calls(cursor, session_id=7, user_id=23, context=context) == 1
    sql, params = cursor.calls[0]
    assert "INSERT INTO qd_ai_copilot_tool_calls" in " ".join(sql.split())
    assert params[:4] == (7, 23, "market_data.lookup", "success")
    assert '"symbol":"MSFT"' in params[4]
