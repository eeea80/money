"""Runtime refresh helpers after settings changes."""

from __future__ import annotations

import importlib
import os

from dotenv import load_dotenv

from app.services.settings.env_file import BACKEND_DIR
from app.utils.logger import get_logger

logger = get_logger(__name__)

_PROCESS_OWNED_ENV_KEYS = (
    # Security roots must remain identical for every worker until the process
    # group is restarted. Rotating either key in just the worker that handled a
    # settings request makes JWTs or encrypted credentials unreadable by the
    # other workers.
    "SECRET_KEY",
    "CREDENTIAL_ENCRYPTION_KEY",
    "QD_PROCESS_ROLE",
    "STRATEGY_COMMANDS_ENABLED",
)


def reload_runtime_env() -> None:
    """Reload .env files into the current process."""
    root_dir = os.path.dirname(BACKEND_DIR)
    process_owned = {
        key: os.environ[key]
        for key in _PROCESS_OWNED_ENV_KEYS
        if key in os.environ
    }

    # Load root first, then backend .env to keep backend file higher priority.
    load_dotenv(os.path.join(root_dir, ".env"), override=True)
    load_dotenv(os.path.join(BACKEND_DIR, ".env"), override=True)
    # Runtime topology belongs to the process supervisor (Docker/systemd), not
    # to the mutable settings file.
    os.environ.update(process_owned)
    try:
        registry = importlib.import_module("app.markets.registry")
        if hasattr(registry, "clear_runtime_env_cache"):
            registry.clear_runtime_env_cache()
    except Exception as exc:
        logger.warning("clear_runtime_env_cache skipped: %s", exc)


def refresh_runtime_services() -> None:
    """Reset singleton services so new env/config is picked up lazily."""
    try:
        search_mod = importlib.import_module("app.services.search")
        if hasattr(search_mod, "reset_search_service"):
            search_mod.reset_search_service()
    except Exception as exc:
        logger.warning("reset_search_service skipped: %s", exc)

    singleton_fields = [
        ("app.services.fast_analysis", "_fast_analysis_service"),
        ("app.services.billing_service", "_billing_service"),
        ("app.services.security_service", "_security_service"),
        ("app.services.mfa_service", "_mfa_service"),
        ("app.services.oauth_service", "_oauth_service"),
        ("app.services.user_service", "_user_service"),
        ("app.services.email_service", "_email_service"),
        ("app.services.community_service", "_community_service"),
        ("app.services.usdt_payment_service", "_svc"),
        ("app.services.usdt_payment_service", "_worker"),
        ("app.services.analysis_memory", "_memory_instance"),
    ]

    for module_name, field_name in singleton_fields:
        try:
            module = importlib.import_module(module_name)
            if hasattr(module, field_name):
                setattr(module, field_name, None)
        except Exception as exc:
            logger.warning("Singleton reset skipped: %s.%s: %s", module_name, field_name, exc)
