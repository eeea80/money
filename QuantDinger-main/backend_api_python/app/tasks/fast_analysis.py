"""Durable fast-analysis task."""

from __future__ import annotations

from app.celery_app import celery_app


@celery_app.task(name="quantdinger.tasks.fast_analysis", acks_late=True)
def execute_fast_analysis(*args, **kwargs) -> None:
    from app.services.fast_analysis_tasks import run_async_analysis_task

    run_async_analysis_task(*args, **kwargs)
