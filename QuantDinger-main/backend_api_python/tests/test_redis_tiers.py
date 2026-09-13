from app.config.redis_urls import (
    cache_key,
    cache_redis_url,
    celery_broker_url,
    celery_result_backend_url,
)


def test_cache_and_job_redis_use_separate_endpoints(monkeypatch):
    monkeypatch.setenv("REDIS_HOST", "cache")
    monkeypatch.setenv("REDIS_PASSWORD", "cache password")
    monkeypatch.setenv("CELERY_REDIS_HOST", "jobs")
    monkeypatch.setenv("CELERY_REDIS_PASSWORD", "jobs/password")
    monkeypatch.setenv("CELERY_BROKER_DB", "2")
    monkeypatch.setenv("CELERY_RESULT_DB", "3")
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.delenv("CELERY_BROKER_URL", raising=False)
    monkeypatch.delenv("CELERY_RESULT_BACKEND", raising=False)

    assert cache_redis_url() == "redis://:cache%20password@cache:6379/0"
    assert celery_broker_url() == "redis://:jobs%2Fpassword@jobs:6379/2"
    assert celery_result_backend_url() == "redis://:jobs%2Fpassword@jobs:6379/3"


def test_explicit_redis_urls_take_precedence(monkeypatch):
    monkeypatch.setenv("REDIS_URL", "redis://cache.example/4")
    monkeypatch.setenv("CELERY_BROKER_URL", "redis://jobs.example/5")
    monkeypatch.setenv("CELERY_RESULT_BACKEND", "redis://jobs.example/6")

    assert cache_redis_url() == "redis://cache.example/4"
    assert celery_broker_url() == "redis://jobs.example/5"
    assert celery_result_backend_url() == "redis://jobs.example/6"


def test_cache_key_has_versioned_namespace(monkeypatch):
    monkeypatch.delenv("REDIS_CACHE_NAMESPACE", raising=False)
    assert cache_key("market:BTCUSDT") == "quantdinger:cache:v1:market:BTCUSDT"

    monkeypatch.setenv("REDIS_CACHE_NAMESPACE", "tenant-a:v2")
    assert cache_key("market:BTCUSDT") == "tenant-a:v2:market:BTCUSDT"
