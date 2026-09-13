"""Redis endpoint builders for cache and durable job workloads."""

from __future__ import annotations

import os
from urllib.parse import quote


def _build_url(host: str, port: str, database: int, password: str = "") -> str:
    auth = f":{quote(password, safe='')}@" if password else ""
    return f"redis://{auth}{host}:{port}/{database}"


def cache_redis_url() -> str:
    explicit = os.getenv("REDIS_URL", "").strip()
    if explicit:
        return explicit
    return _build_url(
        os.getenv("REDIS_HOST", "localhost"),
        os.getenv("REDIS_PORT", "6379"),
        int(os.getenv("REDIS_DB", "0")),
        os.getenv("REDIS_PASSWORD", "").strip(),
    )


def celery_broker_url() -> str:
    explicit = os.getenv("CELERY_BROKER_URL", "").strip()
    if explicit:
        return explicit
    return _build_url(
        os.getenv("CELERY_REDIS_HOST", os.getenv("REDIS_HOST", "localhost")),
        os.getenv("CELERY_REDIS_PORT", "6379"),
        int(os.getenv("CELERY_BROKER_DB", "0")),
        os.getenv("CELERY_REDIS_PASSWORD", os.getenv("REDIS_PASSWORD", "")).strip(),
    )


def celery_result_backend_url() -> str:
    explicit = os.getenv("CELERY_RESULT_BACKEND", "").strip()
    if explicit:
        return explicit
    return _build_url(
        os.getenv("CELERY_REDIS_HOST", os.getenv("REDIS_HOST", "localhost")),
        os.getenv("CELERY_REDIS_PORT", "6379"),
        int(os.getenv("CELERY_RESULT_DB", "1")),
        os.getenv("CELERY_REDIS_PASSWORD", os.getenv("REDIS_PASSWORD", "")).strip(),
    )


def cache_key(key: str) -> str:
    namespace = os.getenv("REDIS_CACHE_NAMESPACE", "quantdinger:cache:v1").strip().strip(":")
    return f"{namespace}:{key}" if namespace else key
