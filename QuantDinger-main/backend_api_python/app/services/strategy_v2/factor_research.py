"""Point-in-time cross-sectional factor research for Strategy API V2 universes."""

from __future__ import annotations

import math
from typing import Any, Mapping

import pandas as pd


class FactorResearchEngine:
    def run(
        self,
        *,
        frames: Mapping[str, pd.DataFrame],
        factor_id: str,
        start_date: Any,
        end_date: Any,
        groups: int = 5,
        holding_period: int = 5,
        commission: float = 0.0005,
        slippage: float = 0.0005,
        neutralize_industry: bool = False,
    ) -> dict[str, Any]:
        groups = max(2, min(10, int(groups or 5)))
        holding_period = max(1, int(holding_period or 5))
        factor_name = str(factor_id or "momentum_20").strip().lower()
        prepared = {
            symbol: frame.sort_index().loc[
                (frame.index >= pd.Timestamp(start_date)) & (frame.index <= pd.Timestamp(end_date))
            ].copy()
            for symbol, frame in frames.items()
        }
        close = self._panel(prepared, "close")
        open_price = self._panel(prepared, "open")
        if close.empty or open_price.empty:
            raise ValueError("strategyV2.factorResearchNoData")
        factor = self._factor_panel(prepared, factor_name, close)
        entry = open_price.shift(-1)
        exit_price = open_price.shift(-(holding_period + 1))
        forward_return = exit_price / entry - 1.0
        industry = self._industry_panel(prepared, close.index)
        research_dates = list(close.index[::holding_period])

        ic_rows: list[dict[str, Any]] = []
        group_rows: list[dict[str, Any]] = []
        group_returns: dict[int, list[tuple[pd.Timestamp, float, float]]] = {index: [] for index in range(1, groups + 1)}
        previous_members: dict[int, set[str]] = {index: set() for index in range(1, groups + 1)}
        rank_autocorrelations: list[float] = []
        previous_ranks: pd.Series | None = None
        total_observations = 0
        valid_observations = 0

        for timestamp in research_dates:
            values = factor.loc[timestamp].replace([math.inf, -math.inf], pd.NA)
            returns = forward_return.loc[timestamp].replace([math.inf, -math.inf], pd.NA)
            total_observations += int(len(values))
            valid = pd.concat([values.rename("factor"), returns.rename("return")], axis=1).dropna()
            valid_observations += int(len(valid))
            if neutralize_industry and not valid.empty:
                sectors = industry.loc[timestamp].reindex(valid.index).fillna("Unclassified")
                valid["factor"] = valid["factor"] - valid.groupby(sectors)["factor"].transform("mean")
            if len(valid) < max(3, groups):
                continue
            ranks = valid["factor"].rank(method="average", pct=True)
            ic = float(ranks.corr(valid["return"].rank(method="average", pct=True), method="pearson"))
            ic_rows.append({"time": str(pd.Timestamp(timestamp)), "value": 0.0 if pd.isna(ic) else ic})
            if previous_ranks is not None:
                aligned = pd.concat([previous_ranks, ranks], axis=1).dropna()
                if len(aligned) >= 3:
                    autocorrelation = aligned.iloc[:, 0].rank(method="average").corr(
                        aligned.iloc[:, 1].rank(method="average"),
                        method="pearson",
                    )
                    if not pd.isna(autocorrelation):
                        rank_autocorrelations.append(float(autocorrelation))
            previous_ranks = ranks

            labels = pd.qcut(valid["factor"].rank(method="first"), q=min(groups, len(valid)), labels=False) + 1
            for group in range(1, groups + 1):
                members = set(valid.index[labels == group])
                if not members:
                    continue
                gross_return = float(valid.loc[list(members), "return"].mean())
                previous = previous_members[group]
                turnover = 1.0 if not previous else 1.0 - len(previous & members) / max(len(previous | members), 1)
                cost = turnover * 2.0 * (max(0.0, commission) + max(0.0, slippage))
                net_return = gross_return - cost
                previous_members[group] = members
                group_returns[group].append((pd.Timestamp(timestamp), gross_return, net_return))
                group_rows.append({
                    "time": str(pd.Timestamp(timestamp)),
                    "group": group,
                    "grossReturn": gross_return,
                    "netReturn": net_return,
                    "turnover": turnover,
                    "members": sorted(members),
                })

        if not ic_rows:
            raise ValueError("strategyV2.factorResearchInsufficientObservations")
        ic_series = pd.Series([float(item["value"]) for item in ic_rows], dtype="float64")
        ic_mean = float(ic_series.mean()) if not ic_series.empty else 0.0
        ic_std = float(ic_series.std(ddof=1)) if len(ic_series) > 1 else 0.0
        icir = ic_mean / ic_std * math.sqrt(252.0 / holding_period) if ic_std > 0 else 0.0
        rolling = ic_series.rolling(20, min_periods=5).mean()
        for index, item in enumerate(ic_rows):
            item["rolling"] = None if pd.isna(rolling.iloc[index]) else float(rolling.iloc[index])

        curves = []
        final_by_group: list[float] = []
        for group, values in group_returns.items():
            gross_nav = 1.0
            net_nav = 1.0
            points = []
            for timestamp, gross_return, net_return in values:
                gross_nav *= 1.0 + gross_return
                net_nav *= 1.0 + net_return
                points.append({"time": str(timestamp), "gross": gross_nav, "net": net_nav})
            curves.append({"group": group, "points": points, "finalGross": gross_nav, "finalNet": net_nav})
            final_by_group.append(net_nav)

        long_short = self._long_short_curve(group_returns.get(groups, []), group_returns.get(1, []))
        monotonicity = 0.0
        if len(final_by_group) >= 3:
            monotonicity = float(
                pd.Series(range(1, len(final_by_group) + 1)).rank(method="average").corr(
                    pd.Series(final_by_group).rank(method="average"),
                    method="pearson",
                )
            )
        coverage = valid_observations / total_observations if total_observations else 0.0
        total_turnover = sum(float(item["turnover"]) for item in group_rows)
        average_turnover = total_turnover / len(group_rows) if group_rows else 0.0
        first_half = ic_series.iloc[: max(1, len(ic_series) // 2)]
        second_half = ic_series.iloc[max(1, len(ic_series) // 2):]

        return {
            "factorId": factor_name,
            "rankIc": ic_mean,
            "icir": icir,
            "icPositiveRate": float((ic_series > 0).mean()) if not ic_series.empty else 0.0,
            "icSeries": ic_rows,
            "groupCurves": curves,
            "longShortCurve": long_short,
            "groupObservations": group_rows,
            "monotonicity": 0.0 if pd.isna(monotonicity) else monotonicity,
            "coverage": coverage,
            "missingRate": 1.0 - coverage,
            "averageTurnover": average_turnover,
            "grossLongShortReturn": float(long_short[-1]["gross"] - 1.0) if long_short else 0.0,
            "netLongShortReturn": float(long_short[-1]["net"] - 1.0) if long_short else 0.0,
            "neutralized": bool(neutralize_industry),
            "factorCorrelation": self._factor_correlation(prepared, close),
            "stability": {
                "firstHalfIc": float(first_half.mean()) if not first_half.empty else 0.0,
                "secondHalfIc": float(second_half.mean()) if not second_half.empty else 0.0,
                "rankAutocorrelation": sum(rank_autocorrelations) / len(rank_autocorrelations) if rank_autocorrelations else 0.0,
            },
            "executionAssumptions": {
                "signal": "close_point_in_time",
                "entry": "next_bar_open",
                "exit": f"open_after_{holding_period}_bars",
                "commission": commission,
                "slippage": slippage,
            },
        }

    @staticmethod
    def _panel(frames: Mapping[str, pd.DataFrame], field: str) -> pd.DataFrame:
        columns = {}
        for symbol, frame in frames.items():
            if field in frame.columns:
                columns[symbol] = pd.to_numeric(frame[field], errors="coerce")
        return pd.DataFrame(columns).sort_index()

    def _factor_panel(
        self,
        frames: Mapping[str, pd.DataFrame],
        factor_id: str,
        close: pd.DataFrame,
    ) -> pd.DataFrame:
        if factor_id.startswith("momentum"):
            lookback = self._suffix_number(factor_id, 20)
            return close.pct_change(lookback)
        if factor_id.startswith("volatility"):
            lookback = self._suffix_number(factor_id, 20)
            return close.pct_change().rolling(lookback).std()
        if factor_id in {"reversal", "reversal_5"}:
            return -close.pct_change(5)
        field_aliases = {
            "value": "pe_ratio",
            "quality": "return_on_equity",
            "size": "market_cap",
        }
        field = field_aliases.get(factor_id, factor_id)
        panel = self._panel(frames, field)
        if field == "pe_ratio":
            panel = 1.0 / panel.where(panel > 0)
        if field == "market_cap":
            panel = panel.where(panel > 0).map(math.log)
        return panel.reindex(index=close.index, columns=close.columns)

    @staticmethod
    def _suffix_number(value: str, default: int) -> int:
        try:
            return max(1, int(value.rsplit("_", 1)[-1]))
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _industry_panel(frames: Mapping[str, pd.DataFrame], index: pd.Index) -> pd.DataFrame:
        columns = {}
        for symbol, frame in frames.items():
            if "industry" in frame.columns:
                columns[symbol] = frame["industry"].reindex(index).ffill()
        return pd.DataFrame(columns, index=index)

    @staticmethod
    def _long_short_curve(
        long_values: list[tuple[pd.Timestamp, float, float]],
        short_values: list[tuple[pd.Timestamp, float, float]],
    ) -> list[dict[str, Any]]:
        short_map = {timestamp: (gross, net) for timestamp, gross, net in short_values}
        gross_nav = 1.0
        net_nav = 1.0
        points = []
        for timestamp, long_gross, long_net in long_values:
            if timestamp not in short_map:
                continue
            short_gross, short_net = short_map[timestamp]
            gross_nav *= 1.0 + long_gross - short_gross
            net_nav *= 1.0 + long_net - short_net
            points.append({"time": str(timestamp), "gross": gross_nav, "net": net_nav})
        return points

    def _factor_correlation(
        self,
        frames: Mapping[str, pd.DataFrame],
        close: pd.DataFrame,
    ) -> dict[str, Any]:
        factors = {
            "momentum_20": close.pct_change(20),
            "volatility_20": close.pct_change().rolling(20).std(),
            "reversal_5": -close.pct_change(5),
        }
        stacked = {name: panel.stack(future_stack=True) for name, panel in factors.items()}
        matrix = pd.DataFrame(stacked).rank(method="average").corr(method="pearson").fillna(0.0)
        return {
            "factors": list(matrix.columns),
            "matrix": [[float(matrix.loc[row, column]) for column in matrix.columns] for row in matrix.index],
        }
