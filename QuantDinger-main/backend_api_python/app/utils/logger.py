"""Logging utilities with structured output and request correlation."""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler

from app.observability.context import request_id_context


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        record.message = record.getMessage()
        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.message,
            "process_role": os.getenv("QD_PROCESS_ROLE", "legacy"),
            "request_id": request_id_context.get(),
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def _formatter() -> logging.Formatter:
    if os.getenv("LOG_FORMAT", "text").strip().lower() == "json":
        return JsonFormatter()
    return logging.Formatter(
        "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    )


def setup_logger() -> None:
    """Configure process logging once."""
    log_level = os.getenv("LOG_LEVEL", "INFO").upper()
    formatter = _formatter()
    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, log_level, logging.INFO))

    if not root_logger.handlers:
        stream_handler = logging.StreamHandler()
        stream_handler.setFormatter(formatter)
        root_logger.addHandler(stream_handler)
    else:
        for handler in root_logger.handlers:
            handler.setFormatter(formatter)

    logging.getLogger("werkzeug").setLevel(logging.WARNING)
    logging.getLogger("app.routes.kline").setLevel(logging.WARNING)
    logging.getLogger("app.services.usdt_payment_service").setLevel(logging.INFO)
    logging.getLogger("app.routes.billing").setLevel(logging.INFO)

    log_dir = os.getenv("LOG_DIR", "logs")
    os.makedirs(log_dir, exist_ok=True)
    role = os.getenv("QD_PROCESS_ROLE", "legacy").strip().lower() or "legacy"
    log_file = os.getenv("LOG_FILE", f"{role}.log")
    app_log_path = os.path.abspath(os.path.join(log_dir, log_file))

    for handler in root_logger.handlers:
        if (
            isinstance(handler, RotatingFileHandler)
            and getattr(handler, "baseFilename", "") == app_log_path
        ):
            return

    file_handler = RotatingFileHandler(
        app_log_path,
        maxBytes=int(os.getenv("LOG_MAX_BYTES", str(10 * 1024 * 1024))),
        backupCount=int(os.getenv("LOG_BACKUP_COUNT", "5")),
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    root_logger.addHandler(file_handler)


def get_logger(name: str) -> logging.Logger:
    """Return a named logger."""
    return logging.getLogger(name)
