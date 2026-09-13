"""Bootstrap admin password reminder policy."""

from contextlib import contextmanager
from unittest.mock import MagicMock

import app.services.user_service as user_service_module
from app.services.user_service import UserService


def test_builtin_default_password_still_requires_change(monkeypatch):
    svc = UserService()
    password_hash = svc.hash_password(UserService.BOOTSTRAP_DEFAULT_PASSWORD)

    monkeypatch.setenv("ADMIN_PASSWORD", UserService.BOOTSTRAP_DEFAULT_PASSWORD)

    assert svc._initial_password_state(password_hash, None) == "must_change"


def test_env_admin_password_change_syncs_db_instead_of_prompting(monkeypatch):
    svc = UserService()
    password_hash = svc.hash_password(UserService.BOOTSTRAP_DEFAULT_PASSWORD)

    monkeypatch.setenv("ADMIN_PASSWORD", "not-the-default")

    assert svc._initial_password_state(password_hash, None) == "sync_env_password"


def test_non_default_db_password_is_marked_changed(monkeypatch):
    svc = UserService()
    password_hash = svc.hash_password("already-custom-password")

    monkeypatch.setenv("ADMIN_PASSWORD", UserService.BOOTSTRAP_DEFAULT_PASSWORD)

    assert svc._initial_password_state(password_hash, None) == "mark_changed"


def test_backfilled_timestamp_does_not_hide_builtin_default_password(monkeypatch):
    svc = UserService()
    password_hash = svc.hash_password(UserService.BOOTSTRAP_DEFAULT_PASSWORD)

    monkeypatch.setenv("ADMIN_PASSWORD", UserService.BOOTSTRAP_DEFAULT_PASSWORD)

    assert svc._initial_password_state(password_hash, "2026-06-06 00:00:00") == "must_change"


def test_backfilled_timestamp_still_allows_configured_password_sync(monkeypatch):
    svc = UserService()
    password_hash = svc.hash_password(UserService.BOOTSTRAP_DEFAULT_PASSWORD)

    monkeypatch.setenv("ADMIN_PASSWORD", "configured-password")

    assert svc._initial_password_state(password_hash, "2026-06-06 00:00:00") == "sync_env_password"


def _mock_database(monkeypatch, rows):
    cursor = MagicMock()
    cursor.fetchone.side_effect = rows
    connection = MagicMock()
    connection.cursor.return_value = cursor

    @contextmanager
    def fake_connection():
        yield connection

    monkeypatch.setattr(user_service_module, "get_db_connection", fake_connection)
    return connection, cursor


def test_legacy_default_admin_is_replaced_with_configured_credentials(monkeypatch):
    monkeypatch.setenv("ADMIN_USER", "releaseadmin")
    monkeypatch.setenv("ADMIN_PASSWORD", "Secure #Password1")
    monkeypatch.setenv("ADMIN_EMAIL", "release@example.com")

    service = UserService()
    monkeypatch.setattr(
        service,
        "_password_hash_matches_bootstrap_default",
        lambda password_hash: password_hash == "legacy-default-hash",
    )
    monkeypatch.setattr(service, "hash_password", lambda password: "configured-hash")
    connection, cursor = _mock_database(
        monkeypatch,
        [
            {
                "id": 1,
                "username": "quantdinger",
                "password_hash": "legacy-default-hash",
                "email": "admin@example.com",
                "role": "admin",
                "status": "active",
            },
            None,
            None,
        ],
    )

    result = service.sync_bootstrap_admin_credentials_from_env()

    assert result == {
        "synced": True,
        "reason": "legacy_default_replaced",
        "user_id": 1,
        "username": "releaseadmin",
    }
    update_call = next(
        call for call in cursor.execute.call_args_list if "UPDATE qd_users" in call.args[0]
    )
    assert update_call.args[1] == (
        "releaseadmin",
        "configured-hash",
        "release@example.com",
        True,
        1,
    )
    connection.commit.assert_called_once()


def test_customized_admin_password_is_never_overwritten(monkeypatch):
    monkeypatch.setenv("ADMIN_USER", "releaseadmin")
    monkeypatch.setenv("ADMIN_PASSWORD", "SecurePassword1")

    service = UserService()
    monkeypatch.setattr(service, "_password_hash_matches_bootstrap_default", lambda _hash: False)
    connection, cursor = _mock_database(
        monkeypatch,
        [
            {
                "id": 1,
                "username": "quantdinger",
                "password_hash": "user-chosen-hash",
                "email": "owner@example.com",
                "role": "admin",
                "status": "active",
            }
        ],
    )

    result = service.sync_bootstrap_admin_credentials_from_env()

    assert result == {"synced": False, "reason": "bootstrap_password_was_customized"}
    assert not any("UPDATE qd_users" in call.args[0] for call in cursor.execute.call_args_list)
    connection.commit.assert_not_called()


def test_existing_target_username_is_never_promoted_or_overwritten(monkeypatch):
    monkeypatch.setenv("ADMIN_USER", "existinguser")
    monkeypatch.setenv("ADMIN_PASSWORD", "SecurePassword1")

    service = UserService()
    monkeypatch.setattr(
        service,
        "_password_hash_matches_bootstrap_default",
        lambda password_hash: password_hash == "legacy-default-hash",
    )
    connection, cursor = _mock_database(
        monkeypatch,
        [
            {
                "id": 1,
                "username": "quantdinger",
                "password_hash": "legacy-default-hash",
                "email": "admin@example.com",
                "role": "admin",
                "status": "active",
            },
            {"id": 3},
        ],
    )

    result = service.sync_bootstrap_admin_credentials_from_env()

    assert result == {"synced": False, "reason": "configured_username_in_use"}
    assert not any("UPDATE qd_users" in call.args[0] for call in cursor.execute.call_args_list)
    connection.commit.assert_not_called()
