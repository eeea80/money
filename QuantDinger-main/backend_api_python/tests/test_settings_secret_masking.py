def test_settings_values_masks_password_fields(client, monkeypatch):
    import app.routes.settings as settings_route
    import app.utils.auth as auth_mod

    monkeypatch.setattr(auth_mod, "verify_token", lambda token: {
        "sub": "admin",
        "user_id": 1,
        "role": "admin",
        "_verified_username": "admin",
        "_verified_user_role": "admin",
    })
    monkeypatch.setattr(settings_route, "read_env_file", lambda: {
        "CUSTOM_API_KEY": "real-secret",
        "LLM_PROVIDER": "custom",
    })
    monkeypatch.setattr(settings_route, "CONFIG_SCHEMA", {
        "ai": {
            "items": [
                {"key": "CUSTOM_API_KEY", "type": "password"},
                {"key": "LLM_PROVIDER", "type": "select"},
            ]
        }
    })

    resp = client.get("/api/settings/values", headers={"Authorization": "Bearer token"})
    assert resp.status_code == 200
    data = resp.get_json()["data"]["ai"]
    assert data["CUSTOM_API_KEY"] == ""
    assert data["CUSTOM_API_KEY_configured"] is True
    assert data["LLM_PROVIDER"] == "custom"


def test_settings_values_does_not_treat_password_default_as_configured(client, monkeypatch):
    import app.routes.settings as settings_route
    import app.utils.auth as auth_mod

    monkeypatch.setattr(auth_mod, "verify_token", lambda token: {
        "sub": "admin",
        "user_id": 1,
        "role": "admin",
        "_verified_username": "admin",
        "_verified_user_role": "admin",
    })
    monkeypatch.setattr(settings_route, "read_env_file", lambda: {})
    monkeypatch.setattr(settings_route, "CONFIG_SCHEMA", {
        "security": {
            "items": [
                {"key": "ADMIN_PASSWORD", "type": "password", "default": "123456"},
            ]
        }
    })

    resp = client.get("/api/settings/values", headers={"Authorization": "Bearer token"})
    assert resp.status_code == 200
    data = resp.get_json()["data"]["security"]
    assert data["ADMIN_PASSWORD"] == ""
    assert data["ADMIN_PASSWORD_configured"] is False


def test_secret_key_save_requires_restart_without_hot_reload(client, monkeypatch):
    import app.routes.settings as settings_route
    import app.utils.auth as auth_mod

    monkeypatch.setattr(auth_mod, "verify_token", lambda token: {
        "sub": "admin",
        "user_id": 1,
        "role": "admin",
        "_verified_username": "admin",
        "_verified_user_role": "admin",
    })
    monkeypatch.setattr(settings_route, "CONFIG_SCHEMA", {
        "auth": {
            "items": [
                {"key": "SECRET_KEY", "type": "password"},
            ]
        }
    })
    monkeypatch.setattr(
        settings_route,
        "read_env_file",
        lambda: {"SECRET_KEY": "current-persisted-secret"},
    )

    written = {}
    runtime_calls = []
    monkeypatch.setattr(
        settings_route,
        "write_env_file",
        lambda values: written.update(values) is None,
    )
    monkeypatch.setattr(
        settings_route,
        "clear_config_cache",
        lambda: runtime_calls.append("clear"),
    )
    monkeypatch.setattr(
        settings_route,
        "reload_runtime_env",
        lambda: runtime_calls.append("reload"),
    )
    monkeypatch.setattr(
        settings_route,
        "refresh_runtime_services",
        lambda: runtime_calls.append("refresh"),
    )

    resp = client.post(
        "/api/settings/save",
        headers={"Authorization": "Bearer token"},
        json={"auth": {"SECRET_KEY": "next-persisted-secret"}},
    )

    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload["code"] == 1
    assert written["SECRET_KEY"] == "next-persisted-secret"
    assert payload["data"]["requires_restart"] is True
    assert payload["data"]["restart_required_keys"] == ["SECRET_KEY"]
    assert payload["data"]["hot_reloaded"] is False
    assert payload["data"]["services_refreshed"] is False
    assert runtime_calls == []


def test_ai_setting_save_hot_reloads_without_restarting(client, monkeypatch):
    import app.routes.settings as settings_route
    import app.utils.auth as auth_mod

    monkeypatch.setattr(auth_mod, "verify_token", lambda token: {
        "sub": "admin",
        "user_id": 1,
        "role": "admin",
        "_verified_username": "admin",
        "_verified_user_role": "admin",
    })
    monkeypatch.setattr(settings_route, "CONFIG_SCHEMA", {
        "ai": {
            "items": [
                {"key": "LLM_PROVIDER", "type": "select"},
            ]
        }
    })
    monkeypatch.setattr(
        settings_route,
        "read_env_file",
        lambda: {"LLM_PROVIDER": "openrouter"},
    )
    monkeypatch.setattr(settings_route, "write_env_file", lambda values: True)

    runtime_calls = []
    monkeypatch.setattr(
        settings_route,
        "clear_config_cache",
        lambda: runtime_calls.append("clear"),
    )
    monkeypatch.setattr(
        settings_route,
        "reload_runtime_env",
        lambda: runtime_calls.append("reload"),
    )
    monkeypatch.setattr(
        settings_route,
        "refresh_runtime_services",
        lambda: runtime_calls.append("refresh"),
    )

    resp = client.post(
        "/api/settings/save",
        headers={"Authorization": "Bearer token"},
        json={"ai": {"LLM_PROVIDER": "deepseek"}},
    )

    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload["code"] == 1
    assert payload["data"]["requires_restart"] is False
    assert payload["data"]["restart_required_keys"] == []
    assert payload["data"]["hot_reloaded_keys"] == ["LLM_PROVIDER"]
    assert payload["data"]["hot_reloaded"] is True
    assert payload["data"]["services_refreshed"] is True
    assert runtime_calls == ["clear", "reload", "refresh"]
