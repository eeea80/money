"""FastAPI shell — REST endpoints + minimal bilingual (FA/EN) status page.

Phase 1 keeps this deliberately small: status, candles, signals, trades,
settings. The full dashboard arrives in a later phase.

Paper trading only — there is no endpoint anywhere that can place a
real order.
"""

from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse

from . import i18n
from .journal import Journal
from .market_data import SUPPORTED_TIMEFRAMES, MarketData
from .paper_engine import PaperConfig, PaperEngine
from .risk import RISK_PER_TRADE, RiskManager, RiskMode
from .strategies import get_strategy, registered_strategies

logger = logging.getLogger(__name__)


class AppContext:
    """Shared state for the API process."""

    def __init__(
        self,
        symbol: str = "BTC/USDT",
        timeframe: str = "1m",
        risk_mode: str = "balanced",
        execution_latency_ms: float = 140.0,
        starting_equity: float = 10_000.0,
        db_path: str = "data/journal.sqlite3",
        strategy_name: str = "ema_cross_rsi",
    ) -> None:
        self.started_at = time.time()
        self.symbol = symbol
        self.timeframe = timeframe
        self.strategy_name = strategy_name
        self.market = MarketData()
        self.journal = Journal(db_path)
        self.config = PaperConfig(
            starting_equity=starting_equity,
            execution_latency_ms=execution_latency_ms,
            default_risk_mode=risk_mode,
        )
        self.risk = RiskManager(
            starting_equity=starting_equity, mode=risk_mode
        )
        self.engine = PaperEngine(
            strategy=get_strategy(strategy_name),
            journal=self.journal,
            risk_manager=self.risk,
            config=self.config,
            symbol=symbol,
            timeframe=timeframe,
        )
        self.last_source = "unknown"
        self.poll_seconds = 5.0

    async def poll_loop(self) -> None:
        """Background loop: pull candles, feed new ones to the engine."""
        while True:
            try:
                df = await asyncio.to_thread(
                    self.market.get_candles, self.symbol, self.timeframe, 300
                )
                self.last_source = df.attrs.get("source", "unknown")
                if df.attrs.get("source") == "sample":
                    # Sample data is static: feed once, then idle quietly.
                    if not getattr(self, "_sample_fed", False):
                        self.engine.on_candle(df, "sample")
                        self._sample_fed = True
                else:
                    self.engine.on_candle(df, "binance")
            except Exception:  # keep the loop alive no matter what
                logger.exception("poll loop iteration failed")
            await asyncio.sleep(self.poll_seconds)


