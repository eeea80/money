"""Local desktop broker policy for IBKR."""

from __future__ import annotations

import os


def local_desktop_brokers_allowed() -> bool:
    """When False, IBKR credential creation and related flows are rejected."""
    v = os.getenv("ALLOW_LOCAL_DESKTOP_BROKERS", "true").strip().lower()
    return v in ("1", "true", "yes", "on")


def desktop_broker_cloud_reject_message() -> str:
    return (
        "This server has disabled IBKR local desktop broker access "
        "(requires local TWS or IB Gateway). Deploy QuantDinger on your own "
        "machine or private server and install IBKR TWS/Gateway."
    )
