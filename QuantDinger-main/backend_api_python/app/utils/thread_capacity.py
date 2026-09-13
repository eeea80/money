"""Small, dependency-free diagnostics for process and thread capacity."""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Dict, Optional


def _read_first(paths: tuple[str, ...]) -> Optional[str]:
    for raw_path in paths:
        try:
            value = Path(raw_path).read_text(encoding="utf-8").strip()
        except (OSError, UnicodeError):
            continue
        if value:
            return value
    return None


def thread_capacity_snapshot() -> Dict[str, object]:
    """Return cgroup PID/memory counters plus Python's active thread count."""
    return {
        "python_threads": threading.active_count(),
        "pids_current": _read_first(
            ("/sys/fs/cgroup/pids.current", "/sys/fs/cgroup/pids/pids.current")
        ),
        "pids_max": _read_first(
            ("/sys/fs/cgroup/pids.max", "/sys/fs/cgroup/pids/pids.max")
        ),
        "memory_current": _read_first(
            ("/sys/fs/cgroup/memory.current", "/sys/fs/cgroup/memory/memory.usage_in_bytes")
        ),
        "memory_max": _read_first(
            ("/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes")
        ),
    }


def format_thread_capacity() -> str:
    """Format the counters for actionable runtime error messages."""
    values = thread_capacity_snapshot()
    return (
        f"python_threads={values['python_threads']}, "
        f"pids={values['pids_current'] or '?'}"
        f"/{values['pids_max'] or '?'}, "
        f"memory={values['memory_current'] or '?'}"
        f"/{values['memory_max'] or '?'}"
    )