def create_app(ctx: Optional[AppContext] = None) -> FastAPI:
    ctx = ctx or AppContext()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        ctx.task = asyncio.create_task(ctx.poll_loop())
        try:
            yield
        finally:
            task = getattr(ctx, "task", None)
            if task:
                task.cancel()

    app = FastAPI(
        title="Omni-Trader",
        version="0.1.0",
        description="Paper-trading core (Phase 1) — no real orders, no API keys.",
        lifespan=lifespan,
    )
    app.state.ctx = ctx

    # ------------------------------------------------------------------
    @app.get("/status")
    def status():
        return {
            "app": "omni-trader",
            "version": "0.1.0",
            "mode": "paper",  # always paper in Phase 1
            "uptime_seconds": round(time.time() - ctx.started_at, 1),
            "data_source": ctx.last_source,
            "engine": ctx.engine.status(),
        }

    @app.get("/candles")
    def candles(
        timeframe: str = Query(default=ctx.timeframe),
        limit: int = Query(default=100, ge=1, le=1000),
    ):
        if timeframe not in SUPPORTED_TIMEFRAMES:
            raise HTTPException(400, f"timeframe must be one of {SUPPORTED_TIMEFRAMES}")
        df = ctx.market.get_candles(ctx.symbol, timeframe, limit)
        tail = df.tail(limit)
        recs = tail.copy()
        recs["timestamp"] = recs.index.astype(str)
        return {
            "symbol": ctx.symbol,
            "timeframe": timeframe,
            "source": df.attrs.get("source", "unknown"),
            "count": len(tail),
            "candles": recs[
                ["timestamp", "open", "high", "low", "close", "volume"]
            ].to_dict("records"),
        }

    @app.get("/signals")
    def signals(limit: int = Query(default=20, ge=1, le=200)):
        return {"signals": ctx.journal.recent_signals(limit)}

    @app.get("/trades")
    def trades(limit: int = Query(default=20, ge=1, le=200)):
        return {
            "trades": ctx.journal.recent_trades(limit),
            "memory": ctx.journal.get_memory(),
        }

    @app.get("/settings")
    def get_settings():
        return {
            "risk_mode": ctx.risk.mode.value,
            "risk_per_trade_pct": ctx.risk.risk_per_trade * 100,
            "daily_loss_cap_pct": ctx.risk.daily_loss_cap * 100,
            "execution_latency_ms": ctx.config.execution_latency_ms,
            "symbol": ctx.symbol,
            "timeframe": ctx.timeframe,
            "strategy": ctx.strategy_name,
            "available_strategies": registered_strategies(),
            "supported_timeframes": list(SUPPORTED_TIMEFRAMES),
        }

    @app.post("/settings")
    def post_settings(
        risk_mode: Optional[str] = None,
        execution_latency_ms: Optional[float] = None,
        timeframe: Optional[str] = None,
        poll_seconds: Optional[float] = None,
    ):
        changed = {}
        if risk_mode is not None:
            try:
                ctx.risk.mode = RiskMode(risk_mode)
            except ValueError:
                raise HTTPException(
                    400, f"risk_mode must be one of {[m.value for m in RiskMode]}"
                )
            ctx.journal.record_decision(
                "config", {"risk_mode": ctx.risk.mode.value}
            )
            changed["risk_mode"] = ctx.risk.mode.value
        if execution_latency_ms is not None:
            if not (0 <= execution_latency_ms <= 60_000):
                raise HTTPException(400, "execution_latency_ms must be 0..60000")
            ctx.config.execution_latency_ms = execution_latency_ms
            ctx.journal.record_decision(
                "config", {"execution_latency_ms": execution_latency_ms}
            )
            changed["execution_latency_ms"] = execution_latency_ms
        if timeframe is not None:
            if timeframe not in SUPPORTED_TIMEFRAMES:
                raise HTTPException(400, f"timeframe must be one of {SUPPORTED_TIMEFRAMES}")
            ctx.timeframe = timeframe
            ctx.engine.timeframe = timeframe
            changed["timeframe"] = timeframe
        if poll_seconds is not None and 1.0 <= poll_seconds <= 300.0:
            ctx.poll_seconds = poll_seconds
            changed["poll_seconds"] = poll_seconds
        return {"updated": changed, "settings": get_settings()}

    # ------------------------------------------------------------------
    @app.get("/", response_class=HTMLResponse)
    def home(lang: str = "en"):
        if lang not in i18n.SUPPORTED_LANGS:
            lang = "en"
        return render_status_page(ctx, lang)

    return app


