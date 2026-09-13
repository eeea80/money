"""Content-addressed market-data snapshots for reproducible backtests."""

from __future__ import annotations

import gzip
import hashlib
import json
import os
from pathlib import Path
from typing import Any

import pandas as pd


SNAPSHOT_COLUMNS = ("open", "high", "low", "close", "volume")


class MarketDataSnapshotStore:
    def __init__(self, root: Path | str | None = None) -> None:
        configured = root or os.getenv("BACKTEST_SNAPSHOT_DIR") or "data/backtest_snapshots"
        self.root = Path(configured)

    def save(self, frame: pd.DataFrame) -> dict[str, Any]:
        payload = canonical_frame_bytes(frame)
        snapshot_id = hashlib.sha256(payload).hexdigest()
        self.root.mkdir(parents=True, exist_ok=True)
        target = self.root / f"{snapshot_id}.json.gz"
        if not target.exists():
            temporary = target.with_suffix(".tmp")
            with gzip.open(temporary, "wb", compresslevel=6) as handle:
                handle.write(payload)
            os.replace(temporary, target)
        return {
            "snapshotId": snapshot_id,
            "snapshotFormat": "strategy-v2-ohlcv-json-gzip-v1",
        }

    def load(self, snapshot_id: str) -> pd.DataFrame:
        normalized = str(snapshot_id or "").strip().lower()
        if len(normalized) != 64 or any(character not in "0123456789abcdef" for character in normalized):
            raise ValueError("strategyV2.snapshotIdInvalid")
        path = self.root / f"{normalized}.json.gz"
        with gzip.open(path, "rb") as handle:
            payload = handle.read()
        if hashlib.sha256(payload).hexdigest() != normalized:
            raise ValueError("strategyV2.snapshotHashMismatch")
        document = json.loads(payload.decode("utf-8"))
        columns = [str(item) for item in document["columns"]]
        rows = document["rows"]
        index = pd.to_datetime([int(row[0]) for row in rows], unit="ns")
        return pd.DataFrame(
            [[float(value) for value in row[1:]] for row in rows],
            index=index,
            columns=columns,
        )


def canonical_frame_bytes(frame: pd.DataFrame) -> bytes:
    columns = [column for column in SNAPSHOT_COLUMNS if column in frame.columns]
    normalized = frame.loc[:, columns].copy().sort_index()
    normalized = normalized[~normalized.index.duplicated(keep="last")]
    rows = []
    for timestamp, values in normalized.iterrows():
        rows.append([
            int(pd.Timestamp(timestamp).value),
            *[float(values[column]) for column in columns],
        ])
    return json.dumps(
        {"columns": columns, "rows": rows},
        ensure_ascii=True,
        allow_nan=False,
        separators=(",", ":"),
    ).encode("utf-8")
