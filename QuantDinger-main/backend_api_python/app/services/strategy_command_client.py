"""Executor-compatible client that sends lifecycle commands to trading workers."""

from __future__ import annotations

import os
import threading
import time

from app.services.strategy_command_repository import (
    TERMINAL_COMMAND_STATUSES,
    StrategyCommandRepository,
)
from app.utils.logger import get_logger


logger = get_logger(__name__)


class StrategyCommandClient:
    def __init__(self, repository: StrategyCommandRepository | None = None) -> None:
        self.repository = repository or StrategyCommandRepository()
        self._last_commands: dict[tuple[int, str], int] = {}
        self._lock = threading.Lock()
        self._last_start_failure = ""

    def start_strategy(self, strategy_id: int) -> bool:
        try:
            command = self.repository.enqueue(strategy_id=int(strategy_id), command_type="start")
            self._remember(strategy_id, "start", command.id)
            self._last_start_failure = ""
            logger.info("Strategy start queued: strategy=%s command=%s", strategy_id, command.id)
            return True
        except Exception as exc:
            self._last_start_failure = str(exc)
            logger.error("Failed to queue strategy start: strategy=%s", strategy_id, exc_info=True)
            return False

    def wait_strategy_running(self, strategy_id: int, timeout: float = 3.0) -> tuple[bool, str]:
        command_id = self._recall(strategy_id, "start")
        if command_id is None:
            return False, "No durable start command was created."
        command = self._wait(command_id, timeout)
        if command is None:
            return False, "Strategy start command was not found."
        if command.status == "succeeded":
            return True, ""
        if command.status == "failed":
            return False, command.error_message or "Trading worker failed to start the strategy."
        logger.info(
            "Strategy start accepted and remains asynchronous: strategy=%s command=%s status=%s",
            strategy_id,
            command.id,
            command.status,
        )
        return True, "strategyV2.startQueued"

    def stop_strategy(self, strategy_id: int, *, persist_status: bool = True) -> bool:
        del persist_status
        result = self.stop_strategy_with_policy(strategy_id, close_positions=False)
        return bool(result.get("success"))

    def is_running(self, strategy_id: int) -> bool:
        return bool(self.repository.has_active_strategy_lease(int(strategy_id)))

    def stop_strategy_with_policy(
        self,
        strategy_id: int,
        *,
        close_positions: bool = False,
    ) -> dict:
        try:
            command = self.repository.enqueue(
                strategy_id=int(strategy_id),
                command_type="stop",
                payload={"close_positions": bool(close_positions)},
            )
            self._remember(strategy_id, "stop", command.id)
            queued = {
                "success": True,
                "status": "stopping",
                "command_id": command.id,
                "close_requested": bool(command.payload.get("close_positions")),
                "close_orders_queued": 0,
                "close_errors": [],
            }
            timeout = max(0.0, float(os.getenv("STRATEGY_COMMAND_STOP_WAIT_SEC", "5")))
            if timeout == 0:
                return queued
            finished = self._wait(command.id, timeout)
            if finished is None or finished.status not in TERMINAL_COMMAND_STATUSES:
                logger.warning(
                    "Strategy stop remains queued: strategy=%s command=%s",
                    strategy_id,
                    command.id,
                )
                return queued
            if finished.status == "succeeded":
                result = dict(finished.result or {})
                result.setdefault("success", True)
                result.setdefault("command_id", command.id)
                result.setdefault("status", "stopped")
                result.setdefault("close_requested", bool(close_positions))
                result.setdefault("close_orders_queued", 0)
                result.setdefault("close_errors", [])
                return result
            return {
                "success": False,
                "status": "running",
                "command_id": command.id,
                "close_requested": bool(close_positions),
                "close_orders_queued": 0,
                "close_errors": [finished.error_message] if finished.error_message else [],
            }
        except Exception as exc:
            logger.error("Failed to queue strategy stop: strategy=%s", strategy_id, exc_info=True)
            return {
                "success": False,
                "status": "running",
                "close_requested": bool(close_positions),
                "close_orders_queued": 0,
                "close_errors": [str(exc)],
            }

    def _wait(self, command_id: int, timeout: float):
        deadline = time.monotonic() + max(0.0, float(timeout))
        interval = max(0.05, float(os.getenv("STRATEGY_COMMAND_POLL_SEC", "0.2")))
        while True:
            command = self.repository.get(command_id)
            if command is None or command.status in TERMINAL_COMMAND_STATUSES:
                return command
            if time.monotonic() >= deadline:
                return command
            time.sleep(min(interval, max(0.0, deadline - time.monotonic())))

    def _remember(self, strategy_id: int, command_type: str, command_id: int) -> None:
        with self._lock:
            self._last_commands[(int(strategy_id), command_type)] = int(command_id)

    def _recall(self, strategy_id: int, command_type: str) -> int | None:
        with self._lock:
            return self._last_commands.get((int(strategy_id), command_type))
