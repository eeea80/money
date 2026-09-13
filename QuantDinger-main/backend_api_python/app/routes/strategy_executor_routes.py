"""Built-in executor strategy routes."""

from __future__ import annotations

import traceback

from flask import g, jsonify, request

from app.routes.strategy_blueprint import strategy_blp
from app.routes.strategy_services import get_strategy_service
from app.services.script_source import get_script_source_service
from app.services.strategy_runtime.executors import (
    build_executor_strategy_payload,
    executor_templates,
    preview_executor,
)
from app.services.strategy_v2.deployment import get_strategy_v2_deployment_service
from app.utils.auth import login_required
from app.utils.logger import get_logger


logger = get_logger(__name__)


@strategy_blp.route("/strategies/executors/templates", methods=["GET"])
@login_required
def get_executor_templates():
    try:
        return jsonify({"code": 1, "msg": "success", "data": executor_templates()})
    except Exception as exc:
        logger.error("get_executor_templates failed: %s", exc)
        return jsonify({"code": 0, "msg": str(exc), "data": {"items": []}}), 500


@strategy_blp.route("/strategies/executors/preview", methods=["POST"])
@login_required
def preview_executor_strategy():
    try:
        payload = request.get_json() or {}
        return jsonify({"code": 1, "msg": "success", "data": preview_executor(payload)})
    except Exception as exc:
        logger.error("preview_executor_strategy failed: %s", exc)
        logger.error(traceback.format_exc())
        return jsonify({"code": 0, "msg": str(exc), "data": None}), 400


@strategy_blp.route("/strategies/executors/generate", methods=["POST"])
@login_required
def generate_executor_strategy():
    try:
        payload = request.get_json() or {}
        user_id = int(g.user_id)
        strategy_payload = build_executor_strategy_payload(payload, user_id=user_id)
        return jsonify({
            "code": 1,
            "msg": "success",
            "data": {
                "strategy_name": strategy_payload["strategy_name"],
                "strategy_type": strategy_payload["strategy_type"],
                "template_key": strategy_payload["template_key"],
                "code": strategy_payload["code"],
                "market_category": strategy_payload["market_category"],
                "symbol": strategy_payload["symbol"],
                "timeframe": strategy_payload["timeframe"],
                "market_type": strategy_payload["market_type"],
                "trade_direction": strategy_payload["trade_direction"],
                "trading_config": strategy_payload["trading_config"],
                "metadata": strategy_payload["metadata"],
                "compatibility": strategy_payload["compatibility"],
            },
        })
    except Exception as exc:
        logger.error("generate_executor_strategy failed: %s", exc)
        logger.error(traceback.format_exc())
        return jsonify({"code": 0, "msg": str(exc), "data": None}), 400


@strategy_blp.route("/strategies/executors/create", methods=["POST"])
@login_required
def create_executor_strategy():
    try:
        payload = request.get_json() or {}
        user_id = int(g.user_id)
        strategy_payload = build_executor_strategy_payload(payload, user_id=user_id)
        source_id = get_script_source_service().create_source({
            "user_id": user_id,
            "name": strategy_payload["strategy_name"],
            "description": strategy_payload["description"],
            "code": strategy_payload["code"],
            "asset_type": strategy_payload["asset_type"],
            "template_key": strategy_payload["template_key"],
            "metadata": strategy_payload["metadata"],
            "status": "ready",
        })
        exchange_config = strategy_payload.get("exchange_config") or {}
        notification_config = strategy_payload.get("notification_config") or {}
        strategy_id = get_strategy_v2_deployment_service().save(
            user_id=user_id,
            payload={
                "sourceId": source_id,
                "name": strategy_payload["strategy_name"],
                "initialCapital": strategy_payload["initial_capital"],
                "executionMode": strategy_payload["execution_mode"],
                "credentialId": exchange_config.get("credential_id"),
                "leverageEnabled": strategy_payload["leverage_enabled"],
                "leverage": strategy_payload["leverage"],
                "positionSide": strategy_payload["trade_direction"],
                "strategyRuntimeConfig": strategy_payload["trading_config"],
                "notificationChannels": notification_config.get("channels") or [],
                "notificationTargets": notification_config.get("targets") or {},
            },
        )
        strategy = get_strategy_service().get_strategy(strategy_id, user_id=user_id) or {"id": strategy_id}
        return jsonify({
            "code": 1,
            "msg": "success",
            "data": {"id": strategy_id, "source_id": source_id, "strategy": strategy},
        })
    except Exception as exc:
        logger.error("create_executor_strategy failed: %s", exc)
        logger.error(traceback.format_exc())
        return jsonify({"code": 0, "msg": str(exc), "data": None}), 400
