"""KPI aggregation helpers for marketplace backtest evidence."""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Tuple

from app.utils.logger import get_logger

logger = get_logger(__name__)


def _score_result(result: Dict[str, Any]) -> float:
    trades = float(result.get("totalTrades") or 0)
    if trades <= 0:
        return 0.0
    total_return = float(result.get("totalReturn") or 0)
    sharpe = float(result.get("sharpeRatio") or 0)
    drawdown = abs(float(result.get("maxDrawdown") or 0))
    win_rate = float(result.get("winRate") or 0)
    score = 50 + total_return * 0.2 + sharpe * 10 + win_rate * 0.1 - drawdown * 0.25
    return max(0.0, min(100.0, score))


def parse_backtest_result(raw: str) -> Optional[Dict[str, Any]]:
    """Decode a backtest result JSON string."""
    if not raw or not isinstance(raw, str):
        return None
    try:
        result = json.loads(raw)
        return result if isinstance(result, dict) else None
    except (json.JSONDecodeError, TypeError, ValueError):
        return None


def summarise_backtest_runs(runs: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Aggregate successful backtest runs into a representative KPI block.

    The displayed KPIs intentionally come from the same representative
    backtest as the equity curve. This keeps marketplace cards, detail
    numbers, symbol/timeframe labels, and the curve from telling different
    stories.
    """
    empty = {
        "score": 0.0,
        "total_return": 0.0,
        "annual_return": 0.0,
        "sharpe": 0.0,
        "max_drawdown": 0.0,
        "win_rate": 0.0,
        "profit_factor": 0.0,
        "profit_loss_ratio": 0.0,
        "winning_trades": 0,
        "losing_trades": 0,
        "sample_size": 0,
        "best_run_id": None,
        "symbols": [],
        "timeframes": [],
    }
    if not runs:
        return empty

    scored: List[Tuple[float, int, Dict[str, Any]]] = []
    symbols: List[str] = []
    timeframes: List[str] = []

    for run in runs:
        result = parse_backtest_result(run.get("result_json"))
        if not result:
            continue
        try:
            score_val = _score_result(result)
        except Exception:
            logger.debug("score_result failed for run %s", run.get("id"), exc_info=True)
            score_val = 0.0

        scored.append((score_val, int(run.get("id") or 0), result))

        symbol = (run.get("symbol") or "").strip()
        timeframe = (run.get("timeframe") or "").strip()
        if symbol:
            symbols.append(symbol)
        if timeframe:
            timeframes.append(timeframe)

    if not scored:
        return empty

    def dedupe(values: List[str]) -> List[str]:
        seen = set()
        output = []
        for value in values:
            if value and value not in seen:
                seen.add(value)
                output.append(value)
        return output

    best = max(scored, key=lambda item: (item[0], item[1]))
    best_score, best_run_id, best_result = best
    annual_return = best_result.get("annualizedReturn")
    if annual_return is None:
        annual_return = best_result.get("annualReturn")
    if annual_return is None:
        annual_return = best_result.get("annual_return")
    profit_loss_ratio = best_result.get("profitLossRatio")
    if profit_loss_ratio is None:
        profit_loss_ratio = best_result.get("profit_loss_ratio")
    if profit_loss_ratio is None:
        average_win = float(best_result.get("avgWin") or best_result.get("avg_win") or 0)
        average_loss = abs(float(best_result.get("avgLoss") or best_result.get("avg_loss") or 0))
        profit_loss_ratio = average_win / average_loss if average_loss > 0 else 0.0
    return {
        "score": round(float(best_score or 0), 2),
        "total_return": round(float(best_result.get("totalReturn") or 0), 2),
        "annual_return": round(float(annual_return or 0), 2),
        "sharpe": round(float(best_result.get("sharpeRatio") or 0), 2),
        "max_drawdown": round(float(best_result.get("maxDrawdown") or 0), 2),
        "win_rate": round(float(best_result.get("winRate") or 0), 2),
        "profit_factor": round(float(best_result.get("profitFactor") or 0), 2),
        # Payoff ratio is average winning trade / average losing trade. Keep it
        # separate from profit factor (gross profit / gross loss): the latter
        # can become extremely large when a run contains only one tiny loss.
        "profit_loss_ratio": round(float(profit_loss_ratio or 0), 2),
        "winning_trades": int(best_result.get("winningTrades") or best_result.get("winning_trades") or 0),
        "losing_trades": int(best_result.get("losingTrades") or best_result.get("losing_trades") or 0),
        "sample_size": len(scored),
        "best_run_id": best_run_id or None,
        "symbols": dedupe(symbols),
        "timeframes": dedupe(timeframes),
    }


def fetch_market_asset_kpis(cur: Any, assets: List[Dict[str, Any]]) -> Dict[int, Dict[str, Any]]:
    """Load representative KPIs for marketplace assets.

    Chart-only indicators do not own backtest records. Script templates and
    bot presets use their persisted source ids because their backtests are
    stored as strategy-script/strategy runs.
    """
    if not assets:
        return {}

    output: Dict[int, Dict[str, Any]] = {}

    for asset in assets:
        asset_id = int(asset.get("id") or 0)
        asset_type = asset.get("asset_type") or "indicator"
        if not asset_id:
            continue
        if asset_type == "indicator":
            output[asset_id] = summarise_backtest_runs([])
            continue

        rows: List[Dict[str, Any]] = []
        source_script_id = int(asset.get("source_script_source_id") or 0)
        source_strategy_id = int(asset.get("source_strategy_id") or 0)
        try:
            if source_script_id:
                cur.execute(
                    """
                    SELECT id, symbol, timeframe, start_date, end_date, result_json
                    FROM qd_backtest_runs
                    WHERE source_id = %s
                      AND status = 'success'
                      AND result_json IS NOT NULL AND result_json != ''
                    """,
                    (source_script_id,),
                )
                rows = [dict(row) for row in (cur.fetchall() or [])]
            elif source_strategy_id:
                cur.execute(
                    """
                    SELECT id, symbol, timeframe, start_date, end_date, result_json
                    FROM qd_backtest_runs
                    WHERE strategy_id = %s
                      AND status = 'success'
                      AND result_json IS NOT NULL AND result_json != ''
                    """,
                    (source_strategy_id,),
                )
                rows = [dict(row) for row in (cur.fetchall() or [])]
        except Exception:
            logger.debug("Marketplace KPI query failed for asset %s", asset_id, exc_info=True)
        output[asset_id] = summarise_backtest_runs(rows)

    return {int(asset.get("id") or 0): output.get(int(asset.get("id") or 0), summarise_backtest_runs([])) for asset in assets}
