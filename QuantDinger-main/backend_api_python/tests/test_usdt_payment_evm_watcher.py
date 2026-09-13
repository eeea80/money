"""Tests for the EVM (BEP20/ERC20) USDT watcher endpoint resolution and
the public-RPC fallback path.

Two surface areas are covered:

1. Endpoint resolution: which URL + key combo gets picked given a
   particular ``.env``. Since the Aug 2024 Etherscan V2 migration,
   BscScan and Etherscan share one multi-chain endpoint
   (``api.etherscan.io/v2/api?chainid=<id>``). The watcher has to:
     - default to V2 when no legacy host is pinned,
     - inject ``chainid`` only on V2,
     - still respect legacy v1 hosts when an admin explicitly pinned
       them (``BSCSCAN_BASE_URL=https://api.bscscan.com``).

2. RPC fallback: when the V2 free plan blocks BSC (or any other
   non-Ethereum chain), the watcher transparently switches to
   ``eth_getLogs`` against a public RPC. Tested via mocked HTTP so
   nothing leaves the unit test process.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, List
from unittest.mock import patch

from app.services.usdt_payment.watchers import evm
from app.services.usdt_payment.watchers.evm import (
    _address_to_topic,
    _is_paid_tier_error,
    _prefer_rpc,
    _resolve_endpoint,
    _rpc_endpoints,
)


# ---------------------------------------------------------------------------
# Endpoint resolution — V2 is the default
# ---------------------------------------------------------------------------


def _clear_env(monkeypatch):
    for var in (
        "ETHERSCAN_API_KEY",
        "ETHERSCAN_V2_BASE_URL",
        "ETHERSCAN_BASE_URL",
        "BSCSCAN_API_KEY",
        "BSCSCAN_BASE_URL",
    ):
        monkeypatch.delenv(var, raising=False)


def test_bep20_defaults_to_v2_unified_endpoint(monkeypatch):
    _clear_env(monkeypatch)
    monkeypatch.setenv("ETHERSCAN_API_KEY", "v2-key")

    url, key, is_v2 = _resolve_endpoint("BEP20")
    assert url == "https://api.etherscan.io/v2/api"
    assert key == "v2-key"
    assert is_v2 is True


def test_erc20_defaults_to_v2_unified_endpoint(monkeypatch):
    _clear_env(monkeypatch)
    monkeypatch.setenv("ETHERSCAN_API_KEY", "v2-key")

    url, key, is_v2 = _resolve_endpoint("ERC20")
    assert url == "https://api.etherscan.io/v2/api"
    assert key == "v2-key"
    assert is_v2 is True


def test_v2_base_url_override_is_honored(monkeypatch):
    _clear_env(monkeypatch)
    monkeypatch.setenv("ETHERSCAN_API_KEY", "v2-key")
    monkeypatch.setenv("ETHERSCAN_V2_BASE_URL", "https://my.proxy.example.com/v2/api")

    url, key, is_v2 = _resolve_endpoint("BEP20")
    assert url == "https://my.proxy.example.com/v2/api"
    assert is_v2 is True


def test_v2_base_url_without_api_suffix_is_normalized(monkeypatch):
    """Operators sometimes set the base without ``/api`` — we append it."""
    _clear_env(monkeypatch)
    monkeypatch.setenv("ETHERSCAN_API_KEY", "v2-key")
    monkeypatch.setenv("ETHERSCAN_V2_BASE_URL", "https://api.etherscan.io/v2")

    url, _, is_v2 = _resolve_endpoint("BEP20")
    assert url == "https://api.etherscan.io/v2/api"
    assert is_v2 is True


# ---------------------------------------------------------------------------
# Legacy v1 fallbacks
# ---------------------------------------------------------------------------


def test_legacy_bscscan_v1_host_forces_v1_mode(monkeypatch):
    """If admin pinned the old v1 host (no `/v2` in the URL) we honor it."""
    _clear_env(monkeypatch)
    monkeypatch.setenv("BSCSCAN_BASE_URL", "https://api.bscscan.com")
    monkeypatch.setenv("BSCSCAN_API_KEY", "v1-bsc-key")

    url, key, is_v2 = _resolve_endpoint("BEP20")
    assert url == "https://api.bscscan.com/api"
    assert key == "v1-bsc-key"
    assert is_v2 is False


def test_legacy_etherscan_v1_host_forces_v1_mode(monkeypatch):
    _clear_env(monkeypatch)
    monkeypatch.setenv("ETHERSCAN_BASE_URL", "https://api.etherscan.io")
    monkeypatch.setenv("ETHERSCAN_API_KEY", "v1-eth-key")

    url, key, is_v2 = _resolve_endpoint("ERC20")
    assert url == "https://api.etherscan.io/api"
    assert key == "v1-eth-key"
    assert is_v2 is False


def test_legacy_per_chain_key_used_when_v2_key_missing(monkeypatch):
    """Pre-migration .env files only set BSCSCAN_API_KEY. The watcher
    should still pick that up and use it on the V2 endpoint (BscScan
    and Etherscan accept each other's keys via the unified plan)."""
    _clear_env(monkeypatch)
    monkeypatch.setenv("BSCSCAN_API_KEY", "legacy-bsc-key")

    url, key, is_v2 = _resolve_endpoint("BEP20")
    assert url == "https://api.etherscan.io/v2/api"
    assert key == "legacy-bsc-key"
    assert is_v2 is True


def test_v2_key_wins_over_legacy_when_both_set(monkeypatch):
    _clear_env(monkeypatch)
    monkeypatch.setenv("ETHERSCAN_API_KEY", "v2-key")
    monkeypatch.setenv("BSCSCAN_API_KEY", "v1-key")

    _, key, is_v2 = _resolve_endpoint("BEP20")
    assert key == "v2-key"
    assert is_v2 is True


def test_legacy_base_pointing_at_v2_url_still_treated_as_v2(monkeypatch):
    """If admin accidentally points BSCSCAN_BASE_URL at the V2 endpoint
    we should NOT downgrade to v1 mode (which would skip the chainid
    param and break the request)."""
    _clear_env(monkeypatch)
    monkeypatch.setenv("BSCSCAN_BASE_URL", "https://api.etherscan.io/v2/api")
    monkeypatch.setenv("ETHERSCAN_API_KEY", "v2-key")

    _, _, is_v2 = _resolve_endpoint("BEP20")
    assert is_v2 is True


# ---------------------------------------------------------------------------
# No key configured — must still resolve a URL (so we get a clear empty_result
# downstream instead of a None blowup)
# ---------------------------------------------------------------------------


def test_no_key_anywhere_still_returns_v2_url(monkeypatch):
    _clear_env(monkeypatch)
    url, key, is_v2 = _resolve_endpoint("BEP20")
    assert url == "https://api.etherscan.io/v2/api"
    assert key == ""
    assert is_v2 is True


# ---------------------------------------------------------------------------
# Paid-tier error detection (drives the RPC fallback decision)
# ---------------------------------------------------------------------------


def test_paid_tier_detected_for_v2_free_plan_block():
    """The exact wording Etherscan returns for free BSC keys today."""
    assert _is_paid_tier_error(
        "NOTOK",
        "Free API access is not supported for this chain. "
        "Please upgrade your api plan for full chain coverage.",
    ) is True


def test_paid_tier_detected_for_legacy_v1_deprecation():
    """Old v1 hosts now reject everything with this banner."""
    assert _is_paid_tier_error(
        "NOTOK",
        "You are using a deprecated V1 endpoint, switch to Etherscan API V2",
    ) is True


def test_paid_tier_not_triggered_by_invalid_key():
    """A plain invalid-key response should NOT trigger the fallback —
    we want operators to fix the key, not silently degrade to RPC.
    """
    assert _is_paid_tier_error("NOTOK", "Invalid API Key") is False
    assert _is_paid_tier_error("NOTOK", "Max rate limit reached") is False


# ---------------------------------------------------------------------------
# RPC endpoint resolution
# ---------------------------------------------------------------------------


def _clear_rpc_env(monkeypatch):
    for var in ("BSC_RPC_URLS", "ETH_RPC_URLS"):
        monkeypatch.delenv(var, raising=False)


def test_rpc_endpoints_uses_curated_defaults(monkeypatch):
    _clear_rpc_env(monkeypatch)
    urls = _rpc_endpoints("BEP20")
    assert urls, "must have curated public defaults baked in"
    assert any("bsc" in u.lower() for u in urls)


def test_rpc_endpoints_honors_env_override(monkeypatch):
    _clear_rpc_env(monkeypatch)
    monkeypatch.setenv(
        "BSC_RPC_URLS",
        "https://my-rpc-1.example.com/,https://my-rpc-2.example.com/",
    )
    urls = _rpc_endpoints("BEP20")
    # trailing slashes are stripped so URL composition stays clean
    assert urls == ["https://my-rpc-1.example.com", "https://my-rpc-2.example.com"]


def test_rpc_endpoints_empty_env_falls_back_to_defaults(monkeypatch):
    """Whitespace-only env override must NOT silently produce an empty
    list (would break the fallback)."""
    _clear_rpc_env(monkeypatch)
    monkeypatch.setenv("BSC_RPC_URLS", "   ")
    urls = _rpc_endpoints("BEP20")
    assert urls, "blank env must NOT erase the defaults"


# ---------------------------------------------------------------------------
# Address -> 32-byte topic (eth_getLogs filter)
# ---------------------------------------------------------------------------


def test_address_to_topic_pads_to_32_bytes():
    topic = _address_to_topic("0xf9d6BF52840DE6D40E4A4c7237B45A89E8441bF1")
    # exact 32-byte 0x-prefixed hex string
    assert topic == "0x000000000000000000000000f9d6bf52840de6d40e4a4c7237b45a89e8441bf1"
    assert len(topic) == 66
    # case-folded so it compares cleanly against on-chain payloads
    assert topic.lower() == topic


def test_address_to_topic_accepts_unprefixed():
    """Belt-and-suspenders: addresses sometimes arrive without the 0x."""
    topic = _address_to_topic("f9d6BF52840DE6D40E4A4c7237B45A89E8441bF1")
    assert topic == "0x000000000000000000000000f9d6bf52840de6d40e4a4c7237b45a89e8441bf1"


# ---------------------------------------------------------------------------
# End-to-end fallback: V2 blocks BSC → RPC finds the payment
# ---------------------------------------------------------------------------


class _StubResponse:
    """Stand-in for ``requests.Response`` good enough for the watcher."""

    def __init__(self, payload: Dict[str, Any], status_code: int = 200):
        self._payload = payload
        self.status_code = status_code
        self.text = str(payload)

    def json(self) -> Dict[str, Any]:
        return self._payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


def _bep20_target_value(amount: Decimal) -> int:
    return int((amount * (Decimal(10) ** 18)).to_integral_value())


def test_prefer_rpc_default_per_chain(monkeypatch):
    """BEP20 defaults to RPC-only (Etherscan free plan doesn't cover BSC);
    ERC20 defaults to explorer-first (free plan covers ETH)."""
    _clear_env(monkeypatch)
    _clear_rpc_env(monkeypatch)
    monkeypatch.delenv("BEP20_PREFER_EXPLORER", raising=False)
    monkeypatch.delenv("ERC20_PREFER_EXPLORER", raising=False)
    assert _prefer_rpc("BEP20") is True
    assert _prefer_rpc("ERC20") is False


def test_prefer_rpc_env_override_for_bep20(monkeypatch):
    """Operators on Etherscan paid plan can flip BEP20 back to explorer."""
    _clear_env(monkeypatch)
    monkeypatch.setenv("BEP20_PREFER_EXPLORER", "true")
    assert _prefer_rpc("BEP20") is False
    monkeypatch.setenv("BEP20_PREFER_EXPLORER", "false")
    assert _prefer_rpc("BEP20") is True


def test_bep20_goes_straight_to_rpc_by_default(monkeypatch):
    """The production path post-2025: BEP20 reconciliation never touches
    Etherscan because its free tier blocks BSC. Even when a key IS set,
    the explorer must not be called — wasted round-trip + noisy logs."""
    _clear_env(monkeypatch)
    _clear_rpc_env(monkeypatch)
    monkeypatch.delenv("BEP20_PREFER_EXPLORER", raising=False)
    # Even with a key configured, BEP20 still goes RPC-only.
    monkeypatch.setenv("ETHERSCAN_API_KEY", "some-key")
    monkeypatch.setenv("USDT_BEP20_ADDRESS", "0xf9d6bf52840de6d40e4a4c7237b45a89e8441bf1")

    address = "0xf9d6bf52840de6d40e4a4c7237b45a89e8441bf1"
    amount = Decimal("20.003362")
    target = _bep20_target_value(amount)
    contract = "0x55d398326f99059fF775485246999027B3197955".lower()
    expected_tx = "0xabc123def4567890abc123def4567890abc123def4567890abc123def4567890"

    def fake_get(*_a, **_kw):
        raise AssertionError(
            "explorer must NOT be called for BEP20 by default — see _PREFER_RPC_DEFAULT"
        )

    rpc_calls: List[Dict[str, Any]] = []

    def fake_post(url: str, json: Dict[str, Any], timeout: float) -> _StubResponse:
        rpc_calls.append({"url": url, "payload": json})
        method = json["method"]
        if method == "eth_blockNumber":
            return _StubResponse({"jsonrpc": "2.0", "id": 1, "result": hex(50_000_000)})
        if method == "eth_getLogs":
            flt = json["params"][0]
            assert flt["address"] == contract
            assert flt["topics"][0] == evm._TRANSFER_TOPIC
            assert flt["topics"][2] == _address_to_topic(address)
            return _StubResponse(
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "result": [
                        {
                            "transactionHash": expected_tx,
                            "topics": [
                                evm._TRANSFER_TOPIC,
                                "0x" + "0" * 24 + "1" * 40,
                                _address_to_topic(address),
                            ],
                            "data": hex(target),
                            "blockNumber": hex(49_999_900),
                        }
                    ],
                }
            )
        raise AssertionError(f"unexpected RPC method {method!r}")

    with patch("requests.get", side_effect=fake_get), patch(
        "requests.post", side_effect=fake_post
    ):
        finder = evm._make_finder("BEP20")
        tx, note = finder(address, amount, datetime.now(timezone.utc) - timedelta(minutes=5))

    assert tx is not None, f"RPC scan failed: {note}"
    assert tx.tx_hash == expected_tx
    assert tx.value_smallest_unit == target
    assert tx.block_timestamp_ms == 0, (
        "eth_getLogs doesn't return block timestamps; the watcher must "
        "rely on the service-side paid_at gate instead of forging one"
    )
    assert "rpc_ok" in note
    methods = [c["payload"]["method"] for c in rpc_calls]
    assert methods == ["eth_blockNumber", "eth_getLogs"]


