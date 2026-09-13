import pandas as pd

from app.services.strategy_v2.snapshot import MarketDataSnapshotStore, canonical_frame_bytes


def test_snapshot_round_trip_is_content_addressed_and_exact(tmp_path):
    index = pd.date_range("2026-01-01", periods=3, freq="4h")
    frame = pd.DataFrame({
        "open": [100.1, 101.2, 102.3],
        "high": [101.1, 102.2, 103.3],
        "low": [99.1, 100.2, 101.3],
        "close": [100.8, 101.9, 102.7],
        "volume": [10.0, 11.0, 12.0],
    }, index=index)
    store = MarketDataSnapshotStore(tmp_path)

    first = store.save(frame)
    second = store.save(frame.copy())
    restored = store.load(first["snapshotId"])

    assert first == second
    assert canonical_frame_bytes(restored) == canonical_frame_bytes(frame)
    assert len(list(tmp_path.glob("*.json.gz"))) == 1
