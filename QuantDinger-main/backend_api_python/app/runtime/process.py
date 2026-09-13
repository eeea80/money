"""Lifecycle helpers shared by long-running process entrypoints."""

from __future__ import annotations

import signal
import threading
from collections.abc import Callable

from app.utils.logger import get_logger


logger = get_logger(__name__)


class ShutdownSignal:
    def __init__(self) -> None:
        self.event = threading.Event()

    def install(self) -> None:
        def handle(signum, _frame) -> None:
            logger.info("Shutdown signal received: %s", signum)
            self.event.set()

        for name in ("SIGINT", "SIGTERM"):
            signum = getattr(signal, name, None)
            if signum is not None:
                signal.signal(signum, handle)

    def wait(self, interval: float = 1.0) -> None:
        while not self.event.wait(interval):
            continue


def run_until_shutdown(start: Callable[[], None], stop: Callable[[], None] | None = None) -> None:
    shutdown = ShutdownSignal()
    shutdown.install()
    start()
    try:
        shutdown.wait()
    finally:
        if stop is not None:
            stop()
