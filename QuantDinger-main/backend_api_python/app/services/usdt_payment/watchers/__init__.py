"""
Per-chain incoming-transfer scanners.

Each watcher exposes the same interface:

    find_incoming(
        address: str,
        amount: Decimal,
        created_at: datetime | None,
    ) -> tuple[dict | None, str]

Returns (tx_dict, debug_note). On match, ``tx_dict`` carries at least:
    {
        "tx_hash":        str,
        "block_timestamp": int (ms since epoch, may be 0 if unknown),
        "from":           str,
        "to":             str,
        "value":          int (smallest unit),
    }

Watchers do their HTTP work outside any DB transaction; the caller
(reconciler) is responsible for opening short write txns for state changes.
"""

from .base import IncomingTransfer, WatcherResult, get_watcher

__all__ = ["IncomingTransfer", "WatcherResult", "get_watcher"]
