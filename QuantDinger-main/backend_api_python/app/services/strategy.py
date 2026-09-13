"""Persistence and lifecycle operations for deployed strategies."""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from app.utils.db import get_db_connection
from app.utils.logger import get_logger


logger = get_logger(__name__)
_service: Optional["StrategyService"] = None
MIN_STRATEGY_INVESTMENT_AMOUNT = 10.0
MAX_STRATEGY_INVESTMENT_AMOUNT = 1_000_000.0


def _strip_legacy_risk_pct_basis(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: _strip_legacy_risk_pct_basis(item)
            for key, item in value.items()
            if key not in {"risk_pct_basis", "riskPctBasis"}
        }
    if isinstance(value, list):
        return [_strip_legacy_risk_pct_basis(item) for item in value]
    return value


def validate_strategy_investment_amount(value: Any) -> float:
    try:
        amount = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("strategyV2.invalidInitialCapital") from exc
    if not MIN_STRATEGY_INVESTMENT_AMOUNT <= amount <= MAX_STRATEGY_INVESTMENT_AMOUNT:
        raise ValueError("strategyV2.invalidInitialCapital")
    return amount


def get_strategy_service() -> "StrategyService":
    global _service
    if _service is None:
        _service = StrategyService()
    return _service


_SECRET_KEYS = {
    "api_key", "apikey", "secret_key", "secretkey", "secret", "passphrase",
    "password", "private_key", "privatekey", "access_token", "accesstoken",
    "refresh_token", "refreshtoken", "bot_token", "bottoken", "webhook_secret",
    "webhooksecret", "signing_secret", "signingsecret", "client_secret", "clientsecret",
    "spot_broker_id", "spotbrokerid", "futures_broker_id", "futuresbrokerid",
    "broker_id", "brokerid", "broker_code", "brokercode", "channel_api_code",
    "channelapicode", "channel_code", "channelcode", "bybit_referer", "broker_referer", "brokerreferer",
    "gate_channel_id", "gatechannelid", "htx_spot_source", "htxspotsource",
}


def _secret_key(key: Any) -> bool:
    return str(key or "").replace("-", "_").lower() in _SECRET_KEYS


def _has_secret(value: Any) -> bool:
    if isinstance(value, dict):
        return any((_secret_key(key) and item not in (None, "", False)) or _has_secret(item) for key, item in value.items())
    if isinstance(value, list):
        return any(_has_secret(item) for item in value)
    return False


def reject_inline_strategy_secrets(exchange_config: Any) -> None:
    if not isinstance(exchange_config, dict):
        return
    if exchange_config.get("credential_id") or exchange_config.get("credentials_id"):
        return
    if _has_secret(exchange_config):
        raise ValueError("INLINE_STRATEGY_SECRETS_NOT_ALLOWED")


def strip_strategy_secrets(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: strip_strategy_secrets(item) for key, item in value.items() if not _secret_key(key)}
    if isinstance(value, list):
        return [strip_strategy_secrets(item) for item in value]
    return value


def redact_strategy_secrets(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: ("***" if _secret_key(key) and item not in (None, "", False) else redact_strategy_secrets(item))
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact_strategy_secrets(item) for item in value]
    return value


def redact_strategy_row(row: Dict[str, Any] | None) -> Dict[str, Any] | None:
    if not row:
        return row
    output = dict(row)
    for field in ("exchange_config", "trading_config", "notification_config"):
        if field in output:
            output[field] = redact_strategy_secrets(output[field])
    return output


