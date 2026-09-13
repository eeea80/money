"""Challenge API routes."""

from __future__ import annotations

from fastapi import FastAPI, Header, HTTPException

from challenges import (
    ChallengeError,
    ChallengeNotFound,
    cancel_challenge,
    create_challenge,
    create_challenge_trade,
    create_challenge_submission_vote,
    create_challenge_team,
    create_challenge_team_submission,
    create_challenge_team_trade,
    create_submission,
    get_agent_challenges,
    get_agent_challenge_portfolio,
    get_challenge,
    get_challenge_leaderboard,
    get_challenge_submissions,
    get_challenge_team_leaderboard,
    get_challenge_team_portfolio,
    get_challenge_team_submissions,
    join_challenge,
    join_challenge_team,
    list_challenge_teams,
    list_challenges,
    settle_challenge,
)
from experiment_notifications import (
    ExperimentNotificationError,
    build_experiment_target_rule,
    resolve_challenge_notification_targets,
    send_agent_notifications,
)
from permissions import require_admin
from routes_models import (
    ChallengeCreateRequest,
    ChallengeJoinRequest,
    ChallengeSubmissionVoteRequest,
    ChallengeTeamCreateRequest,
    ChallengeTeamJoinRequest,
    ChallengeTeamSubmissionRequest,
    ChallengeTradeRequest,
    ExperimentNotificationRequest,
    ChallengeSettleRequest,
    ChallengeSubmissionRequest,
)
from routes_shared import RouteContext
from services import _get_agent_by_token
from utils import _extract_token


def _to_http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, ChallengeNotFound):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, (ChallengeError, ExperimentNotificationError)):
        return HTTPException(status_code=400, detail=str(exc))
    return HTTPException(status_code=500, detail=f'Challenge request failed: {exc}')


def _require_agent(authorization: str | None) -> dict:
    token = _extract_token(authorization)
    agent = _get_agent_by_token(token)
    if not agent:
        raise HTTPException(status_code=401, detail='Invalid token')
    return agent


def _require_challenge_creator(challenge_key: str, agent_id: int) -> None:
    challenge = get_challenge(challenge_key)
    creator_id = challenge.get('created_by_agent_id')
    if creator_id and creator_id != agent_id:
        raise HTTPException(status_code=403, detail='Only the challenge creator can perform this action')


