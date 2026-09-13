"""Bootstrap-only tests for the MCP server.

We don't run an actual MCP loop here — that requires stdio handshakes — but
we do verify that:

  * Required env vars are validated up-front.
  * The transport selector resolves common spellings without side effects.
  * The HTTP-settings shim doesn't fail when the FastMCP `settings` shape
    differs across versions (we feed it a dummy object).
"""
from __future__ import annotations

import importlib
import sys
from types import SimpleNamespace

import pytest

# The MCP SDK is an optional dependency for unit testing this package.
# Skip cleanly if the consumer hasn't installed it (e.g. backend-only CI).
pytest.importorskip("mcp")


@pytest.fixture
def fresh_module(monkeypatch):
    """Reload the server module with the env preset so import-time checks pass."""
    monkeypatch.setenv("QUANTDINGER_BASE_URL", "http://localhost:8888")
    monkeypatch.setenv("QUANTDINGER_AGENT_TOKEN", "qd_agent_test_token")
    sys.modules.pop("quantdinger_mcp.server", None)
    # Make the package importable when the project hasn't been pip-installed.
    pkg_root = sys.modules[__name__].__file__
    import os
    src_dir = os.path.normpath(os.path.join(os.path.dirname(pkg_root), "..", "src"))
    if src_dir not in sys.path:
        sys.path.insert(0, src_dir)
    return importlib.import_module("quantdinger_mcp.server")


def test_transport_default_is_stdio(monkeypatch, fresh_module):
    monkeypatch.delenv("QUANTDINGER_MCP_TRANSPORT", raising=False)
    assert fresh_module._resolve_transport() == "stdio"


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("stdio", "stdio"),
        ("STDIO", "stdio"),
        ("sse", "sse"),
        ("streamable-http", "streamable-http"),
        ("http", "streamable-http"),
        ("streaming-http", "streamable-http"),
        ("STREAMABLE_HTTP", "streamable-http"),
    ],
)
def test_transport_aliases_resolve(monkeypatch, fresh_module, raw, expected):
    monkeypatch.setenv("QUANTDINGER_MCP_TRANSPORT", raw)
    assert fresh_module._resolve_transport() == expected


def test_transport_unknown_exits(monkeypatch, fresh_module):
    monkeypatch.setenv("QUANTDINGER_MCP_TRANSPORT", "bogus-transport")
    with pytest.raises(SystemExit):
        fresh_module._resolve_transport()


def test_apply_http_settings_without_error(monkeypatch, fresh_module):
    """The shim must tolerate missing/odd settings shapes — never crash."""
    monkeypatch.setenv("QUANTDINGER_MCP_HOST", "0.0.0.0")
    monkeypatch.setenv("QUANTDINGER_MCP_PORT", "7777")
    fake_settings = SimpleNamespace(host="127.0.0.1", port=8000)
    monkeypatch.setattr(fresh_module, "mcp", SimpleNamespace(settings=fake_settings))
    fresh_module._apply_http_settings_from_env()
    assert fake_settings.host == "0.0.0.0"
    assert fake_settings.port == 7777


def test_non_loopback_http_requires_auth(monkeypatch, fresh_module):
    monkeypatch.setattr(fresh_module.mcp.settings, "host", "0.0.0.0")
    monkeypatch.setattr(fresh_module, "MCP_AUTH_TOKEN", "")
    monkeypatch.delenv("QUANTDINGER_MCP_ALLOW_INSECURE_HTTP", raising=False)
    with pytest.raises(SystemExit):
        fresh_module._validate_network_security("streamable-http")


def test_non_loopback_http_accepts_distinct_strong_auth(monkeypatch, fresh_module):
    monkeypatch.setattr(fresh_module.mcp.settings, "host", "0.0.0.0")
    monkeypatch.setattr(fresh_module, "MCP_AUTH_TOKEN", "mcp_" + "x" * 40)
    monkeypatch.setattr(fresh_module, "AGENT_TOKEN", "qd_agent_different")
    monkeypatch.setattr(fresh_module, "MCP_PUBLIC_URL", "https://mcp.example.test")
    fresh_module._validate_network_security("streamable-http")


def test_non_loopback_authenticated_http_requires_https(monkeypatch, fresh_module):
    monkeypatch.setattr(fresh_module.mcp.settings, "host", "0.0.0.0")
    monkeypatch.setattr(fresh_module, "MCP_AUTH_TOKEN", "mcp_" + "x" * 40)
    monkeypatch.setattr(fresh_module, "AGENT_TOKEN", "qd_agent_different")
    monkeypatch.setattr(fresh_module, "MCP_PUBLIC_URL", "http://mcp.example.test")
    monkeypatch.delenv("QUANTDINGER_MCP_ALLOW_HTTP", raising=False)
    with pytest.raises(SystemExit):
        fresh_module._validate_network_security("streamable-http")


def test_invalid_numeric_env_uses_default(monkeypatch, fresh_module):
    monkeypatch.setenv("QUANTDINGER_TIMEOUT_S", "not-a-number")
    assert fresh_module._env_float("QUANTDINGER_TIMEOUT_S", 60.0) == 60.0
