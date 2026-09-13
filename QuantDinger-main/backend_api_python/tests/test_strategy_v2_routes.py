from app.routes import backtest_center


def test_v2_source_prefers_script_source_code(monkeypatch):
    class SourceService:
        @staticmethod
        def get_source(source_id, user_id):
            assert source_id == 104
            assert user_id == 7
            return {"name": "V2", "code": "def initialize(context):\n    pass"}

    monkeypatch.setattr(backtest_center, "get_script_source_service", lambda: SourceService())
    code, source_id, strategy_id, name = backtest_center._source({"sourceId": 104}, 7)

    assert code.startswith("def initialize")
    assert source_id == 104
    assert strategy_id is None
    assert name == "V2"
