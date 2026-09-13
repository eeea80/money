"""Decision guardrails shared by the fast-analysis orchestration."""

from typing import Any, Dict


def should_override_with_consensus(
    consensus_decision: str,
    consensus_abs: float,
    min_abs_override: float,
) -> bool:
    """Only directional consensus may replace the model's decision."""
    decision = str(consensus_decision or "HOLD").upper()
    return decision in ("BUY", "SELL") and float(consensus_abs) >= float(min_abs_override)


def direction_supported_by_consensus(analysis: Dict[str, Any], decision: str) -> bool:
    """Return whether a directional decision is confirmed by objective consensus."""
    normalized = str(decision or "HOLD").upper()
    if normalized not in ("BUY", "SELL"):
        return False
    consensus = analysis.get("consensus") or {}
    return str(consensus.get("consensus_decision") or "HOLD").upper() == normalized
