"""Narrative safety and evidence-reference validation."""

from __future__ import annotations

import re
import unicodedata
from typing import Any, Iterable, Mapping


_MOJIBAKE = (
    "\u00ef\u00bf\u00bd",
    "\u00e2\u20ac\u201d",
    "\u00e2\u20ac\u201c",
    "\u00e2\u20ac\u2122",
    "\u951f\u65a4\u62f7",
    "\ufffd",
)


def normalize_report_text(value: Any) -> Any:
    """Normalize Unicode and replace known mojibake without changing numbers."""
    if isinstance(value, str):
        text = unicodedata.normalize("NFKC", value).replace("\x00", "")
        replacements = {
            "\u00e2\u20ac\u201d": "—",
            "\u00e2\u20ac\u201c": "–",
            "\u00e2\u20ac\u2122": "’",
            "\u00ef\u00bf\u00bd": "",
        }
        for broken, fixed in replacements.items():
            text = text.replace(broken, fixed)
        return text.replace("\ufffd", "").strip()
    if isinstance(value, dict):
        return {key: normalize_report_text(item) for key, item in value.items()}
    if isinstance(value, list):
        return [normalize_report_text(item) for item in value]
    return value


def has_mojibake(text: str) -> bool:
    return any(token in str(text or "") for token in _MOJIBAKE)


def validate_evidence_claims(
    claims: Iterable[Mapping[str, Any]],
    observations: Iterable[Mapping[str, Any]],
) -> list[str]:
    """Return validation errors; ungrounded claims are never silently accepted."""
    known = {str(item.get("evidence_id")) for item in observations if item.get("evidence_id")}
    errors: list[str] = []
    for index, claim in enumerate(claims):
        text = str(claim.get("text") or "").strip()
        refs = [str(ref) for ref in claim.get("evidence_refs") or []]
        if not text:
            errors.append(f"claim_{index}_empty")
        if not refs:
            errors.append(f"claim_{index}_missing_evidence")
        missing = [ref for ref in refs if ref not in known]
        if missing:
            errors.append(f"claim_{index}_unknown_evidence:{','.join(missing)}")
        if has_mojibake(text):
            errors.append(f"claim_{index}_mojibake")
    return errors


def numeric_tokens(text: str) -> list[float]:
    """Expose numeric tokens for product-level factual consistency audits."""
    tokens = []
    for raw in re.findall(r"(?<![\w])[-+]?\d+(?:,\d{3})*(?:\.\d+)?", str(text or "")):
        try:
            tokens.append(float(raw.replace(",", "")))
        except ValueError:
            continue
    return tokens


__all__ = ["has_mojibake", "normalize_report_text", "numeric_tokens", "validate_evidence_claims"]
