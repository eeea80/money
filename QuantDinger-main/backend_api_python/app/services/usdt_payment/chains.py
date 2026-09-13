"""
Chain metadata, payment-URI construction and amount-suffix generation.

This is the single source of truth for "what chains do we support and how
do we tell wallets / scanners about them". Everything else in the package
delegates to functions here.

Design notes:
  - One fixed receiving address per chain (configured in env).
  - Order amount = base_price + unique_suffix in the low decimals.
    The suffix is the order's identity on-chain; we don't need per-order
    addresses or HD-derivation any more.
  - The QR shown to the user encodes a chain-specific deep link so wallets
    that understand the URI scheme (imToken / MetaMask / TokenPocket /
    Phantom / Solflare ...) can prefill the amount; wallets that don't
    fall back to reading the recipient address and the user still sees
    the full amount with a copy button next to the QR.
"""

from __future__ import annotations

import hashlib
import os
import secrets
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Dict, List, Optional, Tuple, Union
from urllib.parse import quote


# ---------------------------------------------------------------------------
# Chain spec
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ChainSpec:
    """Static metadata for one supported chain.

    Fields are intentionally const; runtime state (address, api keys, etc.)
    lives in env vars and is resolved lazily via :func:`chain_metadata`.
    """

    code: str                       # "TRC20" / "BEP20" / "ERC20" / "SOL"
    label: str                      # human-friendly label
    network_kind: str               # "tron" / "evm" / "solana"
    decimals: int                   # USDT decimals on this chain
    contract_env: str               # env var holding USDT contract / mint
    contract_default: str           # fallback if env is empty
    address_env: str                # env var holding the receiving address
    chain_id: int                   # EIP-155 chain id (EVM only; 0 otherwise)
    typical_fee_usdt: float         # rough end-user fee for the user picker
    recommended: bool               # show a "recommended" badge in the UI
    address_prefix_hint: str        # for UI hint only, e.g. "T..." / "0x..."


CHAIN_SPECS: Dict[str, ChainSpec] = {
    "TRC20": ChainSpec(
        code="TRC20",
        label="TRON (TRC20)",
        network_kind="tron",
        decimals=6,
        contract_env="USDT_TRC20_CONTRACT",
        contract_default="TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        address_env="USDT_TRC20_ADDRESS",
        chain_id=0,
        typical_fee_usdt=1.5,
        recommended=False,
        address_prefix_hint="T...",
    ),
    "BEP20": ChainSpec(
        code="BEP20",
        label="BSC (BEP20)",
        network_kind="evm",
        decimals=18,
        contract_env="USDT_BEP20_CONTRACT",
        contract_default="0x55d398326f99059fF775485246999027B3197955",
        address_env="USDT_BEP20_ADDRESS",
        chain_id=56,
        typical_fee_usdt=0.30,
        recommended=True,
        address_prefix_hint="0x...",
    ),
    "ERC20": ChainSpec(
        code="ERC20",
        label="Ethereum (ERC20)",
        network_kind="evm",
        decimals=6,
        contract_env="USDT_ERC20_CONTRACT",
        contract_default="0xdAC17F958D2ee523a2206206994597C13D831ec7",
        address_env="USDT_ERC20_ADDRESS",
        chain_id=1,
        typical_fee_usdt=5.0,
        recommended=False,
        address_prefix_hint="0x...",
    ),
    "SOL": ChainSpec(
        code="SOL",
        label="Solana (SPL)",
        network_kind="solana",
        decimals=6,
        contract_env="USDT_SOL_MINT",
        contract_default="Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
        address_env="USDT_SOL_ADDRESS",
        chain_id=0,
        typical_fee_usdt=0.0005,
        recommended=True,
        address_prefix_hint="base58",
    ),
}

