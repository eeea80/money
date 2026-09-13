"""Scheduler process entrypoint."""

from __future__ import annotations

import os


def main() -> None:
    os.environ["QD_PROCESS_ROLE"] = "scheduler"

    from app import create_app
    from app.runtime.process import ShutdownSignal
    from app.startup import _start_scheduler_services
    from app.services.strategy_command_repository import StrategyCommandRepository
    from app.workers.trading import build_worker_id

    app = create_app(register_http_routes=False)
    shutdown = ShutdownSignal()
    shutdown.install()
    repository = StrategyCommandRepository()
    worker_id = build_worker_id()
    lease_key = "scheduler-global-services"
    lease_seconds = max(10, int(os.getenv("SCHEDULER_LEASE_SEC", "30")))
    leader = False
    with app.app_context():
        try:
            while not shutdown.event.is_set():
                if not leader:
                    leader = repository.acquire_process_lease(
                        lease_key=lease_key,
                        owner_id=worker_id,
                        lease_seconds=lease_seconds,
                    )
                    if leader:
                        _start_scheduler_services()
                else:
                    leader = repository.renew_process_lease(
                        lease_key=lease_key,
                        owner_id=worker_id,
                        lease_seconds=lease_seconds,
                    )
                    if not leader:
                        break
                repository.record_worker_heartbeat(
                    worker_id=worker_id,
                    role="scheduler",
                    metadata={"leader": leader},
                )
                shutdown.event.wait(10)
        finally:
            if leader:
                repository.release_process_lease(lease_key=lease_key, owner_id=worker_id)
            repository.mark_worker_stopped(worker_id)


if __name__ == "__main__":
    main()
