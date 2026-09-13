"""Solana SPL-USDT watcher (raw JSON-RPC, no extra dependency).

Strategy:
  1. Resolve the owner's USDT-mint **Associated Token Account (ATA)** with
     ``getTokenAccountsByOwner(wallet, {mint: USDT_MINT})``. This is the key
     correctness step: SPL transfers to an already-existing ATA do **not**
     reference the receiving wallet in ``accountKeys`` (only the ATA does),
     so ``getSignaturesForAddress(WALLET)`` returns no matching signatures
     and the reconciler reports ``no_match empty_signatures`` even though
     the funds arrived. Solana's RPC layer indexes signatures by
     account-key membership; the wallet only shows up in the "create ATA"
     instruction of the very first incoming transfer, never in subsequent
     ones. Querying the ATA fixes this.
  2. ``getSignaturesForAddress(watch_addr, limit=25)`` against the resolved
     ATA (or against the operator-supplied address as-is when it already
     looks like a token account / when ATA resolution fails).
  3. For each signature, ``getTransaction(sig, encoding=jsonParsed)`` and
     compute ``post - pre`` raw token amount **at the accountIndex of the
     watched account** in the combined account-key table (static keys +
     ALT-loaded writable + ALT-loaded readonly). Matching by accountIndex
     instead of by ``owner == wallet`` is more robust because the JSON-RPC
     ``owner`` field is only populated for the original Token program in
     some node implementations; the accountIndex link is canonical.

This avoids hard-pinning solders / solana-py for the backend; we only need
plain HTTP. The Solana mainnet public endpoint is fine for the volumes a
typical SaaS sees (a few orders per minute) but operators can swap in
Helius / QuickNode by setting ``SOLANA_RPC_URL``.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

import requests

from app.utils.logger import get_logger

from ..chains import CHAIN_SPECS
from .base import IncomingTransfer, WatcherResult, register


logger = get_logger(__name__)

_SPEC = CHAIN_SPECS["SOL"]


def _rpc_url() -> str:
    return (os.getenv("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com") or "").strip().rstrip("/")


def _usdt_mint() -> str:
    return (os.getenv(_SPEC.contract_env, "") or "").strip() or _SPEC.contract_default


def _parse_created_at(raw: Any) -> Optional[datetime]:
    if raw is None:
        return None
    if isinstance(raw, datetime):
        return raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)
    if isinstance(raw, str):
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


def _rpc(method: str, params: List[Any]) -> Dict[str, Any]:
    payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    resp = requests.post(_rpc_url(), json=payload, timeout=15)
    resp.raise_for_status()
    return resp.json() or {}


def _resolve_usdt_ata(wallet: str, mint: str) -> Optional[str]:
    """Return the USDT-mint Associated Token Account pubkey owned by
    ``wallet``, or ``None`` if the wallet has no such account yet (e.g.
    fresh wallet that's never received USDT) or if ``wallet`` is actually
    already a token account (in which case ``getTokenAccountsByOwner``
    returns an empty list — token accounts can't own other token accounts).

    Errors are swallowed and turned into ``None`` so the caller can fall
    back to treating the input address as a signature query target;
    that fallback also covers the "operator manually entered the ATA"
    case.
    """
    try:
        resp = _rpc(
            "getTokenAccountsByOwner",
            [wallet, {"mint": mint}, {"encoding": "jsonParsed"}],
        )
    except requests.RequestException as exc:
        logger.warning(
            "USDT SOL ATA-resolve network error wallet=%s: %s",
            wallet, exc,
        )
        return None
    err = resp.get("error")
    if err:
        logger.info("USDT SOL getTokenAccountsByOwner error wallet=%s: %s", wallet, err)
        return None
    accounts = ((resp.get("result") or {}).get("value")) or []
    if not accounts:
        return None
    pubkey = (accounts[0] or {}).get("pubkey") or ""
    return pubkey or None


def _extract_account_keys(tx: Dict[str, Any]) -> List[str]:
    """Return the canonical account-index → pubkey table for a parsed tx.

    Solana v0 transactions can reference accounts via Address Lookup
    Tables, whose pubkeys appear in ``meta.loadedAddresses`` *after* the
    static ``transaction.message.accountKeys`` block. ``preTokenBalances``
    / ``postTokenBalances`` index into the **combined** table, so we have
    to concatenate them in this exact order to keep accountIndex math
    correct on ALT-using transactions.
    """
    keys: List[str] = []
    txi = tx.get("transaction") or {}
    msg = (txi.get("message") or {}) if isinstance(txi, dict) else {}
    for entry in msg.get("accountKeys") or []:
        if isinstance(entry, dict):
            pk = entry.get("pubkey")
            if pk:
                keys.append(str(pk))
        elif isinstance(entry, str):
            keys.append(entry)
    meta = tx.get("meta") or {}
    loaded = meta.get("loadedAddresses") or {}
    for entry in loaded.get("writable") or []:
        keys.append(str(entry))
    for entry in loaded.get("readonly") or []:
        keys.append(str(entry))
    return keys


def _delta_for_watched_account(
    pre: List[Dict[str, Any]],
    post: List[Dict[str, Any]],
    *,
    mint: str,
    watched_account_index: int,
) -> int:
    """Return ``post - pre`` raw token amount at ``watched_account_index``
    for the given mint. Entries that don't match the mint are skipped —
    this guards against the rare case of an ALT slot at the same index
    being reused for a different mint inside one tx.
    """
    def amount_at(arr: List[Dict[str, Any]]) -> int:
        for entry in arr or []:
            try:
                if int(entry.get("accountIndex")) != watched_account_index:
                    continue
                if (entry.get("mint") or "").strip() != mint:
                    continue
                ui = entry.get("uiTokenAmount") or {}
                return int(ui.get("amount") or 0)
            except (TypeError, ValueError):
                continue
        return 0

    return amount_at(post) - amount_at(pre)


def find_incoming(address: str, amount: Decimal, created_at: Optional[datetime], token_meta=None) -> WatcherResult:
    address = (address or "").strip()
    if not address or amount <= 0:
        return None, "bad_args"

    token_meta = token_meta or {}
    mint = token_meta.get("contract") or _usdt_mint()
    decimals = int(token_meta.get("decimals") or _SPEC.decimals)
    target = int((amount * Decimal(10 ** decimals)).to_integral_value())
    ct = _parse_created_at(created_at)
    min_ts = int(ct.timestamp()) - 60 if ct else None

    # Step 1: resolve the watched account.
    #
    # The configured ``USDT_SOL_ADDRESS`` is documented as a wallet
    # address (matches what env.example tells operators to enter). For
    # SPL transfers to an existing ATA, the wallet itself is **not** in
    # the tx's accountKeys, so ``getSignaturesForAddress(wallet)`` would
    # miss every normal deposit and the order would never leave
    # ``pending``. We resolve the wallet's USDT ATA and query that
    # instead.
    #
    # If the operator manually entered the ATA in env (unusual but
    # valid), ``getTokenAccountsByOwner`` returns an empty list because
    # token accounts can't own other token accounts. In that case we
    # fall through to using the original address — which is now the ATA
    # we wanted anyway.
    ata = _resolve_usdt_ata(address, mint)
    watch_addr = ata or address
    resolved_via_ata = ata is not None

    try:
        sigs_resp = _rpc("getSignaturesForAddress", [watch_addr, {"limit": 25}])
    except requests.RequestException as exc:
        return None, f"solana_rpc_error:{type(exc).__name__}:{exc}"

    err = sigs_resp.get("error")
    if err:
        return None, (
            f"solana_rpc_error:{err.get('code')}:{err.get('message')!r} "
            f"watch_addr={watch_addr} resolved_ata={resolved_via_ata}"
        )
    signatures = sigs_resp.get("result") or []
    if not signatures:
        return None, (
            f"no_match empty_signatures watch_addr={watch_addr} "
            f"resolved_ata={resolved_via_ata}"
        )

    scanned = 0
    before_order = wrong_amount = parse_err = key_missing = 0

    for sig_entry in signatures:
        try:
            sig = str(sig_entry.get("signature") or "")
            block_time = int(sig_entry.get("blockTime") or 0)
            if not sig:
                parse_err += 1
                continue
            if min_ts is not None and block_time and block_time < min_ts:
                before_order += 1
                continue
            tx_resp = _rpc("getTransaction", [sig, {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 0}])
            tx = (tx_resp.get("result") or {})
            meta = tx.get("meta") or {}
            if meta.get("err"):
                continue
            account_keys = _extract_account_keys(tx)
            try:
                target_idx = account_keys.index(watch_addr)
            except ValueError:
                # watch_addr isn't referenced by this tx (can happen for
                # signatures returned by RPC for unrelated reasons, e.g.
                # an unrelated tx that happened to mention the address
                # via a CPI inner instruction we didn't decode).
                key_missing += 1
                continue
            pre = meta.get("preTokenBalances") or []
            post = meta.get("postTokenBalances") or []
            delta = _delta_for_watched_account(
                pre, post, mint=mint, watched_account_index=target_idx,
            )
            scanned += 1
            if delta < target - 1 or delta > target + 1:
                wrong_amount += 1
                continue
            transfer = IncomingTransfer(
                tx_hash=sig,
                block_timestamp_ms=block_time * 1000 if block_time else 0,
                from_addr="",   # SPL has multiple senders possible; not needed for matching
                to_addr=address,
                value_smallest_unit=delta,
                raw={
                    "signature": sig,
                    "blockTime": block_time,
                    "watch_addr": watch_addr,
                    "resolved_ata": resolved_via_ata,
                    "meta_keys": list(meta.keys()),
                },
            )
            return transfer, f"ok scanned={scanned} watch_addr={watch_addr}"
        except (TypeError, ValueError):
            parse_err += 1
        except requests.RequestException as exc:
            return None, f"solana_rpc_error:{type(exc).__name__}:{exc}"

    note = (
        f"no_match scanned={scanned} target_raw={target} "
        f"before_order={before_order} wrong_amount={wrong_amount} "
        f"parse_err={parse_err} key_missing={key_missing} "
        f"watch_addr={watch_addr} resolved_ata={resolved_via_ata}"
    )
    return None, note


register("SOL", find_incoming)