# Only Circle-issued native USDC networks supported by the scanners in this
# service are exposed. TRON USDC has been discontinued by Circle, while the
# commonly used BSC token is Binance-Peg USDC rather than native USDC.
USDC_SUPPORTED_CODES: Tuple[str, ...] = ("ERC20", "SOL")
USDC_TOKEN_DEFAULTS: Dict[str, Tuple[str, int]] = {
    "ERC20": ("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6),
    "SOL": ("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", 6),
}


def _enabled_codes(currency: str = "USDT") -> List[str]:
    currency = (currency or "USDT").strip().upper()
    if currency == "USDC":
        supported = set(USDC_SUPPORTED_CODES)
        default_codes = ",".join(USDC_SUPPORTED_CODES)
    else:
        supported = set(CHAIN_SPECS)
        default_codes = "TRC20,BEP20,ERC20,SOL"
    raw = os.getenv(f"{currency}_PAY_ENABLED_CHAINS", default_codes) or ""
    out: List[str] = []
    for tok in raw.upper().split(","):
        tok = tok.strip()
        if tok in supported and tok not in out:
            out.append(tok)
    return out


def chain_metadata(code: str, currency: str = "USDT") -> Optional[Dict]:
    """Return runtime metadata for one chain, or None if the chain is not
    enabled or no receiving address is configured.

    The returned dict is safe to ship to the frontend; in particular it does
    NOT include API keys or RPC URLs.
    """
    code = (code or "").strip().upper()
    currency = (currency or "USDT").strip().upper()
    if currency not in ("USDT", "USDC"):
        return None
    spec = CHAIN_SPECS.get(code)
    if spec is None:
        return None
    if code not in _enabled_codes(currency):
        return None
    # By default USDC goes to the same operator wallet as USDT. A dedicated
    # USDC address may still be configured for accounting separation.
    address_env = f"{currency}_{code}_ADDRESS" if code != "SOL" else f"{currency}_SOL_ADDRESS"
    address = (os.getenv(address_env, "") or "").strip()
    if not address and currency == "USDC":
        address = (os.getenv(spec.address_env, "") or "").strip()
    if not address:
        return None
    if currency == "USDC":
        default_contract, decimals = USDC_TOKEN_DEFAULTS[code]
        contract_env = f"USDC_{code}_CONTRACT" if code != "SOL" else "USDC_SOL_MINT"
        contract = (os.getenv(contract_env, "") or "").strip() or default_contract
    else:
        decimals = spec.decimals
        contract = (os.getenv(spec.contract_env, "") or "").strip() or spec.contract_default
    return {
        "code": spec.code,
        "label": spec.label,
        "network_kind": spec.network_kind,
        "address": address,
        "contract": contract,
        "decimals": decimals,
        "currency": currency,
        "chain_id": spec.chain_id,
        "typical_fee_usdt": spec.typical_fee_usdt,
        "recommended": spec.recommended,
        "address_prefix_hint": spec.address_prefix_hint,
    }


def list_enabled_chains(currency: str = "USDT") -> List[Dict]:
    """Return runtime metadata for every chain that is both enabled and has
    a receiving address configured. UI uses this to render the chain picker.
    """
    out: List[Dict] = []
    for code in _enabled_codes(currency):
        meta = chain_metadata(code, currency)
        if meta is not None:
            out.append(meta)
    return out


# ---------------------------------------------------------------------------
# Amount-suffix generator
# ---------------------------------------------------------------------------


def suffix_decimals() -> int:
    try:
        n = int(os.getenv("USDT_AMOUNT_SUFFIX_DECIMALS", "6") or 6)
    except (TypeError, ValueError):
        n = 6
    # Clamp to a sane range: 4..8. Below 4 collides too easily, above 8
    # bumps into Decimal(20,8) column precision and wallet display issues.
    return max(4, min(8, n))


def _suffix_quantizer() -> Decimal:
    return Decimal(1).scaleb(-suffix_decimals())


def format_amount_display(val: Union[Decimal, str, int, float, None]) -> str:
    """Canonical wire-format for any USDT amount in this package.

    The DB column is ``NUMERIC(20,8)`` (kept wider than ``suffix_decimals()``
    so we can lift precision later without a migration), but the contract
    with the frontend and with wallet URIs is: **the amount always has
    exactly ``suffix_decimals()`` fractional digits**. Without this layer
    a 6-decimal final value like ``Decimal('19.901234')`` round-trips
    through Postgres as ``Decimal('19.90123400')`` and the frontend would
    render ``19.90 + 123400`` (8 fractional digits) one minute and
    ``19.90 + 1234`` (6 fractional digits) the next, depending on whether
    the value came straight from ``create_order`` or via a refresh.
    """
    if val is None or val == "":
        return "0"
    try:
        d = val if isinstance(val, Decimal) else Decimal(str(val))
    except (InvalidOperation, ValueError, TypeError):
        return str(val)
    return str(d.quantize(_suffix_quantizer(), rounding=ROUND_HALF_UP))


def build_amount_with_suffix(
    base_amount: Decimal,
    *,
    seed: Optional[bytes] = None,
    attempt: int = 0,
) -> Tuple[Decimal, Decimal]:
    """Generate (final_amount, suffix) where ``suffix`` lives strictly in
    the low decimal places of the amount and is bounded so the user only
    over-pays a fraction of a cent.

    Design choice:
        - ``decimals`` is the total precision of the final amount (typ. 6).
        - The suffix is drawn from ``[1 .. 10**(decimals-2)]`` and then
          divided by ``10**decimals``, which keeps the suffix below
          ``0.01 USDT`` regardless of decimals.

    Example with decimals=6:
        base=19.9, suffix_int=1234, suffix=0.001234, final=19.901234
        Worst case (suffix_int=10000): final=19.91   (over-paid 1¢)

    The seed is mixed with the attempt counter so the caller can retry on
    a unique-index collision by simply incrementing ``attempt`` without
    needing any external state. We avoid suffix == 0 because the final
    amount would then be visually indistinguishable from the base price.
    """
    if base_amount <= 0:
        raise ValueError("base_amount must be positive")
    decimals = suffix_decimals()
    divisor = Decimal(10 ** decimals)
    # Cap the suffix below 0.01 USDT. The slot space is 10**(decimals-2)+1
    # = 101 (decimals=4) / 10001 (decimals=6) / 1000001 (decimals=8) which is
    # plenty for the active-order window: the unique index on
    # (chain, amount_usdt) where status IN ('pending','paid') guarantees
    # no two live orders ever collide, the suffix only needs to *avoid*
    # collisions, not be globally unique forever.
    space = max(100, 10 ** (decimals - 2))
    raw = seed or secrets.token_bytes(16)
    digest = hashlib.sha256(raw + attempt.to_bytes(2, "big")).digest()
    slot = int.from_bytes(digest[:8], "big") % space
    suffix_int = slot + 1  # ∈ [1, space]; never zero
    suffix = (Decimal(suffix_int) / divisor).quantize(_suffix_quantizer(), rounding=ROUND_HALF_UP)
    final = (base_amount + suffix).quantize(_suffix_quantizer(), rounding=ROUND_HALF_UP)
    return final, suffix


# ---------------------------------------------------------------------------
# Payment URI builders
# ---------------------------------------------------------------------------


def _to_smallest_unit(amount: Decimal, decimals: int) -> int:
    return int((amount * (Decimal(10) ** decimals)).to_integral_value(rounding=ROUND_HALF_UP))


def build_payment_uri(
    chain: str,
    address: str,
    amount: Decimal,
    *,
    contract: Optional[str] = None,
    currency: str = "USDT",
    decimals: Optional[int] = None,
    order_id: Optional[int] = None,
    label: str = "QuantDinger",
) -> str:
    """Build a chain-specific deep-link URI that wallets can scan to
    auto-fill recipient + amount.

    - EVM (BEP20/ERC20): EIP-681
        ethereum:<contract>@<chain_id>/transfer?address=<recipient>&uint256=<raw>
      Supported by MetaMask, TrustWallet, TokenPocket, imToken, OKX, Coinbase.

    - TRON: a "tron:<recipient>?asset=USDT&amount=<human>" URI.
      Officially TRON has no spec; in practice imToken / TokenPocket /
      MetaMask (via TRON snap) recognise this form. Wallets that don't
      will still scan the address out of the URI body, and the order
      page always shows the amount with a copy button as fallback.

    - Solana: Solana Pay
        solana:<recipient>?amount=<human>&spl-token=<mint>&label=...&message=...
      Supported by Phantom, Solflare, TokenPocket, OKX, TrustWallet.
    """
    code = (chain or "").strip().upper()
    spec = CHAIN_SPECS.get(code)
    if spec is None:
        return address or ""
    if not address:
        return ""
    used_contract = (contract or "").strip()
    if not used_contract:
        used_contract = (os.getenv(spec.contract_env, "") or "").strip() or spec.contract_default

    # All human-amount slots in URIs go through ``format_amount_display`` so
    # the wallet sees exactly ``suffix_decimals()`` fractional digits — the
    # same string the user is asked to copy/paste — regardless of whether
    # the caller passed a Decimal that round-tripped through a wider DB
    # column (NUMERIC(20,8)) or came straight from the suffix generator.
    human_amount = format_amount_display(amount)
    currency = (currency or "USDT").strip().upper()
    token_decimals = spec.decimals if decimals is None else int(decimals)

    if spec.network_kind == "evm":
        raw = _to_smallest_unit(amount, token_decimals)
        return (
            f"ethereum:{used_contract}@{spec.chain_id}/transfer"
            f"?address={address}&uint256={raw}"
        )
    if spec.network_kind == "tron":
        # No formal spec for TRON; in practice imToken / TokenPocket /
        # MetaMask (with the TRON snap) recognise this form, and wallets
        # that don't still pull the recipient out of the URI body.
        return f"tron:{address}?asset={currency}&amount={human_amount}"
    if spec.network_kind == "solana":
        msg = f"Order #{order_id}" if order_id else "Membership payment"
        params = (
            f"amount={human_amount}"
            f"&spl-token={used_contract}"
            f"&label={quote(label, safe='')}"
            f"&message={quote(msg, safe='')}"
        )
        return f"solana:{address}?{params}"
    return address