def test_bep20_uses_explorer_when_admin_opts_in(monkeypatch):
    """``BEP20_PREFER_EXPLORER=true`` should re-enable the V2 path for
    admins who upgrade to a paid Etherscan plan."""
    _clear_env(monkeypatch)
    _clear_rpc_env(monkeypatch)
    monkeypatch.setenv("ETHERSCAN_API_KEY", "paid-plan-key")
    monkeypatch.setenv("BEP20_PREFER_EXPLORER", "true")

    address = "0xf9d6bf52840de6d40e4a4c7237b45a89e8441bf1"
    amount = Decimal("20.003362")
    target = _bep20_target_value(amount)
    expected_tx = "0xpaid123"

    def fake_get(url: str, params: Dict[str, Any], timeout: float) -> _StubResponse:
        assert "v2/api" in url
        assert params.get("chainid") == 56
        return _StubResponse(
            {
                "status": "1",
                "message": "OK",
                "result": [
                    {
                        "hash": expected_tx,
                        "to": address,
                        "from": "0xfromaddr",
                        "value": str(target),
                        "timeStamp": str(int(datetime.now(timezone.utc).timestamp())),
                    }
                ],
            }
        )

    def fake_post(*_a, **_kw):
        raise AssertionError("RPC must NOT be hit when explorer succeeds")

    with patch("requests.get", side_effect=fake_get), patch(
        "requests.post", side_effect=fake_post
    ):
        finder = evm._make_finder("BEP20")
        tx, note = finder(address, amount, datetime.now(timezone.utc) - timedelta(minutes=1))

    assert tx is not None, note
    assert tx.tx_hash == expected_tx


