/* Trading-only, best-effort telemetry. No caller waits for network work.
 * Bounded queues are memory-only: reloads/offline exhaustion can lose telemetry.
 */
const AvalisaTelemetry = (() => {
  const archives = new Map();
  let pending = 0;
  let sessionId = null;
  let pausedUntil = 0; // set when the server reports archive_full
  const version = () => chrome.runtime.getManifest().version;
  function post(path, payload) {
    if (!state.jwt || pending >= 120) return;
    // Freeze facts before retries; even a synchronous transport error stays detached.
    const body = JSON.parse(JSON.stringify(payload));
    pending++;
    Promise.resolve().then(() => withRetry(() => apiPost(path, body)))
      .catch(() => {}).finally(() => { pending--; });
  }
  function event(type, reason = null, extra = {}) {
    try {
      post('/api/trades/event', {
        type, reason, pair: getCurrentPair(), amount: state.currentAmount,
        step: state.martingaleStep || 0, extVersion: version(),
        at: new Date().toISOString(), sessionId, ...extra,
      });
      if (type === 'pause') session('session_stop');
    } catch (_) {}
  }
  function session(type) {
    if (type === 'session_start') sessionId = globalThis.crypto?.randomUUID?.() || String(Date.now());
    const id = sessionId;
    const demo = isDemoMode();
    const facts = { pair: getCurrentPair(), amount: state.currentAmount, step: state.martingaleStep || 0, at: new Date().toISOString() };
    // Read balance asynchronously, never make Start/Stop wait for DOM or network.
    Promise.resolve().then(() => getBalance()).then(balance => {
      event(type, null, { ...facts, sessionId: id, isDemo: demo, balance });
    }).catch(() => event(type, 'balance_unavailable', { ...facts, sessionId: id, isDemo: demo }));
  }
  function market(pair) {
    const intensity = state.settings?.intensity || state.settings?.aiIntensity || 'mid';
    let periodSec = state.activePeriod || 30;
    let candles = state.candleBuffer?.[`${pair}:${periodSec}`] || [];
    if (!candles.length) {
      periodSec = 30;
      candles = [...(archives.get(pair)?.candles.values() || [])].sort((a,b) => a.time-b.time);
    }
    const empty = { pair, periodSec, intensity, rsi: null, sma20: null, stdev: null,
      volatility: null, slope: null, momentum: null, regime: 'unknown',
      rulesMatched: { call: null, put: null }, lastCandle: null,
      candleCount: candles.length, action: 'SKIP', reason: 'missing_indicators' };
    try {
      const indicators = buildIndicators(candles, pair, `${periodSec}s`);
      const evaluation = AvalisaSignalEngine.evaluateSignal(indicators || {}, intensity);
      const snapshot = evaluation.snapshot || {};
      return { ...empty, rsi: indicators?.rsi14 ?? null, sma20: indicators?.sma20 ?? null,
        stdev: indicators?.volatility ?? null, volatility: indicators?.volatility ?? null,
        slope: indicators?.slope10 ?? null, momentum: indicators?.momentum5 ?? null,
        regime: snapshot.regime || 'unknown', lastCandle: indicators?.lastCandle ?? null,
        rulesMatched: { call: snapshot.callCount ?? null, put: snapshot.putCount ?? null },
        action: evaluation.action, reason: evaluation.reason || null };
    } catch (_) { return empty; }
  }
  function po() {
    const dealId = state.currentDealId;
    if (!dealId) return {};
    const facts = { dealId };
    // Only copy allowed fields from the exact attributed deal, never whole socket payloads.
    for (const ev of [...(state.recentOpenEvents || []), ...(state.recentCloseEvents || [])]) {
      if (!/^success(open|close)Order$/i.test(ev.event)) continue;
      const deals = Array.isArray(ev.payload?.deals) ? ev.payload.deals
        : Array.isArray(ev.payload) ? ev.payload : [ev.payload];
      for (const deal of deals) {
        if (deal?.id !== dealId) continue;
        for (const key of ['openPrice', 'closePrice', 'openTime', 'closeTime', 'profit', 'isDemo']) {
          if (deal[key] !== undefined) facts[key] = deal[key];
        }
        const payout = deal.payoutPct ?? deal.payout ?? deal.percentProfit;
        if (payout !== undefined) facts.payoutPct = payout;
      }
    }
    return facts;
  }
  // Archive only while the bot runs, and only the pair it is on: that is the
  // active trading pair or a favourite it switched to while scanning. Pairs a
  // user merely browses with the bot stopped are never uploaded.
  function viewed(pair) {
    return !!state.running && !!pair && pair !== 'UNKNOWN' && pair === normalizeAssetName(getCurrentPair());
  }
  function archive(pair) {
    if (!viewed(pair)) return null;
    if (!archives.has(pair)) {
      // Bounded to the most recently viewed pairs.
      if (archives.size >= 20) {
        const expired = [...archives].find(([, a]) => a.nextPost <= Date.now());
        if (!expired) return null;
        archives.delete(expired[0]);
      }
      archives.set(pair, { candles: new Map(), tickTimes: new Map(), sent: new Set(), nextPost: 0 });
    }
    return archives.get(pair);
  }
  function flush(pair, a) {
    if (!state.jwt || Date.now() < a.nextPost || Date.now() < pausedUntil) return;
    const candles = [...a.candles.values()].filter(c => c.time + 30 <= Date.now()/1000 && !a.sent.has(c.time))
      .sort((x,y) => x.time-y.time).slice(0,500).map(c => ({ ...c }));
    if (!candles.length) return;
    // Reserve the interval before dispatch, including failed requests. Retry on
    // the next eligible ingestion, never faster than one POST/pair/5 minutes.
    a.nextPost = Date.now() + 300000;
    Promise.resolve().then(() => apiPost('/api/market/candles', { pair, periodSec: 30, candles }))
      .then(res => {
        for (const c of candles) a.sent.add(c.time);
        // Server archive is full: treat as delivered and stop all uploads for 1h.
        if (res && res.accepted === false && res.reason === 'archive_full') pausedUntil = Date.now() + 3600000;
      })
      .catch(() => {
        // Automatic retry uses the same five-minute reservation and frozen prices.
        setTimeout(() => { if (archives.get(pair) === a) flush(pair, a); }, 300000);
      });
  }
  function trim(a) {
    while (a.candles.size > 1000) {
      const oldest = Math.min(...a.candles.keys());
      a.candles.delete(oldest); a.sent.delete(oldest); a.tickTimes.delete(oldest);
    }
  }
  function tick(pair, timestamp, price, defer = false) {
    try {
      const a = archive(pair);
      let ts = Number(timestamp); price = Number(price);
      if (!a || !Number.isFinite(ts) || !Number.isFinite(price) || price <= 0) return;
      if (ts > 1e10) ts /= 1000;
      const time = Math.floor(ts/30)*30;
      const c = a.candles.get(time);
      if (!c) {
        a.candles.set(time, {time, open:price, high:price, low:price, close:price});
        a.tickTimes.set(time, {first:ts,last:ts});
      } else if (!a.sent.has(time)) {
        c.high=Math.max(c.high,price); c.low=Math.min(c.low,price);
        const times = a.tickTimes.get(time);
        if (times) {
          if (ts < times.first) { c.open=price; times.first=ts; }
          if (ts >= times.last) { c.close=price; times.last=ts; }
        }
      }
      trim(a);
      if (!defer) flush(pair,a);
    } catch (_) {}
  }
  function history(pair, ticks) {
    try {
      if (!viewed(pair) || !Array.isArray(ticks)) return;
      for (const t of [...ticks].sort((a,b)=>Number(a[0])-Number(b[0]))) {
        if (Array.isArray(t) && t.length === 2) tick(pair,t[0],t[1],true);
      }
      const a = archives.get(pair);
      if (a) flush(pair,a);
    } catch (_) {}
  }
  function frame(payload) {
    try {
      const pair = normalizeAssetName(payload?.asset || getCurrentPair());
      const rows = payload?.history || payload?.candles || (Array.isArray(payload) ? payload : []);
      if (!Array.isArray(rows)) return;
      if (rows.every(r => Array.isArray(r) && r.length === 2)) { history(pair, rows); return; }
      const period = Number(payload?.period || getCurrentPeriodSeconds());
      // Same PO OHLC layout already consumed by content.js: [time,open,close,high,low].
      for (const r of rows) {
        if (Array.isArray(r) && r.length >= 5) candle({asset:pair,period,time:r[0],open:r[1],close:r[2],high:r[3],low:r[4]});
        else if (r && !Array.isArray(r)) candle({asset:pair,period,time:r.time ?? r.timestamp ?? r.t,open:r.open ?? r.o,high:r.high ?? r.h,low:r.low ?? r.l,close:r.close ?? r.c});
      }
    } catch (_) {}
  }
  function candle(c) {
    try {
      const a = Number(c.period) === 30 ? archive(c.asset) : null;
      if (!a) return;
      const time = Number(c.time) > 1e10 ? Number(c.time)/1000 : Number(c.time);
      const entry = {time, open:Number(c.open), high:Number(c.high), low:Number(c.low), close:Number(c.close)};
      if (!Object.values(entry).every(Number.isFinite) || time % 30 !== 0) return;
      if (!a.sent.has(time)) a.candles.set(time,entry);
      trim(a); flush(c.asset,a);
    } catch (_) {}
  }
  return { post, event, session, market, po, tick, history, candle, frame };
})();
