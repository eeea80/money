"""
USDT payment package (multi-chain, single-address + amount-suffix model).

Public entry points are re-exported from `app.services.usdt_payment_service`
for backward compatibility with existing imports.

Layout:
    chains.py        — chain metadata, URI builders, amount-suffix generator
    watchers/        — per-chain incoming-transfer scanners
    service.py       — UsdtPaymentService (orders, refresh) + UsdtOrderWorker
"""

from .chains import (
    ChainSpec,
    CHAIN_SPECS,
    list_enabled_chains,
    chain_metadata,
    build_payment_uri,
    build_amount_with_suffix,
    format_amount_display,
    suffix_decimals,
)

__all__ = [
    "ChainSpec",
    "CHAIN_SPECS",
    "list_enabled_chains",
    "chain_metadata",
    "build_payment_uri",
    "build_amount_with_suffix",
    "format_amount_display",
    "suffix_decimals",
]
