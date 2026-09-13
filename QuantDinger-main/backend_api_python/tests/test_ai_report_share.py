import json
from datetime import datetime, timezone

import pytest

from app.services import ai_report_share


class ShareCursor:
    def __init__(self, message_row=None, share_row=None):
        self.message_row = message_row
        self.share_row = share_row
        self.last_row = None
        self.calls = []

    def execute(self, sql, params=()):
        compact = " ".join(sql.split())
        self.calls.append((compact, params))
        if compact.startswith("SELECT report_json"):
            self.last_row = self.message_row
        elif compact.startswith("SELECT id, report_json"):
            self.last_row = self.share_row
        else:
            self.last_row = None

    def fetchone(self):
        return self.last_row


def test_create_report_share_stores_only_token_hash(monkeypatch):
    token = "A" * 43
    monkeypatch.setattr(ai_report_share.secrets, "token_urlsafe", lambda _: token)
    cursor = ShareCursor(message_row={
        "report_json": json.dumps({
            "schema_version": "professional_report_v1",
            "instrument": {"market": "USStock", "symbol": "AAPL"},
        }),
        "report_target_json": json.dumps({"market": "USStock", "symbol": "SHOULD_NOT_MATCH"}),
    })

    result = ai_report_share.create_report_share(
        cursor,
        owner_user_id=7,
        source_message_id=91,
        language="zh-CN",
    )

    insert = next(call for call in cursor.calls if call[0].startswith("INSERT INTO qd_professional_report_shares"))
    assert insert[1][0] == ai_report_share._token_hash(token)
    assert token not in insert[1]
    assert insert[1][1:3] == (7, 91)
    assert result == {"token": token, "path": f"/report/share/{token}"}


def test_create_report_share_rejects_missing_or_legacy_report():
    cursor = ShareCursor(message_row={"report_json": json.dumps({"decision": "BUY"})})
    with pytest.raises(LookupError, match="professional report"):
        ai_report_share.create_report_share(cursor, owner_user_id=7, source_message_id=91, language="en-US")


def test_public_share_lookup_returns_only_snapshot_metadata():
    token = "B" * 43
    cursor = ShareCursor(share_row={
        "id": 3,
        "report_json": json.dumps({"schema_version": "professional_report_v1", "report_id": "r-1"}),
        "report_target_json": json.dumps({"market": "Crypto", "symbol": "BTC/USDT"}),
        "language": "en-US",
        "created_at": datetime(2026, 9, 8, tzinfo=timezone.utc),
    })

    result = ai_report_share.get_public_report_share(cursor, token)

    select = next(call for call in cursor.calls if call[0].startswith("SELECT id, report_json"))
    assert select[1] == (ai_report_share._token_hash(token),)
    assert result["report"]["report_id"] == "r-1"
    assert result["target"]["symbol"] == "BTC/USDT"
    assert "owner_user_id" not in result
    assert "source_message_id" not in result
    assert any(call[0].startswith("UPDATE qd_professional_report_shares") for call in cursor.calls)


def test_public_share_rejects_malformed_token_without_database_lookup():
    cursor = ShareCursor()
    assert ai_report_share.get_public_report_share(cursor, "../not-a-token") is None
    assert cursor.calls == []
