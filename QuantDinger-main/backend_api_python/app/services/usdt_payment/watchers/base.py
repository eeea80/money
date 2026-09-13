"""Watcher interface + factory."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Callable, Dict, Optional, Tuple


@dataclass
class IncomingTransfer:
    tx_hash: str
    block_timestamp_ms: int      # 0 when unknown
    from_addr: str
    to_addr: str
    value_smallest_unit: int     # raw on-chain value
    raw: Dict                    # original payload for audit logs

    def to_dict(self) -> Dict:
        return {
            "tx_hash": self.tx_hash,
            "block_timestamp": self.block_timestamp_ms,
            "from": self.from_addr,
            "to": self.to_addr,
            "value": self.value_smallest_unit,
        }


WatcherResult = Tuple[Optional[IncomingTransfer], str]

WatcherFn = Callable[[str, Decimal, Optional[datetime]], WatcherResult]


# Lazy registry. Filled by side-effect imports of the concrete modules
# below so we don't pay the cost of importing requests/etc at module load.
_REGISTRY: Dict[str, WatcherFn] = {}


def register(chain: str, fn: WatcherFn) -> None:
    _REGISTRY[chain.upper()] = fn


def get_watcher(chain: str) -> Optional[WatcherFn]:
    chain = (chain or "").upper()
    if chain not in _REGISTRY:
        # Concrete modules self-register on import.
        from . import tron, evm, solana  # noqa: F401
    return _REGISTRY.get(chain)
