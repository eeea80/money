"""TRC20 USDT watcher (TronGrid)."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, Optional

import requests

from app.utils.logger import get_logger

from ..chains import CHAIN_SPECS
from .base import IncomingTransfer, WatcherResult, register


logger = get_logger(__name__)


def _resolve_endpoint() -> str:
    return (os.getenv("TRONGRID_BASE_URL", "https://api.trongrid.io") or "").strip().rstrip("/")


def _resolve_contract() -> str:
    spec = CHAIN_SPECS["TRC20"]
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


def find_incoming(address: str, amount: Decimal, created_at: Optional[datetime], token_meta=None) -> WatcherResult:
    """Look for a TRC20 USDT transfer that *exactly* matches the order
    amount and lands at ``address`` after ``created_at``.

    Exact-match is the foundation of amount-suffix identification: under
    the suffix scheme the amount is unique per active order, so we don't
    want to accept an over-payment as a different order's match.
    """
    base = _resolve_endpoint()
    token_meta = token_meta or {}
    contract = token_meta.get("contract") or _resolve_contract()
    decimals = int(token_meta.get("decimals") or 6)
    address = (address or "").strip()
    if not address or amount <= 0:
        return None, "bad_args"

    page_limit = int(os.getenv("USDT_TRC20_PAGE_LIMIT", "100") or 100)
    max_pages = int(os.getenv("USDT_TRC20_MAX_PAGES", "5") or 5)
    target = int((amount * Decimal(10 ** decimals)).to_integral_value())

    ct = _parse_created_at(created_at)
    min_ts = int(ct.timestamp() * 1000) - 60_000 if ct else None

    headers: Dict[str, str] = {}
    api_key = (os.getenv("TRONGRID_API_KEY", "") or "").strip()
    if api_key:
        headers["TRON-PRO-API-KEY"] = api_key

    url = f"{base}/v1/accounts/{address}/transactions/trc20"
    fingerprint: Optional[str] = None
    scanned = 0
    pages = 0
    wrong_to = before_order = wrong_amount = parse_err = 0

    try:
        for _ in range(max_pages):
            params: Dict[str, Any] = {
                "only_to": "true",
                "limit": page_limit,
                "contract_address": contract,
                "only_confirmed": "true",
            }
            if fingerprint:
                params["fingerprint"] = fingerprint

            resp = requests.get(url, params=params, headers=headers, timeout=15)
            if resp.status_code != 200:
                head = (resp.text or "")[:200].replace("\n", " ")
                return None, f"trongrid_http={resp.status_code} body={head!r}"

            data = resp.json() or {}
            items = data.get("data") or []
            pages += 1
            scanned += len(items)

            for it in items:
                try:
                    if (it.get("to") or "").strip() != address:
                        wrong_to += 1
                        continue
                    bts = int(it.get("block_timestamp") or 0)
                    if min_ts and bts < min_ts:
                        before_order += 1
                        continue
                    val = int(it.get("value") or 0)
                    # Exact-match: amount-suffix demands no slop. Allow a tiny
                    # rounding tolerance (1 micro-unit) for wallets that
                    # truncate trailing zeros.
                    if val < target - 1 or val > target + 1:
                        wrong_amount += 1
                        continue
                    transfer = IncomingTransfer(
                        tx_hash=str(it.get("transaction_id") or ""),
                        block_timestamp_ms=bts,
                        from_addr=str(it.get("from") or ""),
                        to_addr=str(it.get("to") or ""),
                        value_smallest_unit=val,
                        raw=it,
                    )
                    return transfer, f"ok pages={pages} scanned={scanned}"
                except (TypeError, ValueError):
                    parse_err += 1

            meta = data.get("meta") or {}
            fingerprint = meta.get("fingerprint") if isinstance(meta.get("fingerprint"), str) else None
            if not fingerprint or len(items) < page_limit:
                break

        note = (
            f"no_match scanned={scanned} pages={pages} target_raw={target} min_ts={min_ts} "
            f"wrong_to={wrong_to} before_order={before_order} wrong_amount={wrong_amount} parse_err={parse_err}"
        )
        return None, note
    except requests.RequestException as exc:
        return None, f"trongrid_request_error:{type(exc).__name__}:{exc}"


register("TRC20", find_incoming)
