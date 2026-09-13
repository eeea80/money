"""EVM USDT watcher (BEP20 + ERC20).

Two reconciliation paths, tried in order:

1. **Etherscan API V2** (since Aug 2024 the unified multi-chain endpoint
   at ``api.etherscan.io/v2/api?chainid=<id>``). Fast, paginated,
   indexed. One key covers BSC, Ethereum and 60+ other EVM chains.

   Caveat: as of 2025, Etherscan's **free** API plan only covers
   Ethereum mainnet. Chains like BSC (56) / Polygon (137) / Arbitrum
   require a paid plan and return ``"Free API access is not supported
   for this chain"`` on free keys.

2. **Public JSON-RPC** (``eth_getLogs`` against any public BSC/ETH
   RPC). No API key, free, and works on every EVM chain. Used as a
   transparent fallback when V2 is blocked (paid-tier error, missing
   key, or transient failure). Public RPCs are slower per call than
   Etherscan but more than fast enough for this low-frequency
   reconciliation use case.

Env vars (preferred):
    ETHERSCAN_API_KEY        — V2 unified key (paid plan needed for BSC)
    ETHERSCAN_V2_BASE_URL    — V2 host override (default api.etherscan.io/v2/api)
    BSC_RPC_URLS             — comma-separated BSC RPCs (fallback; add API-key
                               URLs here if your provider requires auth)
    ETH_RPC_URLS             — comma-separated ETH RPCs (fallback)

Backward-compatible legacy env vars (used when no V2 key is set OR when
the corresponding ``*_BASE_URL`` points at a v1 host):
    BSCSCAN_API_KEY / BSCSCAN_BASE_URL    — BEP20 v1 (api.bscscan.com)
    ETHERSCAN_API_KEY / ETHERSCAN_BASE_URL — ERC20 v1 (api.etherscan.io)
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

import requests

from app.utils.logger import get_logger

from ..chains import CHAIN_SPECS
from .base import IncomingTransfer, WatcherResult, register


logger = get_logger(__name__)


# Legacy v1 per-chain env names. Kept so existing .env files with
# `BSCSCAN_*` / `ETHERSCAN_*` continue to work; new deployments only
# need to set `ETHERSCAN_API_KEY`.
_LEGACY_BASE_ENV: Dict[str, str] = {
    "BEP20": "BSCSCAN_BASE_URL",
    "ERC20": "ETHERSCAN_BASE_URL",
}
_LEGACY_KEY_ENV: Dict[str, str] = {
    "BEP20": "BSCSCAN_API_KEY",
    "ERC20": "ETHERSCAN_API_KEY",
}
_V2_BASE_DEFAULT = "https://api.etherscan.io/v2/api"


# --- JSON-RPC fallback ---------------------------------------------------
# ERC-20 Transfer(address indexed from, address indexed to, uint256 value)
_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"

# Public RPC defaults — used when no env override is set. Order matters:
# we try them in sequence and fall back on RequestException / HTTP error.
_RPC_URL_ENV: Dict[str, str] = {
    "BEP20": "BSC_RPC_URLS",
    "ERC20": "ETH_RPC_URLS",
}
_DEFAULT_RPCS: Dict[str, List[str]] = {
    "BEP20": [
        "https://bsc-dataseed1.binance.org",
        "https://bsc-dataseed2.binance.org",
        "https://bsc-dataseed3.binance.org",
        "https://bsc-dataseed4.binance.org",
        "https://bsc.publicnode.com",
    ],
    "ERC20": [
        "https://ethereum-rpc.publicnode.com",
        "https://rpc.ankr.com/eth",
    ],
}
# Approximate block time (seconds). Used to convert "scan back N seconds"
# into "scan back M blocks" without an extra RPC roundtrip.
#
# BSC: post-Maxwell hardfork (April 2025) blocks are produced every ~0.75s,
# down from the old 3s cadence. Using the old 3.0 constant here silently
# made the worker scan only 1/4 of the intended time window — a fresh order
# whose payment landed 20 min ago would be missed because the lookback only
# covered the last 5 min of real time. 0.75 keeps a small safety margin
# (slightly over-scans) without exceeding RPC range limits.
# ETH: still ~12s per block since the Merge.
_AVG_BLOCK_TIME_SEC: Dict[str, float] = {"BEP20": 0.75, "ERC20": 12.0}
# Cap the scan window. Public RPCs typically allow 5k-block ranges for
# eth_getLogs; we cap at 4800 to stay safely under that. At 0.75s/block
# this covers ~1 hour of BSC real time, which comfortably fits the default
# 30-min order lifetime plus a bit of slack for manual revivals via SQL.
_MAX_BLOCK_LOOKBACK: Dict[str, int] = {"BEP20": 4800, "ERC20": 600}


# Per-chain reconciliation preference.
#
# - BEP20 → RPC-only by default. Etherscan's V2 free plan blocks BSC
#   (returns ``"Free API access is not supported for this chain"``), and
#   the legacy v1 host is also deprecated. Public BSC JSON-RPC (binance /
#   publicnode / ankr) is free, fast enough for this low-volume use case,
#   and the official-maintained data source for the chain — so we go
#   straight there and skip the explorer entirely. Avoids one wasted
#   round-trip per scan and keeps the operator's logs clean.
#
# - ERC20 → explorer-first. The V2 free plan still covers Ethereum
#   mainnet, and Etherscan's indexed tokentx endpoint is more robust
#   than ``eth_getLogs`` against pagination edge cases when the
#   receiving address sees frequent traffic. RPC remains the automatic
#   fallback for transient explorer errors.
#
# Operators can override this by setting ``BEP20_PREFER_EXPLORER=true``
# (e.g. after upgrading to a paid Etherscan V2 plan).
_PREFER_RPC_DEFAULT: Dict[str, bool] = {"BEP20": True, "ERC20": False}
_PREFER_RPC_ENV: Dict[str, str] = {
    "BEP20": "BEP20_PREFER_EXPLORER",
    "ERC20": "ERC20_PREFER_EXPLORER",
}


def _prefer_rpc(chain: str) -> bool:
    raw = os.getenv(_PREFER_RPC_ENV.get(chain, ""), "").strip().lower()
    if raw in ("1", "true", "yes"):
        return False  # admin explicitly wants explorer
    if raw in ("0", "false", "no"):
        return True
    return _PREFER_RPC_DEFAULT.get(chain, False)


def _resolve_contract(chain: str) -> str:
    spec = CHAIN_SPECS[chain]
    return (os.getenv(spec.contract_env, "") or "").strip() or spec.contract_default


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


def _resolve_endpoint(chain: str) -> Tuple[str, str, bool]:
    """Pick the URL + key for one EVM chain.

    Returns ``(url, api_key, is_v2)``. The ``url`` always points at the
    final ``/api`` endpoint (or `/v2/api` for V2), so callers just hit it
    directly with params.

    Resolution order (first match wins):
      1. Legacy per-chain ``*_BASE_URL`` env points at a v1 host
         (api.bscscan.com, api.etherscan.io WITHOUT `/v2`). Use it with
         the matching legacy per-chain key — this is the "I pinned to
         the old v1 deployment" escape hatch.
      2. Otherwise: V2 unified endpoint. Key picked from
         ``ETHERSCAN_API_KEY`` first (new V2 unified key), falling back
         to the legacy per-chain ``*_API_KEY`` so users who haven't
         migrated their env still work — BscScan/Etherscan accept V2
         keys on legacy hosts and vice-versa.
    """
    legacy_base = (os.getenv(_LEGACY_BASE_ENV[chain], "") or "").strip().rstrip("/")
    legacy_key = (os.getenv(_LEGACY_KEY_ENV[chain], "") or "").strip()
    v2_key = (os.getenv("ETHERSCAN_API_KEY", "") or "").strip()
    v2_base = (os.getenv("ETHERSCAN_V2_BASE_URL", "") or _V2_BASE_DEFAULT).strip().rstrip("/")

    # An admin who explicitly set a legacy v1 host wants v1 behavior.
    if legacy_base and "/v2" not in legacy_base.lower():
        url = legacy_base if legacy_base.endswith("/api") else f"{legacy_base}/api"
        return url, legacy_key or v2_key, False

    url = v2_base if v2_base.endswith("/api") else f"{v2_base}/api"
    # V2 keys are unified — prefer the v2 env, fall back to the per-chain
    # legacy env so a partially-migrated .env still works.
    return url, v2_key or legacy_key, True


# ---------------------------------------------------------------------------
# Path 1: Etherscan-style HTTP API (V2 unified or legacy v1)
# ---------------------------------------------------------------------------


def _is_paid_tier_error(message: str, result: str) -> bool:
    """Detect the V2 "BSC requires paid plan" response so we know to
    fall back to RPC instead of giving up.

    Returns True for messages like
    ``"Free API access is not supported for this chain. Please upgrade
    your api plan for full chain coverage."``
    """
    blob = f"{message} {result}".lower()
    return (
        "free api access is not supported" in blob
        or "upgrade your api plan" in blob
        or "deprecated v1 endpoint" in blob   # legacy v1 with V2-only key
    )


def _scan_explorer(
    chain: str,
    address: str,
    amount: Decimal,
    created_at: Optional[datetime],
    token_meta=None,
) -> Tuple[WatcherResult, bool]:
    """Hit the Etherscan-style HTTP API.

    Returns ``(result, paid_tier_blocked)``. When ``paid_tier_blocked``
    is True the caller should try the RPC fallback instead of treating
    this as a final answer.
    """
    spec = CHAIN_SPECS[chain]
    url, api_key, is_v2 = _resolve_endpoint(chain)
    token_meta = token_meta or {}
    contract = token_meta.get("contract") or _resolve_contract(chain)

    if not api_key:
        # Both V2 and v1 hosts technically accept anonymous traffic but
        # the free-tier quota is essentially 0 in 2025 — log and proceed
        # so we still surface a clear "empty_result" downstream.
        logger.debug("%s watcher: no API key configured, using anonymous quota", chain)

    decimals = int(token_meta.get("decimals") or spec.decimals)
    target = int((amount * (Decimal(10) ** decimals)).to_integral_value())
    ct = _parse_created_at(created_at)
    min_ts = int(ct.timestamp()) - 60 if ct else None  # explorers use seconds, not ms

    params: Dict[str, Any] = {
        "module": "account",
        "action": "tokentx",
        "contractaddress": contract,
        "address": address,
        "page": 1,
        "offset": 50,
        "sort": "desc",
    }
    if is_v2:
        params["chainid"] = spec.chain_id
    if api_key:
        params["apikey"] = api_key

    try:
        resp = requests.get(url, params=params, timeout=15)
        if resp.status_code != 200:
            head = (resp.text or "")[:200].replace("\n", " ")
            return (None, f"{chain.lower()}_http={resp.status_code} body={head!r}"), False

        body = resp.json() or {}
        status = str(body.get("status") or "")
        items = body.get("result") or []
        msg = str(body.get("message") or "")
        if status == "0" and isinstance(items, list) and not items:
            return (None, "no_match empty_result"), False
        if status == "0" and not isinstance(items, list):
            paid_blocked = _is_paid_tier_error(msg, str(items))
            note = f"explorer_error msg={msg!r} result={str(items)[:120]!r}"
            return (None, note), paid_blocked

        scanned = 0
        wrong_to = before_order = wrong_amount = parse_err = 0
        for it in items:
            scanned += 1
            try:
                if (it.get("to") or "").lower() != address.lower():
                    wrong_to += 1
                    continue
                ts = int(it.get("timeStamp") or 0)
                if min_ts is not None and ts < min_ts:
                    before_order += 1
                    continue
                val = int(it.get("value") or 0)
                if val < target - 1 or val > target + 1:
                    wrong_amount += 1
                    continue
                transfer = IncomingTransfer(
                    tx_hash=str(it.get("hash") or ""),
                    block_timestamp_ms=ts * 1000,
                    from_addr=str(it.get("from") or ""),
                    to_addr=str(it.get("to") or ""),
                    value_smallest_unit=val,
                    raw=it,
                )
                return (transfer, f"ok scanned={scanned}"), False
            except (TypeError, ValueError):
                parse_err += 1

        note = (
            f"no_match scanned={scanned} target_raw={target} "
            f"wrong_to={wrong_to} before_order={before_order} wrong_amount={wrong_amount} "
            f"parse_err={parse_err}"
        )
        return (None, note), False
    except requests.RequestException as exc:
        return (None, f"{chain.lower()}_request_error:{type(exc).__name__}:{exc}"), False


# ---------------------------------------------------------------------------
# Path 2: public JSON-RPC fallback (eth_getLogs)
# ---------------------------------------------------------------------------


def _rpc_endpoints(chain: str) -> List[str]:
    """Return the ordered list of RPC URLs to try for ``chain``.

    Reads ``BSC_RPC_URLS`` / ``ETH_RPC_URLS`` (comma-separated) first;
    falls back to the curated public defaults so a fresh deployment
    works with zero config.
    """
    raw = (os.getenv(_RPC_URL_ENV.get(chain, ""), "") or "").strip()
    if raw:
        urls = [u.strip().rstrip("/") for u in raw.split(",") if u.strip()]
        if urls:
            return urls
    return list(_DEFAULT_RPCS.get(chain, []))


def _rpc_call(url: str, method: str, params: List[Any], timeout: float = 12.0) -> Any:
    """Single JSON-RPC POST. Raises on transport / protocol error so the
    caller can fall through to the next URL in the rotation."""
    payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    resp = requests.post(url, json=payload, timeout=timeout)
    resp.raise_for_status()
    body = resp.json() or {}
    if "error" in body and body["error"]:
        raise RuntimeError(f"rpc_error:{body['error']}")
    return body.get("result")


def _try_rpcs(urls: List[str], method: str, params: List[Any]) -> Tuple[Any, Optional[str], Optional[str]]:
    """Try each URL in turn until one succeeds. Returns ``(result, used_url, errors)``."""
    errors: List[str] = []
    for url in urls:
        try:
            res = _rpc_call(url, method, params)
            return res, url, None
        except (requests.RequestException, ValueError, RuntimeError) as exc:
            errors.append(f"{url}:{type(exc).__name__}:{exc}")
            logger.debug("RPC call failed on %s: %s", url, exc)
    return None, None, " | ".join(errors[-5:]) if errors else None


def _address_to_topic(address: str) -> str:
    """Pad a 20-byte address to a 32-byte indexed-topic string."""
    addr = address.lower()
    if addr.startswith("0x"):
        addr = addr[2:]
    return "0x" + addr.rjust(64, "0")


def _scan_rpc(
    chain: str,
    address: str,
    amount: Decimal,
    created_at: Optional[datetime],
    token_meta=None,
) -> WatcherResult:
    """Search USDT Transfer logs on a public RPC.

    Strategy:
      1. Compute the desired block range covering ``created_at`` (with a
         60-second slop). For orders that have been alive for a long time
         this can be tens of thousands of blocks on BSC.
      2. Because most public RPCs cap a single ``eth_getLogs`` window at
         5k blocks (BSC nodes return ``code=-32005 "limit exceeded"``
         beyond that), the worker splits the desired range into chunks of
         ``_MAX_BLOCK_LOOKBACK`` and queries newest → oldest. A match in
         any chunk returns immediately, so freshly-paid orders still
         resolve in a single RPC call while old-revived orders walk
         further back without losing reach.
    """
    spec = CHAIN_SPECS[chain]
    token_meta = token_meta or {}
    contract = token_meta.get("contract") or _resolve_contract(chain)
    urls = _rpc_endpoints(chain)
    if not urls:
        return None, f"{chain.lower()}_rpc_no_endpoints"

    decimals = int(token_meta.get("decimals") or spec.decimals)
    target = int((amount * (Decimal(10) ** decimals)).to_integral_value())

    # 1) latest block
    blk_hex, _, err = _try_rpcs(urls, "eth_blockNumber", [])
    if not isinstance(blk_hex, str):
        return None, f"{chain.lower()}_rpc_block_number_failed:{err}"
    try:
        latest_block = int(blk_hex, 16)
    except (TypeError, ValueError):
        return None, f"{chain.lower()}_rpc_bad_block_number={blk_hex!r}"

    # 2) full desired lookback from created_at, NOT clamped here — the
    #    chunking loop below enforces the per-request cap.
    block_time = _AVG_BLOCK_TIME_SEC.get(chain, 3.0)
    chunk_size = _MAX_BLOCK_LOOKBACK.get(chain, 1500)
    ct = _parse_created_at(created_at)
    if ct is not None:
        secs = max(0.0, (datetime.now(timezone.utc) - ct).total_seconds() + 60)
        total_lookback = int(secs / block_time) + 20
    else:
        total_lookback = chunk_size
    # Absolute safety ceiling: never walk back further than ~4h of BSC
    # real time, even if the caller passes a very old created_at. This
    # keeps a single reconcile call bounded to ~4 chunks worst-case.
    absolute_max = chunk_size * 4
    total_lookback = max(chunk_size, min(total_lookback, absolute_max))
    floor_block = max(0, latest_block - total_lookback)

    topic_to = _address_to_topic(address)

    scanned = 0
    wrong_amount = parse_err = 0
    used_url: Optional[str] = None
    walked_from: Optional[int] = None
    last_err: Optional[str] = None

    # Walk newest → oldest in fixed-size chunks. Newest first means a
    # user who just paid resolves on the first chunk (~1 RPC call), while
    # an order created hours ago still gets the full reach.
    end = latest_block
    while end >= floor_block:
        start = max(floor_block, end - (chunk_size - 1))
        log_filter = {
            "fromBlock": hex(start),
            "toBlock": hex(end),
            "address": contract.lower(),
            "topics": [_TRANSFER_TOPIC, None, topic_to],
        }
        logs, url, err = _try_rpcs(urls, "eth_getLogs", [log_filter])
        if logs is None:
            last_err = f"{err} (range={start}-{end})"
            # Don't abort the whole scan on a single chunk failure —
            # next chunk may use a different RPC via fallback. But if
            # every RPC died on this chunk we'll bubble up `last_err`
            # at the end so operators see why.
            end = start - 1
            continue
        used_url = url
        if walked_from is None or start < walked_from:
            walked_from = start

        if not isinstance(logs, list):
            last_err = f"bad_logs={str(logs)[:120]!r} (range={start}-{end})"
            end = start - 1
            continue

        for log in logs:
            scanned += 1
            try:
                data = log.get("data") or "0x0"
                val = int(data, 16)
                if val < target - 1 or val > target + 1:
                    wrong_amount += 1
                    continue
                topics = log.get("topics") or []
                from_topic = topics[1] if len(topics) >= 2 else ""
                from_addr = "0x" + str(from_topic)[-40:] if from_topic else ""
                transfer = IncomingTransfer(
                    tx_hash=str(log.get("transactionHash") or ""),
                    # eth_getLogs doesn't include the block timestamp;
                    # leave it at 0. The service's "paid → confirmed"
                    # flow falls back to `paid_at` for the confirm-delay
                    # gate, so this is fine.
                    block_timestamp_ms=0,
                    from_addr=from_addr,
                    to_addr=address,
                    value_smallest_unit=val,
                    raw=log,
                )
                return transfer, (
                    f"rpc_ok scanned={scanned} via={used_url} "
                    f"matched_block={int(log.get('blockNumber','0x0'), 16)} "
                    f"walked_from={walked_from}"
                )
            except (TypeError, ValueError):
                parse_err += 1

        end = start - 1

    if scanned == 0 and last_err is not None:
        return None, f"{chain.lower()}_rpc_get_logs_failed:{last_err}"

    return None, (
        f"rpc_no_match scanned={scanned} target_raw={target} "
        f"wrong_amount={wrong_amount} parse_err={parse_err} "
        f"walked_from={walked_from if walked_from is not None else floor_block} "
        f"latest={latest_block} via={used_url}"
    )


# ---------------------------------------------------------------------------
# Public watcher: explorer first, RPC fallback when explorer is unavailable
# ---------------------------------------------------------------------------


def _make_finder(chain: str):
    def find_incoming(address: str, amount: Decimal, created_at: Optional[datetime], token_meta=None) -> WatcherResult:
        address = (address or "").strip()
        if not address or amount <= 0:
            return None, "bad_args"

        # Chains where the explorer is unusable on the free plan (BSC and
        # friends) go straight to RPC. This avoids one wasted round-trip
        # per scan and keeps reconcile logs free of noisy paid-tier errors.
        if _prefer_rpc(chain):
            return _scan_rpc(chain, address, amount, created_at, token_meta)

        # Explorer-first path (ERC20 by default; or BEP20 when the
        # operator opted in via BEP20_PREFER_EXPLORER=true).
        _, api_key, _ = _resolve_endpoint(chain)
        explorer_result: WatcherResult = (None, "")
        paid_blocked = False
        if api_key:
            explorer_result, paid_blocked = _scan_explorer(chain, address, amount, created_at, token_meta)
            tx, note = explorer_result
            if tx is not None:
                return tx, note
            # Definitive negative answers from the explorer (empty result,
            # mismatched amounts, etc.) are authoritative — no need to
            # double-check via RPC.
            if not paid_blocked:
                return explorer_result

        # RPC fallback when the explorer is unreachable or rejected our
        # request (paid-tier / V2-only). Also covers the "no API key
        # configured" path.
        rpc_tx, rpc_note = _scan_rpc(chain, address, amount, created_at, token_meta)
        if rpc_tx is not None:
            return rpc_tx, rpc_note
        if api_key and explorer_result[1]:
            return None, f"explorer={explorer_result[1]} | {rpc_note}"
        return None, rpc_note

    return find_incoming


register("BEP20", _make_finder("BEP20"))
register("ERC20", _make_finder("ERC20"))