class StrategyService:
    def get_running_strategies(self) -> List[Dict[str, Any]]:
        return self._query("status = 'running'", ())

    def get_running_strategies_with_type(self) -> List[Dict[str, Any]]:
        return self.get_running_strategies()

    def get_strategy_type(self, strategy_id: int) -> str:
        row = self.get_strategy(strategy_id)
        return str((row or {}).get("strategy_type") or "")

    def update_strategy_status(self, strategy_id: int, status: str, user_id: int | None = None) -> bool:
        if status not in {"running", "stopped"}:
            raise ValueError("strategyV2.invalidStatus")
        where = "id = ?"
        values: list[Any] = [status, int(strategy_id)]
        if user_id is not None:
            where += " AND user_id = ?"
            values.append(int(user_id))
        with get_db_connection() as db:
            cur = db.cursor()
            cur.execute(
                f"UPDATE qd_strategies_trading SET status = ?, updated_at = NOW() WHERE {where}",
                tuple(values),
            )
            changed = int(cur.rowcount or 0)
            if changed == 0:
                cur.execute(f"SELECT 1 FROM qd_strategies_trading WHERE {where} LIMIT 1", tuple(values[1:]))
                changed = 1 if cur.fetchone() else 0
            db.commit()
            cur.close()
        return changed > 0

    def list_strategies(self, user_id: int = 1) -> List[Dict[str, Any]]:
        return self._query("user_id = ?", (int(user_id),))

    def get_strategy(self, strategy_id: int, user_id: int | None = None) -> Optional[Dict[str, Any]]:
        where = "id = ?"
        values: list[Any] = [int(strategy_id)]
        if user_id is not None:
            where += " AND user_id = ?"
            values.append(int(user_id))
        rows = self._query(where, tuple(values))
        return rows[0] if rows else None

    def create_strategy(self, payload: Dict[str, Any]) -> int:
        from app.services.strategy_v2 import get_strategy_v2_deployment_service

        return get_strategy_v2_deployment_service().save(
            user_id=int(payload.get("user_id") or 0),
            payload=self._deployment_payload(payload),
        )

    def update_strategy(self, strategy_id: int, payload: Dict[str, Any], user_id: int | None = None) -> bool:
        existing = self.get_strategy(strategy_id, user_id=user_id)
        if not existing:
            return False
        from app.services.strategy_v2 import get_strategy_v2_deployment_service

        changes = self._deployment_payload(payload)
        merged = {
            "sourceId": (existing.get("trading_config") or {}).get("script_source_id"),
            "name": existing.get("strategy_name"),
            "initialCapital": existing.get("initial_capital"),
            "executionMode": existing.get("execution_mode"),
            "leverage": existing.get("leverage"),
            "leverageEnabled": float(existing.get("leverage") or 1) > 1,
            "params": (existing.get("trading_config") or {}).get("params") or {},
            "directionMode": (existing.get("trading_config") or {}).get("direction_mode") or "",
            "positionSide": (existing.get("trading_config") or {}).get("position_side") or "",
            "accountRisk": (existing.get("trading_config") or {}).get("account_risk") or {},
        }
        merged.update({key: value for key, value in changes.items() if value is not None})
        get_strategy_v2_deployment_service().save(
            user_id=int(existing.get("user_id") or user_id or 0),
            payload=merged,
            strategy_id=int(strategy_id),
        )
        return True

    def patch_trading_config(self, strategy_id: int, patch: Dict[str, Any], user_id: int | None = None) -> bool:
        allowed = {"params", "data_poll_seconds", "risk_tick_seconds", "position_mode", "position_ledger"}
        if set(patch) - allowed:
            raise ValueError("strategyV2.runtimeConfigFieldUnsupported")
        existing = self.get_strategy(strategy_id, user_id=user_id)
        if not existing:
            return False
        config = _strip_legacy_risk_pct_basis(dict(existing.get("trading_config") or {}))
        config.update(patch)
        config = _strip_legacy_risk_pct_basis(config)
        with get_db_connection() as db:
            cur = db.cursor()
            cur.execute(
                "UPDATE qd_strategies_trading SET trading_config = ?, updated_at = NOW() WHERE id = ? AND user_id = ?",
                (json.dumps(config, ensure_ascii=False), int(strategy_id), int(existing["user_id"])),
            )
            changed = int(cur.rowcount or 0)
            db.commit()
            cur.close()
        return changed > 0

    def delete_strategy(self, strategy_id: int, user_id: int | None = None) -> bool:
        where = "id = ?"
        values: list[Any] = [int(strategy_id)]
        if user_id is not None:
            where += " AND user_id = ?"
            values.append(int(user_id))
        with get_db_connection() as db:
            cur = db.cursor()
            cur.execute(f"DELETE FROM qd_strategies_trading WHERE {where}", tuple(values))
            changed = int(cur.rowcount or 0)
            db.commit()
            cur.close()
        return changed > 0

    def batch_start_strategies(self, strategy_ids: List[int], user_id: int | None = None) -> Dict[str, Any]:
        return self._batch_status(strategy_ids, "running", user_id)

    def batch_stop_strategies(self, strategy_ids: List[int], user_id: int | None = None) -> Dict[str, Any]:
        return self._batch_status(strategy_ids, "stopped", user_id)

    def batch_delete_strategies(self, strategy_ids: List[int], user_id: int | None = None) -> Dict[str, Any]:
        deleted = [int(item) for item in strategy_ids if self.delete_strategy(int(item), user_id=user_id)]
        return {"success": len(deleted) == len(strategy_ids), "deleted_ids": deleted}

    def get_exchange_symbols(self, exchange_config: Dict[str, Any], user_id: int = 1) -> Dict[str, Any]:
        from app.services.exchange_execution import resolve_exchange_config
        from app.services.live_trading.factory import create_client

        resolved = resolve_exchange_config(exchange_config, user_id=user_id)
        client = create_client(resolved, market_type=str(resolved.get("market_type") or "swap"))
        markets = client.get_markets() if hasattr(client, "get_markets") else []
        return {"success": True, "data": markets}

    def test_exchange_connection(self, exchange_config: Dict[str, Any], user_id: int = 1) -> Dict[str, Any]:
        try:
            from app.services.exchange_execution import resolve_exchange_config
            from app.services.live_trading.factory import create_client

            reject_inline_strategy_secrets(exchange_config)
            resolved = resolve_exchange_config(exchange_config, user_id=user_id)
            client = create_client(resolved, market_type=str(resolved.get("market_type") or "swap"))
            data = client.get_account_summary() if hasattr(client, "get_account_summary") else {}
            return {"success": True, "message": "strategyV2.connectionOk", "data": data}
        except Exception as exc:
            return {"success": False, "message": str(exc), "data": None}

    def _batch_status(self, strategy_ids: List[int], status: str, user_id: int | None) -> Dict[str, Any]:
        success_ids: list[int] = []
        failed_ids: list[dict[str, Any]] = []
        for item in strategy_ids:
            strategy_id = int(item)
            try:
                if self.update_strategy_status(strategy_id, status, user_id=user_id):
                    success_ids.append(strategy_id)
                else:
                    failed_ids.append({"id": strategy_id, "error": "status update affected 0 rows"})
            except Exception as exc:
                failed_ids.append({"id": strategy_id, "error": str(exc)})
        return {
            "success": True,
            "success_ids": success_ids,
            "failed_ids": failed_ids,
            "updated_ids": success_ids,
            "status": status,
        }

    @staticmethod
    def _deployment_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
        allowed = {
            "sourceId", "name", "initialCapital", "executionMode", "credentialId",
            "leverageEnabled", "leverage", "params", "notificationChannels",
            "notificationTargets", "directionMode", "positionSide",
            "accountRisk",
        }
        unsupported = set(payload) - allowed - {"user_id"}
        if unsupported:
            raise ValueError("strategyV2.unsupportedFields")
        return {
            key: payload[key]
            for key in allowed
            if key in payload
        }

    @staticmethod
    def _query(where: str, values: tuple[Any, ...]) -> List[Dict[str, Any]]:
        with get_db_connection() as db:
            cur = db.cursor()
            cur.execute(f"SELECT * FROM qd_strategies_trading WHERE {where} ORDER BY id DESC", values)
            rows = cur.fetchall() or []
            cur.close()
        output = []
        for row in rows:
            item = dict(row)
            for field in ("exchange_config", "trading_config", "notification_config"):
                item[field] = _json_object(item.get(field))
            item["trading_config"] = _strip_legacy_risk_pct_basis(item.get("trading_config") or {})
            output.append(item)
        return output


def _json_object(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            return dict(parsed) if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}
