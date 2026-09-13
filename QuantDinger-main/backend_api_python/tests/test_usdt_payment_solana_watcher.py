"""Regression tests for the Solana SPL-USDT watcher.

Specifically guards against the bug where ``getSignaturesForAddress(WALLET)``
returns nothing for a normal SPL transfer to the wallet's pre-existing
USDT ATA, because the wallet itself is not a participant in the tx — only
the ATA is. The fix resolves the ATA via ``getTokenAccountsByOwner`` and
queries signatures on the ATA, then matches by accountIndex instead of by
the ``owner`` field in pre/post token balances.

These tests stub :func:`solana._rpc` so no network is needed.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict, List

import pytest

from app.services.usdt_payment.watchers import solana


WALLET = "WaLLetPubKey00000000000000000000000000000000"
ATA = "AtaPubKey0000000000000000000000000000000000000"
SENDER_ATA = "SeNderAtaPubKey00000000000000000000000000000000"
USDT_MINT = solana._SPEC.contract_default
SIG = "Sig00000000000000000000000000000000000000000000000000000000000000000000000000000000"


def _normal_tx(amount_raw: int) -> Dict[str, Any]:
    """Build a parsed-tx blob that mirrors what mainnet RPC returns for a
    standard SPL transfer between two existing ATAs — i.e. the wallet
    (ATA owner) is NOT in accountKeys, only the ATA is.
    """
    return {
        "transaction": {
            "message": {
                "accountKeys": [
                    {"pubkey": SENDER_ATA, "signer": False, "writable": True},
                    {"pubkey": ATA, "signer": False, "writable": True},
                    {"pubkey": "SenderWallet111111111111111111111111111111111", "signer": True, "writable": True},
                    {"pubkey": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "signer": False, "writable": False},
                ],
            },
        },
        "meta": {
            "err": None,
            "preTokenBalances": [
                {"accountIndex": 0, "mint": USDT_MINT, "owner": "SenderWallet111111111111111111111111111111111",
                 "uiTokenAmount": {"amount": "1000000000"}},
                {"accountIndex": 1, "mint": USDT_MINT, "owner": WALLET,
                 "uiTokenAmount": {"amount": "0"}},
            ],
            "postTokenBalances": [
                {"accountIndex": 0, "mint": USDT_MINT, "owner": "SenderWallet111111111111111111111111111111111",
                 "uiTokenAmount": {"amount": str(1_000_000_000 - amount_raw)}},
                {"accountIndex": 1, "mint": USDT_MINT, "owner": WALLET,
                 "uiTokenAmount": {"amount": str(amount_raw)}},
            ],
        },
    }


def _make_rpc_stub(handlers: Dict[str, Any]):
    """Return an ``_rpc`` replacement that dispatches on ``method`` and
    falls back to ``{"result": None}`` for unmapped calls. Each handler
    is either a ready response dict or a callable ``(params) -> dict``.
    """
    def stub(method: str, params: List[Any]) -> Dict[str, Any]:
        handler = handlers.get(method)
        if handler is None:
            return {"result": None}
        if callable(handler):
            return handler(params)
        return handler

    return stub


def test_resolves_ata_and_matches_transfer_to_existing_ata(monkeypatch):
    """The critical regression: a normal SPL transfer to an already-
    existing ATA must be detected even though the wallet itself is not
    referenced by the transaction.
    """
    amount_raw = 19_991_234  # 19.991234 USDT
    amount = Decimal("19.991234")

    handlers = {
        "getTokenAccountsByOwner": {"result": {"value": [{"pubkey": ATA}]}},
        "getSignaturesForAddress": {"result": [{"signature": SIG, "blockTime": 1_700_000_000}]},
        "getTransaction": {"result": _normal_tx(amount_raw)},
    }
    monkeypatch.setattr(solana, "_rpc", _make_rpc_stub(handlers))

    tx, note = solana.find_incoming(WALLET, amount, None)

    assert tx is not None, f"watcher must match the transfer; got note: {note}"
    assert tx.tx_hash == SIG
    assert tx.value_smallest_unit == amount_raw
    assert tx.to_addr == WALLET
    assert tx.raw["watch_addr"] == ATA
    assert tx.raw["resolved_ata"] is True
    assert "ok scanned=1" in note


def test_wrong_amount_does_not_match(monkeypatch):
    amount_raw = 19_991_234
    handlers = {
        "getTokenAccountsByOwner": {"result": {"value": [{"pubkey": ATA}]}},
        "getSignaturesForAddress": {"result": [{"signature": SIG, "blockTime": 1_700_000_000}]},
        "getTransaction": {"result": _normal_tx(amount_raw + 100)},
    }
    monkeypatch.setattr(solana, "_rpc", _make_rpc_stub(handlers))

    tx, note = solana.find_incoming(WALLET, Decimal("19.991234"), None)
    assert tx is None
    assert "wrong_amount=1" in note


def test_falls_back_when_operator_supplied_the_ata_directly(monkeypatch):
    """If the operator entered the ATA in env instead of the wallet,
    ``getTokenAccountsByOwner`` returns an empty list (token accounts
    can't own other token accounts). The watcher should fall through
    to querying signatures on the supplied address directly.
    """
    amount_raw = 19_991_234

    def get_sigs(params):
        assert params[0] == ATA, "must query signatures on the supplied ATA"
        return {"result": [{"signature": SIG, "blockTime": 1_700_000_000}]}

    handlers = {
        "getTokenAccountsByOwner": {"result": {"value": []}},
        "getSignaturesForAddress": get_sigs,
        "getTransaction": {"result": _normal_tx(amount_raw)},
    }
    monkeypatch.setattr(solana, "_rpc", _make_rpc_stub(handlers))

    tx, note = solana.find_incoming(ATA, Decimal("19.991234"), None)
    assert tx is not None, f"watcher must match when operator supplies ATA directly: {note}"
    assert tx.value_smallest_unit == amount_raw
    assert tx.raw["resolved_ata"] is False


def test_empty_signatures_returns_clear_note(monkeypatch):
    handlers = {
        "getTokenAccountsByOwner": {"result": {"value": [{"pubkey": ATA}]}},
        "getSignaturesForAddress": {"result": []},
    }
    monkeypatch.setattr(solana, "_rpc", _make_rpc_stub(handlers))

    tx, note = solana.find_incoming(WALLET, Decimal("19.991234"), None)
    assert tx is None
    assert "empty_signatures" in note
    assert f"watch_addr={ATA}" in note
    assert "resolved_ata=True" in note


def test_alt_loaded_address_is_indexed_correctly(monkeypatch):
    """v0 transactions can reference accounts via ALT
    (``meta.loadedAddresses``). preTokenBalances indexes into the
    combined static+ALT table, so the watcher must concatenate them in
    that exact order. This guards against an off-by-one that would
    silently miss any ALT-using deposit (which is the default for
    aggregators / DEX-routed sends).
    """
    amount_raw = 19_991_234
    # ATA pushed into the loaded-addresses table; static accountKeys
    # only contain the sender + token program (2 entries), so the ATA's
    # accountIndex is 2.
    tx = {
        "transaction": {
            "message": {
                "accountKeys": [
                    {"pubkey": SENDER_ATA, "signer": False, "writable": True},
                    {"pubkey": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "signer": False, "writable": False},
                ],
            },
        },
        "meta": {
            "err": None,
            "loadedAddresses": {"writable": [ATA], "readonly": []},
            "preTokenBalances": [
                {"accountIndex": 2, "mint": USDT_MINT, "owner": WALLET,
                 "uiTokenAmount": {"amount": "0"}},
            ],
            "postTokenBalances": [
                {"accountIndex": 2, "mint": USDT_MINT, "owner": WALLET,
                 "uiTokenAmount": {"amount": str(amount_raw)}},
            ],
        },
    }

    handlers = {
        "getTokenAccountsByOwner": {"result": {"value": [{"pubkey": ATA}]}},
        "getSignaturesForAddress": {"result": [{"signature": SIG, "blockTime": 1_700_000_000}]},
        "getTransaction": {"result": tx},
    }
    monkeypatch.setattr(solana, "_rpc", _make_rpc_stub(handlers))

    matched, note = solana.find_incoming(WALLET, Decimal("19.991234"), None)
    assert matched is not None, f"ALT-loaded ATA must still match: {note}"
    assert matched.value_smallest_unit == amount_raw


def test_unrelated_tx_with_watch_addr_absent_is_skipped(monkeypatch):
    """A signature returned by RPC might not actually reference the
    watched address (rare but possible). The watcher should count it
    under ``key_missing`` and keep going, not crash.
    """
    handlers = {
        "getTokenAccountsByOwner": {"result": {"value": [{"pubkey": ATA}]}},
        "getSignaturesForAddress": {"result": [{"signature": SIG, "blockTime": 1_700_000_000}]},
        "getTransaction": {"result": {
            "transaction": {"message": {"accountKeys": [
                {"pubkey": "OtherKey1111111111111111111111111111111111111"},
            ]}},
            "meta": {"err": None, "preTokenBalances": [], "postTokenBalances": []},
        }},
    }
    monkeypatch.setattr(solana, "_rpc", _make_rpc_stub(handlers))

    tx, note = solana.find_incoming(WALLET, Decimal("19.991234"), None)
    assert tx is None
    assert "key_missing=1" in note


def test_failed_tx_is_skipped(monkeypatch):
    """Transactions with ``meta.err`` set didn't settle on-chain. They
    must not be matched even if the pre/post balances suggest a delta.
    """
    amount_raw = 19_991_234
    tx = _normal_tx(amount_raw)
    tx["meta"]["err"] = {"InstructionError": [0, "Custom"]}
    handlers = {
        "getTokenAccountsByOwner": {"result": {"value": [{"pubkey": ATA}]}},
        "getSignaturesForAddress": {"result": [{"signature": SIG, "blockTime": 1_700_000_000}]},
        "getTransaction": {"result": tx},
    }
    monkeypatch.setattr(solana, "_rpc", _make_rpc_stub(handlers))

    matched, _ = solana.find_incoming(WALLET, Decimal("19.991234"), None)
    assert matched is None


def test_rejects_bad_args():
    matched, note = solana.find_incoming("", Decimal("19"), None)
    assert matched is None and note == "bad_args"
    matched, note = solana.find_incoming(WALLET, Decimal("0"), None)
    assert matched is None and note == "bad_args"


def test_ata_resolve_network_failure_falls_back_to_wallet(monkeypatch):
    """If the RPC for getTokenAccountsByOwner errors out, the watcher
    should fall back to using the original address (defensive: this
    preserves the legacy behavior for operators whose RPC blocks
    getTokenAccountsByOwner). The fallback may not find the deposit
    but it must not crash and must surface a clear note.
    """
    import requests

    def stub(method: str, params: List[Any]) -> Dict[str, Any]:
        if method == "getTokenAccountsByOwner":
            raise requests.RequestException("simulated transport error")
        if method == "getSignaturesForAddress":
            assert params[0] == WALLET
            return {"result": []}
        return {"result": None}

    monkeypatch.setattr(solana, "_rpc", stub)

    tx, note = solana.find_incoming(WALLET, Decimal("19.991234"), None)
    assert tx is None
    assert "empty_signatures" in note
    assert "resolved_ata=False" in note
