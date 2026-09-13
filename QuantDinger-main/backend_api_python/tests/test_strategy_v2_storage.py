import copy
import unittest
from unittest.mock import patch

from app.services.strategy_v2.storage import (
    StrategyBacktestRepository,
    _compact_backtest_result,
    _normalize_backtest_result,
)
from app.utils.db_postgres import PostgresCursor


class _BulkCursor:
    def __init__(self):
        self.calls = []

    def executemany(self, query, rows):
        self.calls.append((query, list(rows)))


class _RawCursor:
    def __init__(self):
        self.calls = []

    def executemany(self, query, rows):
        self.calls.append((query, list(rows)))
        return "bulk-ok"


class _ListCursor:
    def __init__(self, rows):
        self.rows = rows
        self.query = ""

    def execute(self, query, _params):
        self.query = query

    def fetchall(self):
        return self.rows

    def close(self):
        pass


class _ListConnection:
    def __init__(self, rows):
        self.list_cursor = _ListCursor(rows)

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def cursor(self):
        return self.list_cursor


class StrategyV2StorageCompatibilityTests(unittest.TestCase):
    def test_history_list_uses_persisted_summary_without_loading_large_result_json(self):
        connection = _ListConnection([{
            "id": 22,
            "params_json": "{}",
            "manifest_json": '{"strategyType":"cta"}',
            "total_return": 1.25,
            "win_rate": 0.6,
            "total_trades": 4,
            "total_executions": 8,
            "result_status": "complete",
            "data_kind": "market",
            "benchmark_total_return": 0.9,
            "max_drawdown": -0.4,
            "sharpe_ratio": 1.2,
        }])

        with patch("app.services.strategy_v2.storage.get_db_connection", return_value=connection):
            rows = StrategyBacktestRepository().list_runs(user_id=7, limit=24)

        self.assertNotIn("result_json", connection.list_cursor.query.lower())
        self.assertEqual(rows[0]["total_return"], 1.25)
        self.assertEqual(rows[0]["max_drawdown"], -0.4)
        self.assertEqual(rows[0]["sharpe_ratio"], 1.2)
        self.assertEqual(rows[0]["manifest"], {"strategyType": "cta"})
        self.assertNotIn("result", rows[0])

    def test_backtest_details_are_persisted_in_complete_batches(self):
        cursor = _BulkCursor()
        result = {
            "closedTrades": [{
                "exit_time": "2026-01-02T00:00:00Z",
                "side": "long",
                "exit_price": 102,
                "quantity": 2,
                "profit": 4,
                "balance": 10004,
                "close_reason": "grid_exit",
            }],
            "equityCurve": [
                {"time": "2026-01-01T00:00:00Z", "value": 10000},
                {"time": "2026-01-02T00:00:00Z", "value": 10004},
            ],
        }

        StrategyBacktestRepository._persist_details(cursor, 8, 7, 6, result)

        self.assertEqual(len(cursor.calls), 2)
        self.assertEqual(len(cursor.calls[0][1]), 1)
        self.assertEqual(len(cursor.calls[1][1]), 2)
        self.assertEqual(cursor.calls[1][1][-1], (8, 2, "2026-01-02T00:00:00Z", 10004.0))

    def test_history_payload_is_compacted_and_duplicate_arrays_are_removed(self):
        rows = [{"time": f"2026-01-01T00:{index}:00Z", "value": index} for index in range(3000)]
        result = {
            "equityCurve": rows,
            "holdingSnapshots": rows,
            "orderLedger": rows * 2,
            "rawTrades": [{"id": index} for index in range(6000)],
            "trades": [{"id": index} for index in range(6000)],
        }

        compact = _compact_backtest_result(result)

        self.assertNotIn("rawTrades", compact)
        self.assertNotIn("trades", compact)
        self.assertLessEqual(len(compact["equityCurve"]), 2400)
        self.assertLessEqual(len(compact["holdingSnapshots"]), 1200)
        self.assertLessEqual(len(compact["orderLedger"]), 3000)
        self.assertLessEqual(len(compact["executions"]), 5000)
        self.assertLessEqual(len(compact["closedTrades"]), 5000)
        self.assertEqual(compact["equityCurve"][0], rows[0])
        self.assertEqual(compact["equityCurve"][-1], rows[-1])

    def test_trade_review_snapshots_keep_up_to_three_thousand_candles(self):
        candles = [{"time": index, "close": index} for index in range(3500)]

        compact = _compact_backtest_result({
            "reviewCandles": {
                "Crypto:ETH/USDT@swap": {
                    "timeframe": "1H",
                    "candles": candles,
                },
            },
        })

        snapshot = compact["reviewCandles"]["Crypto:ETH/USDT@swap"]
        self.assertEqual(len(snapshot["candles"]), 3000)
        self.assertEqual(snapshot["candles"][0], candles[500])
        self.assertEqual(compact["historyStorage"]["limits"]["reviewCandlesPerSymbol"], 3000)

    def test_history_curve_preserves_drawdown_peak_and_trough_after_recovery(self):
        rows = [{"time": index, "value": 100.0} for index in range(10000)]
        rows[1]["value"] = 150.0
        rows[2]["value"] = 75.0
        rows[-1]["value"] = 200.0
        result = {"initialCapital": 100.0, "maxDrawdown": -50.0, "equityCurve": rows}
        original = copy.deepcopy(result)

        compact = _compact_backtest_result(result)

        curve = compact["equityCurve"]
        self.assertIn(rows[1], curve)
        self.assertIn(rows[2], curve)
        peak, drawdown = 100.0, 0.0
        for point in curve:
            peak = max(peak, point["value"])
            drawdown = min(drawdown, (point["value"] / peak - 1) * 100)
        self.assertEqual(drawdown, compact["maxDrawdown"])
        self.assertLessEqual(len(curve), 2400)
        self.assertEqual(result, original)
        self.assertEqual(_compact_backtest_result(compact)["equityCurve"], curve)

    def test_history_curve_preserves_liquidation_time_and_preceding_equity(self):
        rows = [
            {"time": index, "value": 100.0 if index < 5001 else 0.0,
             "drawdown": 0.0 if index < 5001 else -100.0}
            for index in range(10000)
        ]

        curve = _compact_backtest_result({
            "initialCapital": 100.0, "equityCurve": rows,
            "maxDrawdown": -100.0, "liquidated": True,
        })["equityCurve"]

        self.assertIn(rows[5000], curve)
        self.assertIn(rows[5001], curve)
        self.assertEqual(next(point["time"] for point in curve if point["value"] == 0), 5001)
        self.assertEqual(curve[0], rows[0])
        self.assertEqual(curve[-1], rows[-1])
        self.assertLessEqual(len(curve), 2400)

    def test_postgres_cursor_bulk_path_converts_placeholders_without_returning_ids(self):
        raw = _RawCursor()
        cursor = PostgresCursor(raw)
        rows = [(1, 2), (3, 4)]

        with (
            patch("app.utils.db_postgres.HAS_PSYCOPG2", True),
            patch(
                "app.utils.db_postgres.execute_batch",
                return_value="bulk-ok",
                create=True,
            ) as bulk,
        ):
            result = cursor.executemany(
                "INSERT INTO sample (a, b) VALUES (?, ?)",
                rows,
            )

        self.assertEqual(result, "bulk-ok")
        bulk.assert_called_once_with(
            raw,
            "INSERT INTO sample (a, b) VALUES (%s, %s)",
            rows,
            page_size=1000,
        )
        self.assertEqual(raw.calls, [])

    def test_legacy_backtest_result_restores_overview_fields_from_executions(self):
        legacy = {
            "equityCurve": [
                {"time": "2025-01-01 00:00:00", "value": 9995.0},
                {"time": "2025-01-02 00:00:00", "value": 10089.9},
            ],
            "rawTrades": [
                {
                    "time": "2025-01-01 00:00:00",
                    "side": "buy",
                    "symbol": "Crypto:BTC/USDT@spot",
                    "quantity": 50,
                    "price": 100,
                    "commission": 5,
                },
                {
                    "time": "2025-01-02 00:00:00",
                    "side": "sell",
                    "symbol": "Crypto:BTC/USDT@spot",
                    "quantity": 50,
                    "price": 102,
                    "commission": 5.1,
                },
            ],
        }

        restored = _normalize_backtest_result(legacy, {
            "initial_capital": 10000,
            "start_date": "2025-01-01",
            "end_date": "2025-01-02",
            "leverage": 5,
            "commission": 0.001,
            "slippage": 0.002,
        })

        first, last = restored["equityCurve"]
        self.assertAlmostEqual(first["cash"], 4995)
        self.assertAlmostEqual(first["netExposure"], 5000 / 9995)
        self.assertAlmostEqual(first["grossExposure"], 5000 / 9995)
        self.assertAlmostEqual(last["cash"], 10089.9)
        self.assertAlmostEqual(last["netExposure"], 0)
        self.assertAlmostEqual(restored["attribution"]["feeDrag"], 10.1 / 10000)
        self.assertEqual(restored["attribution"]["orderStatus"], {
            "filled": 2,
            "partial": 0,
            "deferred": 0,
            "rejected": 0,
        })
        self.assertEqual(len(restored["orderLedger"]), 2)
        self.assertEqual(restored["executionAssumptions"], {
            "initialCapital": 10000,
            "startDate": "2025-01-01",
            "endDate": "2025-01-02",
            "leverageEnabled": True,
            "leverage": 5,
            "commission": 0.001,
            "slippage": 0.002,
        })
        self.assertTrue(restored["compatibility"]["legacyBackfill"])

    def test_current_backtest_result_keeps_saved_detail_values(self):
        current = {
            "initialCapital": 10000,
            "executionAssumptions": {
                "initialCapital": 10000,
                "startDate": "2025-01-01",
                "endDate": "2025-01-02",
                "leverageEnabled": False,
                "leverage": 1,
                "commission": 0.0005,
                "slippage": 0.0005,
            },
            "equityCurve": [{
                "time": "2025-01-01T00:00:00Z",
                "value": 10100,
                "cash": 2200,
                "grossExposure": 0.8,
                "netExposure": 0.6,
            }],
            "orderLedger": [{"orderId": "order-1", "status": "partial"}],
            "attribution": {
                "feeDrag": 0.0123,
                "orderStatus": {"filled": 0, "partial": 1, "deferred": 0, "rejected": 0},
            },
        }
        expected = copy.deepcopy(current)

        restored = _normalize_backtest_result(current, {
            "initial_capital": 5000,
            "start_date": "ignored",
            "end_date": "ignored",
            "leverage": 2,
            "commission": 0.1,
            "slippage": 0.1,
        })

        self.assertEqual(restored, expected)
        self.assertNotIn("compatibility", restored)

    def test_legacy_negative_equity_continuation_is_flagged_for_rerun(self):
        restored = _normalize_backtest_result({
            "equityCurve": [
                {"time": "2025-01-01", "value": 10000},
                {"time": "2025-01-02", "value": -100},
                {"time": "2025-01-03", "value": -500},
            ],
        }, {
            "initial_capital": 10000,
            "leverage": 5,
        })

        self.assertTrue(restored["legacyInsolventContinuation"])
        self.assertIn(
            "legacyInsolventContinuation",
            restored["compatibility"]["backfilledFields"],
        )


if __name__ == "__main__":
    unittest.main()