def test_erc20_falls_back_to_rpc_when_v2_returns_error(monkeypatch):
    """ERC20 stays on explorer-first by default, but transient explorer
    errors must transparently degrade to RPC so reconciliation isn't
    blocked by an Etherscan outage."""
    _clear_env(monkeypatch)
    _clear_rpc_env(monkeypatch)
    monkeypatch.setenv("ETHERSCAN_API_KEY", "free-plan-key")
    monkeypatch.setenv("USDT_ERC20_ADDRESS", "0xf9d6bf52840de6d40e4a4c7237b45a89e8441bf1")

    address = "0xf9d6bf52840de6d40e4a4c7237b45a89e8441bf1"
    amount = Decimal("19.991234")
    # USDT on Ethereum is 6 decimals (not 18).
    target = int((amount * (Decimal(10) ** 6)).to_integral_value())
    expected_tx = "0xfromrpc456"

    v2_reject = _StubResponse(
        {
            "status": "0",
            "message": "NOTOK",
            "result": "Free API access is not supported for this chain.",
        }
    )

    def fake_get(url: str, params: Dict[str, Any], timeout: float) -> _StubResponse:
        assert "v2/api" in url
        assert params.get("chainid") == 1
        return v2_reject

    def fake_post(url: str, json: Dict[str, Any], timeout: float) -> _StubResponse:
        method = json["method"]
        if method == "eth_blockNumber":
            return _StubResponse({"result": hex(20_000_000)})
        if method == "eth_getLogs":
            return _StubResponse(
                {
                    "result": [
                        {
                            "transactionHash": expected_tx,
                            "topics": [
                                evm._TRANSFER_TOPIC,
                                "0x" + "0" * 24 + "1" * 40,
                                _address_to_topic(address),
                            ],
                            "data": hex(target),
                        }
                    ]
                }
            )
        raise AssertionError(f"unexpected method {method!r}")

    with patch("requests.get", side_effect=fake_get), patch(
        "requests.post", side_effect=fake_post
    ):
        finder = evm._make_finder("ERC20")
        tx, note = finder(address, amount, datetime.now(timezone.utc) - timedelta(minutes=5))

    assert tx is not None, note
    assert tx.tx_hash == expected_tx
    assert "rpc_ok" in note


def test_finder_keeps_explorer_result_when_explorer_returns_negative(monkeypatch):
    """For ERC20 (explorer-first), a definitive "no match" from the
    explorer is authoritative — we must NOT then double-check via RPC
    and risk picking up an unrelated transfer."""
    _clear_env(monkeypatch)
    _clear_rpc_env(monkeypatch)
    monkeypatch.setenv("ETHERSCAN_API_KEY", "paid-plan-key")

    def fake_get(*_a, **_kw):
        return _StubResponse({"status": "0", "message": "No transactions found", "result": []})

    def fake_post(*_a, **_kw):
        raise AssertionError(
            "RPC must NOT be hit when explorer gave a definitive answer"
        )

    with patch("requests.get", side_effect=fake_get), patch(
        "requests.post", side_effect=fake_post
    ):
        finder = evm._make_finder("ERC20")
        tx, note = finder(
            "0xf9d6bf52840de6d40e4a4c7237b45a89e8441bf1",
            Decimal("19.991234"),
            datetime.now(timezone.utc),
        )

    assert tx is None
    assert "empty_result" in note
