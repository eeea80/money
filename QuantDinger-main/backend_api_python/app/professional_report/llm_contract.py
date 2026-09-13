"""Strict schema boundary for the explanatory LLM response."""

from __future__ import annotations

from typing import Any, Literal, Mapping

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from .narrative import normalize_report_text


class AnalysisSections(BaseModel):
    model_config = ConfigDict(extra="forbid")

    technical: str = ""
    fundamental: str = ""
    sentiment: str = ""


class NarrativeClaim(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["thesis", "risk", "catalyst", "counter_argument"] = "thesis"
    text: str = Field(min_length=1)
    evidence_refs: list[str] = Field(default_factory=list)


class FastAnalysisNarrative(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: Literal["BUY", "SELL", "HOLD"] = "HOLD"
    confidence: int = Field(default=50, ge=0, le=100)
    summary: str = ""
    analysis: AnalysisSections = Field(default_factory=AnalysisSections)
    entry_price: float | None = Field(default=None, ge=0)
    stop_loss: float | None = Field(default=None, ge=0)
    take_profit: float | None = Field(default=None, ge=0)
    position_size_pct: int = Field(default=0, ge=0, le=100)
    timeframe: Literal["short", "medium", "long"] = "medium"
    key_reasons: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    evidence_claims: list[NarrativeClaim] = Field(default_factory=list)
    technical_score: int = Field(default=50, ge=0, le=100)
    fundamental_score: int = Field(default=50, ge=0, le=100)
    sentiment_score: int = Field(default=50, ge=0, le=100)

    @field_validator("decision", mode="before")
    @classmethod
    def normalise_decision(cls, value: Any) -> str:
        return str(value or "HOLD").upper()


_ALLOWED_FIELDS = set(FastAnalysisNarrative.model_fields)


def validate_llm_analysis(
    payload: Mapping[str, Any] | None,
    fallback: Mapping[str, Any],
    *,
    known_evidence_ids: set[str] | None = None,
) -> dict[str, Any]:
    """Validate/coerce the model payload and expose every repair made.

    Unknown top-level fields are removed before strict model validation but
    recorded.  If validation still fails, the deterministic fallback is used;
    a malformed model response never masquerades as a successful analysis.
    """
    source = dict(payload or {})
    warnings = [f"unknown_llm_field:{key}" for key in source if key not in _ALLOWED_FIELDS]
    clean = {key: value for key, value in source.items() if key in _ALLOWED_FIELDS}
    try:
        model = FastAnalysisNarrative.model_validate(clean)
        valid = True
    except ValidationError as exc:
        warnings.extend(
            "invalid_llm_field:" + ".".join(str(part) for part in error.get("loc") or ())
            for error in exc.errors()
        )
        fallback_clean = {key: value for key, value in dict(fallback).items() if key in _ALLOWED_FIELDS}
        model = FastAnalysisNarrative.model_validate(fallback_clean)
        valid = False

    result = model.model_dump(mode="json")
    known = known_evidence_ids or set()
    if known:
        filtered_claims = []
        for index, claim in enumerate(result["evidence_claims"]):
            refs = [ref for ref in claim["evidence_refs"] if ref in known]
            if len(refs) != len(claim["evidence_refs"]):
                warnings.append(f"claim_{index}_unknown_evidence_removed")
            if not refs:
                warnings.append(f"claim_{index}_dropped_without_evidence")
                continue
            filtered_claims.append({**claim, "evidence_refs": refs})
        result["evidence_claims"] = filtered_claims
    result["_llm_contract"] = {
        "valid": valid,
        "schema_version": "fast_analysis_narrative_v1",
        "warnings": sorted(set(warnings)),
    }
    return normalize_report_text(result)


__all__ = ["FastAnalysisNarrative", "validate_llm_analysis"]
