"""Short, resumable units of fundamental synchronization on the maintenance queue."""
from app.celery_app import celery_app


@celery_app.task(name='quantdinger.tasks.fundamental_sync_tick', soft_time_limit=150, time_limit=180)
def fundamental_sync_tick():
    from app.services.fundamental_sync import enqueue_scheduled, run_one
    enqueue_scheduled()
    completed = run_one()
    if completed:
        fundamental_sync_tick.apply_async(countdown=2)
    return dict(processed=completed)
