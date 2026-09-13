"""Team mission contribution and result scoring."""

from __future__ import annotations

import json
from typing import Any


def _row_dict(row: Any) -> dict[str, Any]:
    return dict(row) if row is not None and not isinstance(row, dict) else (row or {})


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def contribution_score_for_message(message: Any) -> float:
    item = _row_dict(message)
    message_type = str(item.get("message_type") or "").lower()
    content = item.get("content") or ""
    length_bonus = min(len(content) / 400.0, 2.0)
    if message_type == "strategy":
        base = 4.0
    elif message_type == "discussion":
        base = 3.0
    elif message_type == "reply":
        base = 2.0
    else:
        base = 1.0
    return round(base + length_bonus, 4)


def contribution_score_for_submission(submission: Any) -> float:
    item = _row_dict(submission)
    confidence = _safe_float(item.get("confidence"), 0.0)
    content = item.get("content") or ""
    length_bonus = min(len(content) / 500.0, 2.5)
    confidence_bonus = max(0.0, min(confidence, 1.0)) * 3.0
    return round(6.0 + confidence_bonus + length_bonus, 4)


def score_team_results(
    mission: Any,
    teams: list[Any],
    members_by_team: dict[int, list[Any]],
    submissions_by_team: dict[int, list[Any]],
    contributions_by_team: dict[int, list[Any]],
) -> list[dict[str, Any]]:
    mission_data = _row_dict(mission)
    scored: list[dict[str, Any]] = []

    for team_row in teams:
        team = _row_dict(team_row)
        team_id = team["id"]
        members = [_row_dict(member) for member in members_by_team.get(team_id, [])]
        submissions = [_row_dict(submission) for submission in submissions_by_team.get(team_id, [])]
        contributions = [_row_dict(contribution) for contribution in contributions_by_team.get(team_id, [])]

        contribution_total = sum(_safe_float(item.get("contribution_score")) for item in contributions)
        contributor_count = len({item.get("agent_id") for item in contributions if item.get("agent_id")})
        member_count = max(1, len(members))
        quality_score = contribution_total / member_count
        prediction_score = 0.0
        if submissions:
            prediction_score = sum(max(0.0, min(_safe_float(item.get("confidence")), 1.0)) for item in submissions) / len(submissions) * 100.0
        consensus_gain = min(25.0, contributor_count * 2.5 + max(0, len(submissions) - 1) * 3.0)
        return_pct = sum(_safe_float(member.get("return_pct_30d")) for member in members) / member_count
        final_score = return_pct + (prediction_score * 0.2) + quality_score + consensus_gain

        metrics = {
            "member_count": len(members),
            "submission_count": len(submissions),
            "contribution_count": len(contributions),
            "contributor_count": contributor_count,
            "assignment_mode": mission_data.get("assignment_mode"),
            "formation_method": team.get("formation_method"),
            "contribution_total": contribution_total,
        }

        scored.append({
            "mission_id": mission_data.get("id"),
            "team_id": team_id,
            "return_pct": return_pct,
            "prediction_score": prediction_score,
            "quality_score": quality_score,
            "consensus_gain": consensus_gain,
            "final_score": final_score,
            "metrics": metrics,
        })

    scored.sort(key=lambda item: item["final_score"], reverse=True)
    for index, item in enumerate(scored, start=1):
        item["rank"] = index
        item["metrics_json"] = json.dumps(item["metrics"], ensure_ascii=False, sort_keys=True)
    return scored

