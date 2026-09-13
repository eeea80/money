"""Initial market catalog synchronization tests."""

from __future__ import annotations


def test_initial_sync_starts_when_catalog_is_not_initialized(monkeypatch):
    from app.services import market_catalog_sync

    monkeypatch.setenv("MARKET_CATALOG_AUTO_SYNC", "true")
    monkeypatch.delenv("PYTHON_API_DEBUG", raising=False)
    monkeypatch.setattr(market_catalog_sync, "_market_catalog_is_initialized", lambda: False)
    monkeypatch.setattr(
        market_catalog_sync,
        "start_market_catalog_sync",
        lambda trigger: {"started": True, "run_id": 41, "trigger": trigger},
    )

    result = market_catalog_sync.start_market_catalog_sync_on_boot()

    assert result == {"started": True, "run_id": 41, "trigger": "startup"}


def test_initial_sync_skips_an_initialized_catalog(monkeypatch):
    from app.services import market_catalog_sync

    monkeypatch.setenv("MARKET_CATALOG_AUTO_SYNC", "true")
    monkeypatch.delenv("PYTHON_API_DEBUG", raising=False)
    monkeypatch.setattr(market_catalog_sync, "_market_catalog_is_initialized", lambda: True)
    monkeypatch.setattr(
        market_catalog_sync,
        "start_market_catalog_sync",
        lambda trigger: (_ for _ in ()).throw(AssertionError(f"unexpected sync: {trigger}")),
    )

    result = market_catalog_sync.start_market_catalog_sync_on_boot()

    assert result == {"started": False, "reason": "already_initialized"}


def test_initial_sync_respects_disabled_setting(monkeypatch):
    from app.services import market_catalog_sync

    monkeypatch.setenv("MARKET_CATALOG_AUTO_SYNC", "false")
    monkeypatch.setattr(
        market_catalog_sync,
        "_market_catalog_is_initialized",
        lambda: (_ for _ in ()).throw(AssertionError("database should not be queried")),
    )

    result = market_catalog_sync.start_market_catalog_sync_on_boot()

    assert result == {"started": False, "reason": "disabled"}
