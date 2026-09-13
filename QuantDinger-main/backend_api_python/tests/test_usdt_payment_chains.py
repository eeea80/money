"""Tests for the multi-chain USDT payment primitives.

Scope:
- amount-suffix generator: deterministic-on-retry, never zero, fits the
  configured decimal width, attempts are distinct
- payment-URI builder: produces a wallet-recognisable URI for every
  supported chain (EVM EIP-681, Solana Pay, TRON)
- chain registry: list_enabled_chains honours USDT_PAY_ENABLED_CHAINS and
  hides chains whose receiving address is empty

These are pure-function tests; no network, no DB. The reconciler + worker
logic is exercised separately.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.services.usdt_payment.chains import (
    CHAIN_SPECS,
    USDC_TOKEN_DEFAULTS,
    build_amount_with_suffix,
    build_payment_uri,
    chain_metadata,
    format_amount_display,
    list_enabled_chains,
    suffix_decimals,
)


# ---------------------------------------------------------------------------
# Amount suffix generator
# ---------------------------------------------------------------------------


def test_suffix_within_configured_decimals(monkeypatch):
    monkeypatch.setenv("USDT_AMOUNT_SUFFIX_DECIMALS", "6")
    base = Decimal("19.9")
    final, suffix = build_amount_with_suffix(base, seed=b"seed-1", attempt=0)
    assert suffix_decimals() == 6
    assert suffix > 0, "suffix must be strictly positive so the wallet shows a unique amount"
    # suffix must stay below 0.01 USDT so the user only over-pays at most 1¢
    assert suffix <= Decimal("0.01"), "suffix must be capped to <0.01 USDT"
    assert final == base + suffix
    # final amount has at most `decimals` fractional digits
    _, _, frac = str(final).partition(".")
    assert len(frac) <= 6


def test_suffix_uses_full_precision(monkeypatch):
    """At decimals=6, suffix slot space is 10001 (= 10^4 + 1), giving us at
    least 4 distinct decimal positions even though suffix < 0.01 USDT.
    """
    monkeypatch.setenv("USDT_AMOUNT_SUFFIX_DECIMALS", "6")
    base = Decimal("19.9")
    # Walk a large set of seeds and confirm we get at least a few hundred
    # distinct suffix values — guards against an off-by-one that would
    # accidentally lock us to a tiny slot space.
    suffixes = set()
    for i in range(500):
        _, suffix = build_amount_with_suffix(base, seed=i.to_bytes(4, "big"))
        suffixes.add(suffix)
    assert len(suffixes) >= 200, f"expected >= 200 distinct suffixes, got {len(suffixes)}"


def test_suffix_retries_diverge(monkeypatch):
    """Each attempt produces a different suffix; the caller can therefore
    retry on a unique-index collision without external state."""
    monkeypatch.setenv("USDT_AMOUNT_SUFFIX_DECIMALS", "6")
    base = Decimal("19.9")
    seen = set()
    for attempt in range(8):
        _, suffix = build_amount_with_suffix(base, seed=b"same-seed", attempt=attempt)
        seen.add(suffix)
    assert len(seen) == 8, "every attempt must yield a unique suffix"


def test_suffix_rejects_invalid_base(monkeypatch):
    monkeypatch.setenv("USDT_AMOUNT_SUFFIX_DECIMALS", "6")
    with pytest.raises(ValueError):
        build_amount_with_suffix(Decimal("0"))
    with pytest.raises(ValueError):
        build_amount_with_suffix(Decimal("-1"))


def test_suffix_decimals_is_clamped(monkeypatch):
    monkeypatch.setenv("USDT_AMOUNT_SUFFIX_DECIMALS", "99")
    assert suffix_decimals() == 8
    monkeypatch.setenv("USDT_AMOUNT_SUFFIX_DECIMALS", "1")
    assert suffix_decimals() == 4
    monkeypatch.setenv("USDT_AMOUNT_SUFFIX_DECIMALS", "garbage")
    assert suffix_decimals() == 6


# ---------------------------------------------------------------------------
# Payment URI builders
# ---------------------------------------------------------------------------


def test_uri_bep20_uses_eip681_chain_56(monkeypatch):
    monkeypatch.setenv("USDT_BEP20_CONTRACT", CHAIN_SPECS["BEP20"].contract_default)
    uri = build_payment_uri(
        "BEP20",
        "0xRecipient000000000000000000000000000000ab",
        Decimal("19.991234"),
        order_id=42,
    )
    # EIP-681 envelope
    assert uri.startswith("ethereum:")
    assert "@56/transfer" in uri
    # BSC USDT has 18 decimals -> 19.991234 * 10^18 == 19991234 * 10^12
    expected_raw = 19_991_234 * (10 ** 12)
    assert f"uint256={expected_raw}" in uri
    assert "address=0xRecipient" in uri


def test_uri_erc20_uses_eip681_chain_1_with_6_decimals(monkeypatch):
    uri = build_payment_uri(
        "ERC20",
        "0xMain00000000000000000000000000000000beef",
        Decimal("19.991234"),
        order_id=1,
    )
    assert uri.startswith("ethereum:")
    assert "@1/transfer" in uri
    # USDT on Ethereum is 6 decimals -> raw = 19991234
    assert "uint256=19991234" in uri


def test_uri_tron_keeps_human_amount():
    uri = build_payment_uri(
        "TRC20",
        "TXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        Decimal("19.991234"),
        order_id=1,
    )
    assert uri.startswith("tron:")
    assert "TXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" in uri
    assert "asset=USDT" in uri
    assert "amount=19.991234" in uri


def test_uri_tron_amount_is_quantized_to_six_decimals(monkeypatch):
    """The amount in the URI must match the displayed amount exactly —
    not the raw DB-padded version (NUMERIC(20,8) gives 19.99123400).
    Otherwise wallets would auto-fill an amount the user can't recognise.
    """
    monkeypatch.setenv("USDT_AMOUNT_SUFFIX_DECIMALS", "6")
    uri = build_payment_uri(
        "TRC20",
        "TXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        Decimal("19.99123400"),  # DB-style 8-decimal padding
        order_id=1,
    )
    assert "amount=19.991234" in uri, f"expected 6-decimal amount, got URI: {uri}"
    assert "amount=19.99123400" not in uri


def test_uri_solana_uses_solana_pay():
    uri = build_payment_uri(
        "SOL",
        "SoLwallet0000000000000000000000000000000000",
        Decimal("19.991234"),
        order_id=77,
    )
    assert uri.startswith("solana:")
    assert "amount=19.991234" in uri
    # Default USDT mint must be there as the spl-token param
    assert f"spl-token={CHAIN_SPECS['SOL'].contract_default}" in uri
    assert "label=QuantDinger" in uri
    assert "Order" in uri  # message includes "Order #77" url-encoded


def test_uri_unknown_chain_returns_plain_address():
    uri = build_payment_uri("DOGE", "Dxxxxxxxxxxxxxxxxxxxx", Decimal("1.000001"))
    assert uri == "Dxxxxxxxxxxxxxxxxxxxx"


def test_uri_empty_address_returns_empty():
    uri = build_payment_uri("BEP20", "", Decimal("19.991234"))
    assert uri == ""


# ---------------------------------------------------------------------------
# Chain registry (env-driven enable/disable)
# ---------------------------------------------------------------------------


@pytest.fixture
def isolate_chain_env(monkeypatch):
    """Wipe every USDT_*_ADDRESS so each test starts from a clean slate."""
    for code, spec in CHAIN_SPECS.items():
        monkeypatch.delenv(spec.address_env, raising=False)
        monkeypatch.delenv(f"USDC_{code}_ADDRESS", raising=False)
        monkeypatch.delenv(
            f"USDC_{code}_CONTRACT" if code != "SOL" else "USDC_SOL_MINT",
            raising=False,
        )
    monkeypatch.delenv("USDT_PAY_ENABLED_CHAINS", raising=False)
    monkeypatch.delenv("USDC_PAY_ENABLED_CHAINS", raising=False)
    yield monkeypatch


def test_chain_without_address_is_hidden(isolate_chain_env):
    isolate_chain_env.setenv("USDT_PAY_ENABLED_CHAINS", "TRC20,BEP20")
    assert list_enabled_chains() == []  # neither has an address yet
    isolate_chain_env.setenv("USDT_BEP20_ADDRESS", "0xMain")
    chains = list_enabled_chains()
    assert [c["code"] for c in chains] == ["BEP20"], \
        "only the chain with a configured address should be returned"


def test_chain_not_in_enabled_list_is_hidden(isolate_chain_env):
    isolate_chain_env.setenv("USDT_PAY_ENABLED_CHAINS", "BEP20")
    isolate_chain_env.setenv("USDT_TRC20_ADDRESS", "Txxxx")
    isolate_chain_env.setenv("USDT_BEP20_ADDRESS", "0xMain")
    chains = list_enabled_chains()
    assert [c["code"] for c in chains] == ["BEP20"], \
        "TRC20 has an address but is not in USDT_PAY_ENABLED_CHAINS, so it must be hidden"


def test_chain_metadata_returns_none_when_disabled(isolate_chain_env):
    isolate_chain_env.setenv("USDT_PAY_ENABLED_CHAINS", "TRC20")
    # No address -> None
    assert chain_metadata("TRC20") is None
    isolate_chain_env.setenv("USDT_TRC20_ADDRESS", "Txxxx")
    meta = chain_metadata("TRC20")
    assert meta is not None
    assert meta["code"] == "TRC20"
    assert meta["address"] == "Txxxx"
    assert meta["decimals"] == 6
    assert meta["network_kind"] == "tron"


def test_chain_metadata_returns_none_for_unknown_chain():
    assert chain_metadata("DOGE") is None
    assert chain_metadata("") is None


def test_usdc_reuses_supported_chain_registry_and_receiving_wallet(isolate_chain_env):
    isolate_chain_env.setenv("USDC_PAY_ENABLED_CHAINS", "ERC20")
    isolate_chain_env.setenv("USDT_ERC20_ADDRESS", "0xSharedWallet")
    meta = chain_metadata("ERC20", "USDC")
    assert meta is not None
    assert meta["currency"] == "USDC"
    assert meta["address"] == "0xSharedWallet"
    assert meta["contract"] == USDC_TOKEN_DEFAULTS["ERC20"][0]
    assert meta["decimals"] == 6
    assert [item["code"] for item in list_enabled_chains("USDC")] == ["ERC20"]

    uri = build_payment_uri(
        "ERC20",
        meta["address"],
        Decimal("19.991234"),
        currency="USDC",
        contract=meta["contract"],
        decimals=meta["decimals"],
    )
    assert "uint256=19991234" in uri


@pytest.mark.parametrize("code", ["ERC20", "SOL"])
def test_usdc_has_built_in_contracts_for_every_supported_chain(isolate_chain_env, code):
    spec = CHAIN_SPECS[code]
    receiving_address = "TSharedWallet" if code == "TRC20" else "shared-wallet"
    isolate_chain_env.setenv("USDC_PAY_ENABLED_CHAINS", code)
    isolate_chain_env.setenv(spec.address_env, receiving_address)

    meta = chain_metadata(code, "USDC")

    assert meta is not None
    assert meta["address"] == receiving_address
    assert meta["contract"] == USDC_TOKEN_DEFAULTS[code][0]
    assert meta["decimals"] == USDC_TOKEN_DEFAULTS[code][1]


@pytest.mark.parametrize("code", ["TRC20", "BEP20"])
def test_usdc_rejects_non_circle_native_or_discontinued_chains(isolate_chain_env, code):
    spec = CHAIN_SPECS[code]
    isolate_chain_env.setenv("USDC_PAY_ENABLED_CHAINS", code)
    isolate_chain_env.setenv(spec.address_env, "configured-wallet")

    assert chain_metadata(code, "USDC") is None
    assert list_enabled_chains("USDC") == []


# ---------------------------------------------------------------------------
# Amount display formatter
# ---------------------------------------------------------------------------


def test_format_amount_display_quantizes_to_decimals(monkeypatch):
    """The display formatter strips DB-padding (NUMERIC(20,8) -> 8 trailing
    digits) and pads short decimals up to ``suffix_decimals()``. Crucially
    the rendered amount must therefore have exactly ``suffix_decimals()``
    fractional digits, regardless of whether the value came from
    ``build_amount_with_suffix`` (already 6 digits) or from a DB round-trip
    (8 digits)."""
    monkeypatch.setenv("USDT_AMOUNT_SUFFIX_DECIMALS", "6")
    # DB-padded form
    assert format_amount_display(Decimal("19.90670000")) == "19.906700"
    # Already 6-digit form
    assert format_amount_display(Decimal("19.906700")) == "19.906700"
    # Integer base must still gain the suffix decimals
    assert format_amount_display(Decimal("20")) == "20.000000"
    assert format_amount_display(Decimal("19.9")) == "19.900000"
    # Strings flow through too (psycopg2 sometimes returns strings)
    assert format_amount_display("19.906700") == "19.906700"
    # Edge cases
    assert format_amount_display(None) == "0"
    assert format_amount_display("") == "0"


def test_full_amount_has_six_fractional_digits_for_typical_bases(monkeypatch):
    """End-to-end check: pick the three real plan prices and verify that
    every generated final amount renders with exactly 6 fractional digits.
    This is the regression test for the bug where ``base=19.9`` rendered
    as ``19.90 + 670000`` (8 fractional digits) because of NUMERIC(20,8)
    padding mixing into the display.
    """
    monkeypatch.setenv("USDT_AMOUNT_SUFFIX_DECIMALS", "6")
    for base in (Decimal("19.9"), Decimal("199"), Decimal("499"), Decimal("20")):
        for attempt in range(5):
            final, _ = build_amount_with_suffix(base, seed=b"plan", attempt=attempt)
            rendered = format_amount_display(final)
            _, _, frac = rendered.partition(".")
            assert len(frac) == 6, (
                f"base={base} attempt={attempt} rendered={rendered!r} (frac length {len(frac)})"
            )