def render_status_page(ctx: AppContext, lang: str) -> str:
    t = lambda key: i18n.t(key, lang)  # noqa: E731
    st = ctx.engine.status()
    other = "fa" if lang == "en" else "en"
    rows_signals = "".join(
        f"<tr><td>{s['ts']}</td><td>{s['strategy']}</td>"
        f"<td><b>{s['signal']}</b></td><td>{s['price']:.2f}</td>"
        f"<td>{t('yes') if s['acted'] else t('no')}</td></tr>"
        for s in reversed(ctx.journal.recent_signals(8))
    ) or f"<tr><td colspan=5>—</td></tr>"
    rows_trades = "".join(
        f"<tr><td>{tr['entry_time']}</td><td>{tr['side']}</td>"
        f"<td>{tr['qty']:.6f}</td><td>{tr['entry_price']:.2f}</td>"
        f"<td>{tr['exit_price'] if tr['exit_price'] is not None else '—'}</td>"
        f"<td>{('%.2f' % tr['pnl']) if tr['pnl'] is not None else '—'}</td></tr>"
        for tr in reversed(ctx.journal.recent_trades(8))
    ) or f"<tr><td colspan=6>—</td></tr>"
    pos = st["position"] or {}
    pos_str = (
        f"{pos.get('side')} {pos.get('qty'):.6f} @ {pos.get('entry_price'):.2f}"
        if pos else t("none")
    )
    return f"""<!doctype html>
<html lang="{lang}" dir="{'rtl' if lang == 'fa' else 'ltr'}">
<head>
<meta charset="utf-8">
<title>{t('app_title')}</title>
<style>
 body {{ font-family: Vazirmatn, Tahoma, sans-serif; background:#0e1117; color:#e6e6e6;
        margin:0; padding:2rem; }}
 .card {{ background:#161b22; border:1px solid #30363d; border-radius:10px;
         padding:1rem 1.25rem; margin-bottom:1rem; }}
 h1 {{ font-size:1.4rem; margin:0 0 .25rem; }}
 .muted {{ color:#8b949e; font-size:.9rem; }}
 table {{ width:100%; border-collapse:collapse; font-size:.85rem; }}
 th, td {{ padding:.4rem .5rem; border-bottom:1px solid #21262d; text-align:start; }}
 th {{ color:#8b949e; font-weight:600; }}
 .kv {{ display:grid; grid-template-columns:auto auto; gap:.3rem 1.5rem; }}
 .kv b {{ color:#58a6ff; font-weight:600; }}
 a {{ color:#58a6ff; text-decoration:none; }}
 .flag {{ color:#f0883e; font-size:.8rem; margin-top:1rem; }}
</style>
</head>
<body>
 <h1>{t('app_title')} <a href="/?lang={other}" style="font-size:.9rem">[{t('lang_toggle')}]</a></h1>
 <div class="muted">{t('subtitle')}</div>

 <div class="card"><h2>{t('status')}</h2><div class="kv">
   <span>{t('state')}</span><b>{t('halted') if st['halted'] else t('running')}</b>
   <span>{t('equity')}</span><b>{st['equity']:.2f}</b>
   <span>{t('daily_pnl')}</span><b>{st['daily_pnl']:.2f}</b>
   <span>{t('position')}</span><b>{pos_str}</b>
   <span>{t('risk_mode')}</span><b>{st['risk_mode']} ({st['risk_per_trade_pct']:.1f}%)</b>
   <span>{t('drawdown')}</span><b>{st['drawdown_pct']:.2f}%</b>
   <span>{t('throttle')}</span><b>{st['throttle']:.2f}</b>
   <span>{t('latency')}</span><b>{st['execution_latency_ms']:.0f} ms</b>
   <span>{t('data_source')}</span><b>{ctx.last_source}</b>
   <span>{t('symbol')} / {t('timeframe')}</span><b>{st['symbol']} · {st['timeframe']} · {st['strategy']}</b>
 </div></div>

 <div class="card"><h2>{t('signals')}</h2>
  <table><tr><th>{t('time')}</th><th>{t('strategy')}</th><th>{t('signal')}</th>
  <th>{t('price')}</th><th>{t('acted')}</th></tr>{rows_signals}</table></div>

 <div class="card"><h2>{t('trades')}</h2>
  <table><tr><th>{t('time')}</th><th>{t('side')}</th><th>{t('qty')}</th>
  <th>{t('entry')}</th><th>{t('exit')}</th><th>{t('pnl')}</th></tr>{rows_trades}</table></div>

 <div class="flag">⚠ {t('footer')}</div>
</body>
</html>"""


def get_app() -> FastAPI:
    """Entrypoint for `uvicorn omni_trader.api:get_app`."""
    return create_app()
