from pathlib import Path

from app.services.indicator_ai_workspace import (
    ASSET_TYPE,
    RECENT_MESSAGE_LIMIT,
    WORKSPACE_MESSAGE_LIMIT,
    classify_indicator_ai_intent,
    code_hash,
    _owned_indicator,
)


def test_indicator_ai_workspace_uses_bounded_indicator_scoped_memory():
    assert ASSET_TYPE == "indicator"
    assert RECENT_MESSAGE_LIMIT == 8
    assert WORKSPACE_MESSAGE_LIMIT >= RECENT_MESSAGE_LIMIT
    assert WORKSPACE_MESSAGE_LIMIT <= 100


def test_indicator_ai_candidate_hash_is_stable_and_content_sensitive():
    assert code_hash("alpha") == code_hash("alpha")
    assert code_hash("alpha") != code_hash("alpha\n")
    assert len(code_hash("alpha")) == 64


def test_indicator_ai_intent_routes_questions_without_creating_code_candidates():
    for prompt in (
        "解释一下这段指标逻辑",
        "为什么这个指标没有信号？",
        "如何优化这个指标？",
        "ATR 参数有什么作用",
        "Explain why this signal can repaint",
    ):
        assert classify_indicator_ai_intent(prompt) == "discussion"


def test_indicator_ai_intent_routes_only_explicit_changes_to_code_generation():
    for prompt in (
        "把 ATR 周期改成 20",
        "请减少重复信号并优化事件标记",
        "修复重复买入标记",
        "我让你直接在代码里改啊",
        "我让你改啊",
        "不要再解释，直接改代码",
        "按上面说的改吧",
        "Add a configurable RSI filter",
    ):
        assert classify_indicator_ai_intent(prompt) == "modify"

    for prompt in (
        "为什么不能直接改代码？",
        "你能直接改代码吗？",
    ):
        assert classify_indicator_ai_intent(prompt) == "discussion"

    assert classify_indicator_ai_intent("解释指标", "modify") == "modify"
    assert classify_indicator_ai_intent("优化配色", "discussion") == "discussion"


def test_indicator_ai_generation_keeps_candidate_separate_from_saved_code():
    route_path = Path(__file__).parents[1] / "app" / "routes" / "indicator.py"
    source = route_path.read_text(encoding="utf-8")
    assert 'intent=resolved_interaction_mode' in source
    assert 'billing_feature = "ai_copilot_chat" if resolved_interaction_mode == "discussion" else "ai_code_gen"' in source
    assert 'complete_indicator_ai_discussion_turn(' in source
    assert 'complete_indicator_ai_turn(' in source
    assert 'fit_messages_to_budget(messages, max_tokens=48000)' in source
    assert 'yield "data: " + _sse_json({"workspace": workspace_result})' in source

    workspace_path = Path(__file__).parents[1] / "app" / "services" / "indicator_ai_workspace.py"
    workspace_source = workspace_path.read_text(encoding="utf-8")
    assert '"reply_type": "discussion"' in workspace_source
    assert '"reply_type": "candidate"' in workspace_source
    assert 'candidate["base_code_matches_current"]' in workspace_source
    assert 'ValueError("change_is_not_pending")' in workspace_source


def test_indicator_ai_workspace_migration_has_all_separate_tables():
    migration = Path(__file__).parents[1] / "migrations" / "20260829_indicator_ai_workspace.sql"
    sql = migration.read_text(encoding="utf-8")
    for table in (
        "qd_ai_workspace_threads",
        "qd_ai_workspace_messages",
        "qd_ai_workspace_changes",
    ):
        assert f"CREATE TABLE IF NOT EXISTS {table}" in sql
    assert "qd_indicator_code_versions" not in sql


def test_hidden_purchased_indicator_is_rejected_before_ai_workspace_access():
    class Cursor:
        def execute(self, *_args, **_kwargs):
            return None

        def fetchone(self):
            return {
                "id": 91,
                "user_id": 7,
                "name": "Protected indicator",
                "description": "",
                "code": "secret",
                "is_buy": 1,
                "is_encrypted": 1,
            }

    import pytest

    with pytest.raises(PermissionError, match="indicator_source_hidden"):
        _owned_indicator(Cursor(), 7, 91)