def register_challenge_routes(app: FastAPI, ctx: RouteContext) -> None:
    @app.get('/api/challenges')
    async def api_list_challenges(
        status: str | None = None,
        market: str | None = None,
        track: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ):
        try:
            return list_challenges(status=status, market=market or track, limit=limit, offset=offset)
        except Exception as exc:
            raise _to_http_error(exc)

    @app.post('/api/challenges')
    async def api_create_challenge(data: ChallengeCreateRequest, authorization: str = Header(None)):
        agent = require_admin(authorization)
        try:
            return create_challenge(data, agent['id'])
        except Exception as exc:
            raise _to_http_error(exc)

    @app.get('/api/challenges/me')
    async def api_my_challenges(authorization: str = Header(None)):
        agent = _require_agent(authorization)
        try:
            return get_agent_challenges(agent['id'])
        except Exception as exc:
            raise _to_http_error(exc)

    @app.get('/api/challenges/{challenge_key}/leaderboard')
    async def api_challenge_leaderboard(challenge_key: str):
        try:
            return get_challenge_leaderboard(challenge_key)
        except Exception as exc:
            raise _to_http_error(exc)

    @app.get('/api/challenges/{challenge_key}/team-leaderboard')
    async def api_challenge_team_leaderboard(challenge_key: str):
        try:
            return get_challenge_team_leaderboard(challenge_key)
        except Exception as exc:
            raise _to_http_error(exc)

    @app.get('/api/challenges/{challenge_key}/teams')
    async def api_challenge_teams(challenge_key: str):
        try:
            return list_challenge_teams(challenge_key)
        except Exception as exc:
            raise _to_http_error(exc)

    @app.get('/api/challenges/{challenge_key}/submissions')
    async def api_challenge_submissions(challenge_key: str, limit: int = 100, offset: int = 0):
        try:
            return get_challenge_submissions(challenge_key, limit=limit, offset=offset)
        except Exception as exc:
            raise _to_http_error(exc)

    @app.post('/api/challenges/{challenge_key}/join')
    async def api_join_challenge(
        challenge_key: str,
        data: ChallengeJoinRequest | None = None,
        authorization: str = Header(None),
    ):
        agent = _require_agent(authorization)
        try:
            return join_challenge(challenge_key, agent['id'], data)
        except Exception as exc:
            raise _to_http_error(exc)

    @app.post('/api/challenges/{challenge_key}/teams')
    async def api_create_challenge_team(
        challenge_key: str,
        data: ChallengeTeamCreateRequest,
        authorization: str = Header(None),
    ):
        agent = _require_agent(authorization)
        try:
            return create_challenge_team(challenge_key, agent['id'], data)
        except Exception as exc:
            raise _to_http_error(exc)

    @app.post('/api/challenges/{challenge_key}/teams/{team_id}/join')
    async def api_join_challenge_team(
        challenge_key: str,
        team_id: int,
        data: ChallengeTeamJoinRequest | None = None,
        authorization: str = Header(None),
    ):
        agent = _require_agent(authorization)
        try:
            return join_challenge_team(challenge_key, team_id, agent['id'], data)
        except Exception as exc:
            raise _to_http_error(exc)

    @app.post('/api/challenges/{challenge_key}/submit')
    async def api_submit_challenge(
        challenge_key: str,
        data: ChallengeSubmissionRequest,
        authorization: str = Header(None),
    ):
        agent = _require_agent(authorization)
        try:
            return create_submission(challenge_key, agent['id'], data)
        except Exception as exc:
            raise _to_http_error(exc)

    @app.get('/api/challenges/{challenge_key}/portfolio')
    async def api_challenge_portfolio(challenge_key: str, authorization: str = Header(None)):
        agent = _require_agent(authorization)
        try:
            return get_agent_challenge_portfolio(challenge_key, agent['id'])
        except Exception as exc:
            raise _to_http_error(exc)

    @app.get('/api/challenges/{challenge_key}/teams/{team_id}/portfolio')
    async def api_challenge_team_portfolio(challenge_key: str, team_id: int, authorization: str = Header(None)):
        agent = _require_agent(authorization)
        try:
            return get_challenge_team_portfolio(challenge_key, team_id, agent['id'])
        except Exception as exc:
            raise _to_http_error(exc)

    @app.get('/api/challenges/{challenge_key}/teams/{team_id}/submissions')
    async def api_challenge_team_submissions(
        challenge_key: str,
        team_id: int,
        limit: int = 100,
        offset: int = 0,
        authorization: str = Header(None),
    ):
        viewer_agent_id = None
        token = _extract_token(authorization)
        if token:
            agent = _get_agent_by_token(token)
            if not agent:
                raise HTTPException(status_code=401, detail='Invalid token')
            viewer_agent_id = agent['id']
        try:
            return get_challenge_team_submissions(
                challenge_key,
                team_id,
                viewer_agent_id=viewer_agent_id,
                limit=limit,
                offset=offset,
            )
        except Exception as exc:
            raise _to_http_error(exc)

    @app.post('/api/challenges/{challenge_key}/trade')
    async def api_challenge_trade(
        challenge_key: str,
        data: ChallengeTradeRequest,
        authorization: str = Header(None),
    ):
        agent = _require_agent(authorization)
        try:
            return create_challenge_trade(challenge_key, agent['id'], data)
        except Exception as exc:
            raise _to_http_error(exc)

    @app.post('/api/challenges/{challenge_key}/teams/{team_id}/trade')
    async def api_challenge_team_trade(
        challenge_key: str,
        team_id: int,
        data: ChallengeTradeRequest,
        authorization: str = Header(None),
    ):
        agent = _require_agent(authorization)
        try:
            return create_challenge_team_trade(challenge_key, team_id, agent['id'], data)
        except Exception as exc:
            raise _to_http_error(exc)

    @app.post('/api/challenges/{challenge_key}/teams/{team_id}/submissions')
    async def api_challenge_team_submission(
        challenge_key: str,
        team_id: int,
        data: ChallengeTeamSubmissionRequest,
        authorization: str = Header(None),
    ):
        agent = _require_agent(authorization)
        try:
            return create_challenge_team_submission(challenge_key, team_id, agent['id'], data)
        except Exception as exc:
            raise _to_http_error(exc)

    @app.post('/api/challenges/{challenge_key}/submissions/{submission_id}/vote')
    async def api_challenge_submission_vote(
        challenge_key: str,
        submission_id: int,
        data: ChallengeSubmissionVoteRequest,
        authorization: str = Header(None),
    ):
        agent = _require_agent(authorization)
        try:
            return create_challenge_submission_vote(challenge_key, submission_id, agent['id'], data)
        except Exception as exc:
            raise _to_http_error(exc)

    @app.post('/api/challenges/{challenge_key}/settle')
    async def api_settle_challenge(
        challenge_key: str,
        data: ChallengeSettleRequest | None = None,
        authorization: str = Header(None),
    ):
        agent = _require_agent(authorization)
        try:
            _require_challenge_creator(challenge_key, agent['id'])
            return settle_challenge(challenge_key, force=bool(data.force if data else False))
        except HTTPException:
            raise
        except Exception as exc:
            raise _to_http_error(exc)

    @app.post('/api/challenges/{challenge_key}/cancel')
    async def api_cancel_challenge(challenge_key: str, authorization: str = Header(None)):
        agent = _require_agent(authorization)
        try:
            return cancel_challenge(challenge_key, agent['id'])
        except Exception as exc:
            raise _to_http_error(exc)

    @app.post('/api/challenges/{challenge_key}/notify')
    async def api_notify_challenge(
        challenge_key: str,
        data: ExperimentNotificationRequest,
        authorization: str = Header(None),
    ):
        agent = _require_agent(authorization)
        try:
            challenge = get_challenge(challenge_key)
            experiment_key = challenge.get('experiment_key') or (data.data or {}).get('experiment_key') or ''
            targets = resolve_challenge_notification_targets(
                challenge_key,
                variant_key=data.variant_key,
                agent_ids=data.agent_ids,
                limit=data.limit,
            )
            target_rule = build_experiment_target_rule(
                experiment_key=experiment_key,
                variant_key=data.variant_key,
                agent_ids=data.agent_ids,
                limit=data.limit,
                challenge_key=challenge_key,
                target='challenge',
            )
            return await send_agent_notifications(
                ctx,
                targets,
                actor_agent_id=agent['id'],
                message_type=data.message_type,
                title=data.title,
                content=data.content,
                experiment_key=experiment_key or None,
                variant_key=data.variant_key,
                challenge_key=challenge_key,
                data=data.data,
                dry_run=data.dry_run,
                event_type='challenge_notification_sent',
                target_rule=target_rule,
            )
        except Exception as exc:
            raise _to_http_error(exc)

    @app.get('/api/challenges/{challenge_key}')
    async def api_get_challenge(challenge_key: str):
        try:
            return get_challenge(challenge_key)
        except Exception as exc:
            raise _to_http_error(exc)
