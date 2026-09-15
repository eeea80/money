/**
 * Avalisa PO Bot v2 — Content Script
 * Injected into pocketoption.com and po.cash
 * Uses DOM-click approach for maximum stability.
 */

// ─── WebSocket Candle Interceptor ─────────────────────────────────────────────
// injected.js is now loaded directly by Chrome as a MAIN-world content script
// (see manifest.json content_scripts[0]). The legacy <script src=...> approach
// was blocked by PO's CSP, which prevented the WebSocket wrapper from installing.

// Verbose WS/DOM tracing is developer-only. Without this gate the bot logged every
// socket frame and XHR body on a live trading page — hundreds of KB a minute, plus
// whatever happened to be inside those payloads. Enable with
// localStorage.setItem('avalisaDebugLogs','1') (same switch injected.js uses).
function avDebugEnabled() {
  try {
    return window.__AVALISA_DEBUG_LOGS__ === true || window.localStorage?.getItem('avalisaDebugLogs') === '1';
  } catch (_) {
    return window.__AVALISA_DEBUG_LOGS__ === true;
  }
}
function debugLog(...args) {
  if (avDebugEnabled()) console.log(...args);
}

let _wsDebugCount = 0;
let _tickLogCount = 0;
function parseWsMessage(raw) {
  if (typeof raw !== 'string') return;

  // Debug: log first 10 raw WS messages so we can see the actual format
  if (_wsDebugCount < 10) {
    debugLog('[Avalisa] WS raw msg #' + _wsDebugCount + ':', raw.substring(0, 200));
    _wsDebugCount++;
  }

  // Socket.IO binary event placeholder (451- prefix)
  if (raw.startsWith('451-') || raw.startsWith('452-')) {
    debugLog('[Avalisa] Socket.IO binary placeholder:', raw.substring(0, 200));
    return; // actual data arrives in next binary frame, handled by AVALISA_WS_HISTORY
  }

  // Socket.IO messages: 42["event", payload]
  const m = raw.match(/^42\["([^"]+)",([\s\S]+)\]$/);
  if (!m) return;
  const event = m[1];
  let payload;
  try { payload = JSON.parse(m[2]); } catch { return; }

  if (['updateHistoryNewFast', 'updateCharts', 'successloadHistory'].includes(event) &&
      typeof AvalisaTelemetry !== 'undefined') {
    AvalisaTelemetry.frame(payload);
  }

  if (/^successopenOrder$/i.test(event)) recordWsOpen(payload);

  // Capture close-like events for trade result detection
  const CLOSE_EVENT_PATTERNS = /close|deal.*end|order.*close|profit|expir|update.*deal|success.*close/i;
  if (CLOSE_EVENT_PATTERNS.test(event)) {
    state.recentCloseEvents.push({ ts: Date.now(), event, payload });
    if (state.recentCloseEvents.length > 20) state.recentCloseEvents.shift();
    debugLog('[Avalisa] CLOSE EVENT CAPTURED:', event, JSON.stringify(payload).substring(0, 500));
  }

  // Log ALL events — helps map PO's AI signal event names
  const skip = new Set(['updateStream', 'setTime', 'ping', 'pong']);
  if (!skip.has(event)) {
    debugLog('[Avalisa] WS EVENT:', event, JSON.stringify(payload).substring(0, 400));
  }

  if (event === 'updateHistoryNewFast' || event === 'successloadHistory') {
    debugLog('[Avalisa] History text frame:', event, JSON.stringify(payload).substring(0, 200));
  }
}

function ingestCandle(c) {
  if (typeof AvalisaTelemetry !== 'undefined') AvalisaTelemetry.candle(c);
  if (!c || !c.asset || !c.period || !c.time) return;
  const key = `${c.asset}:${c.period}`;
  if (!state.candleBuffer[key]) state.candleBuffer[key] = [];
  const buf = state.candleBuffer[key];
  // Deduplicate by time
  const existing = buf.findIndex(x => x.time === c.time);
  const entry = { time: c.time, open: c.open, high: c.high, low: c.low, close: c.close };
  if (existing >= 0) {
    buf[existing] = entry; // update (candle still forming)
  } else {
    buf.push(entry);
    if (buf.length > 50) buf.shift(); // keep last 50
  }
}

// Build OHLCV candles from raw ticks (asset, unix_ts_float, price)
function ingestTick(asset, timestamp, price) {
  if (typeof AvalisaTelemetry !== 'undefined') AvalisaTelemetry.tick(asset, timestamp, price);
  if (!asset || !timestamp || !price) return;
  // PO streams many numeric asset ids in the same socket. Avalisa should only
  // build candles for the active named pair; otherwise buffers balloon and AI
  // can accidentally reason over unrelated streams.
  const assetKey = String(asset);
  if (/^\d+$/.test(assetKey)) return;
  if (state.activePair && assetKey !== state.activePair) return;
  const periods = state.activePeriod ? [state.activePeriod] : Object.values(TF_TO_SECONDS);
  periods.forEach(period => {
    const key = `${asset}:${period}`;
    const candleTime = Math.floor(timestamp / period) * period;
    if (!state.candleBuffer[key]) state.candleBuffer[key] = [];
    const buf = state.candleBuffer[key];
    const last = buf[buf.length - 1];
    if (last && last.time === candleTime) {
      last.high = Math.max(last.high, price);
      last.low = Math.min(last.low, price);
      last.close = price;
    } else {
      buf.push({ time: candleTime, open: price, high: price, low: price, close: price });
      if (buf.length > 50) buf.shift();
    }
  });
  if (state.activePair && state.activePeriod) scheduleCandleCacheSave();
}

function getBufferedCandles() {
  // Single source of truth: the active pair/period tracked from the last
  // updateHistoryNewFast seed. Stale fuzzy fallbacks removed — they were
  // returning cross-pair data and causing the 50/25 mismatch.
  if (!state.activePair || !state.activePeriod) return [];
  const key = `${state.activePair}:${state.activePeriod}`;
  return state.candleBuffer[key] || [];
}

function getBufferedCandlesFor(asset, periodSec) {
  if (!asset || !periodSec) return [];
  return state.candleBuffer[`${asset}:${periodSec}`] || [];
}

function getCurrentAiIntensity() {
  const el = document.getElementById('av-intensity');
  if (el && ['low', 'mid', 'high'].includes(el.value)) return el.value;
  return ['low', 'mid', 'high'].includes(state.settings?.intensity) ? state.settings.intensity : 'mid';
}

function getRequiredCandles(intensity = getCurrentAiIntensity()) {
  return REQUIRED_CANDLES_BY_INTENSITY[intensity] || REQUIRED_CANDLES_BY_INTENSITY.mid;
}

function isFreshCandleCache(candles, periodSec) {
  if (!Array.isArray(candles) || candles.length === 0) return false;
  const last = candles[candles.length - 1];
  if (!last || !Number.isFinite(last.time)) return false;
  const maxAgeSec = Math.max(periodSec * 6, 120);
  return (Date.now() / 1000) - last.time <= maxAgeSec;
}

async function restoreCandleCache(asset, periodSec) {
  if (!asset || asset === 'UNKNOWN' || !periodSec || typeof chrome === 'undefined' || !chrome.storage?.local) return false;
  return new Promise(resolve => {
    chrome.storage.local.get([CANDLE_CACHE_KEY], data => {
      const cache = data[CANDLE_CACHE_KEY] || {};
      const key = `${asset}:${periodSec}`;
      const candles = cache[key]?.candles || [];
      const live = state.candleBuffer[key] || [];
      // Never rewind ticks already received while the asynchronous storage read ran.
      if (live.length && live[live.length - 1].time >= (candles[candles.length - 1]?.time || 0)) return resolve(false);
      if (normalizeAssetName(getCurrentPair()) !== asset) return resolve(false);
      if (!isFreshCandleCache(candles, periodSec)) return resolve(false);

      clearStalePairBuffers(asset, periodSec);
      state.activePair = asset;
      state.activePeriod = periodSec;
      state.candleBuffer[key] = candles.slice(-MAX_CANDLE_BUFFER);
      console.log('[Avalisa] Restored cached candles for', key, 'count:', state.candleBuffer[key].length);
      updateBottomStatus();
      resolve(true);
    });
  });
}

function saveActiveCandleCache() {
  if (!state.activePair || !state.activePeriod || typeof chrome === 'undefined' || !chrome.storage?.local) return;
  const key = `${state.activePair}:${state.activePeriod}`;
  const candles = state.candleBuffer[key];
  if (!Array.isArray(candles) || candles.length === 0) return;

  chrome.storage.local.get([CANDLE_CACHE_KEY], data => {
    const cache = data[CANDLE_CACHE_KEY] || {};
    cache[key] = {
      savedAt: Date.now(),
      asset: state.activePair,
      period: state.activePeriod,
      candles: candles.slice(-MAX_CANDLE_BUFFER),
    };

    const pruned = Object.fromEntries(
      Object.entries(cache)
        .sort((a, b) => (b[1]?.savedAt || 0) - (a[1]?.savedAt || 0))
        .slice(0, 8)
    );
    chrome.storage.local.set({ [CANDLE_CACHE_KEY]: pruned });
  });
}

function scheduleCandleCacheSave() {
  if (candleCacheSaveTimer) return;
  candleCacheSaveTimer = setTimeout(() => {
    candleCacheSaveTimer = null;
    saveActiveCandleCache();
  }, 1000);
}

function persistRuntimeSession(phase = 'running') {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return Promise.resolve(false);
  const payload = {
    savedAt: Date.now(),
    version: chrome.runtime?.getManifest?.().version || null,
    phase,
    running: state.running,
    stopRequested: state.stopRequested,
    currentAmount: state.currentAmount,
    martingaleStep: state.martingaleStep,
    tradesCount: state.tradesCount,
    lastDirection: state.lastDirection,
    settings: state.settings,
    amountSetFailures: state.amountSetFailures || 0,
    recoveryReloads: state.recoveryReloads || 0,
    cycleErrorReloads: state.cycleErrorReloads || 0,
  };
  return new Promise(resolve => chrome.storage.local.set({ [RUNTIME_SESSION_KEY]: payload }, () => resolve(true)));
}

// v2.4.8: when a safety stop fires mid-ladder, keep the ladder position so the
// next Start can resume the recovery instead of restarting at step 0 — an
// abandoned half-ladder is realized loss for the user. Manual Stop clears it.
function preservePausedLadder(reason) {
  if (typeof AvalisaTelemetry !== 'undefined') AvalisaTelemetry.event('pause', reason);
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return Promise.resolve(false);
  const startAmount = parseFloat(state.settings?.startAmount) || 1.0;
  const midLadder = (state.martingaleStep || 0) > 0 || (state.currentAmount || 0) > startAmount;
  if (!midLadder) return Promise.resolve(false);
  const payload = {
    savedAt: Date.now(),
    reason,
    currentAmount: state.currentAmount,
    martingaleStep: state.martingaleStep,
    tradesCount: state.tradesCount,
    lastDirection: state.lastDirection,
    startAmount,
    martingaleMultiplier: state.settings?.martingaleMultiplier,
    martingaleSteps: state.settings?.martingaleSteps,
  };
  return new Promise(resolve => chrome.storage.local.set({ [PAUSED_LADDER_KEY]: payload }, () => resolve(true)));
}

function clearPausedLadder() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return Promise.resolve(false);
  return new Promise(resolve => chrome.storage.local.remove([PAUSED_LADDER_KEY], () => resolve(true)));
}

function loadPausedLadder() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return Promise.resolve(null);
  return new Promise(resolve => {
    chrome.storage.local.get([PAUSED_LADDER_KEY], data => resolve(data?.[PAUSED_LADDER_KEY] || null));
  });
}

// Consume a preserved ladder if it is fresh and the martingale settings are
// unchanged. Returns the payload to resume, or null. Always clears the marker.
async function consumePausedLadder(settings) {
  const saved = await loadPausedLadder();
  if (!saved) return null;
  await clearPausedLadder();
  if (Date.now() - Number(saved.savedAt || 0) > PAUSED_LADDER_MAX_AGE_MS) return null;
  const startAmount = parseFloat(settings?.startAmount) || 1.0;
  const sameSettings =
    Number(saved.startAmount) === startAmount &&
    String(saved.martingaleMultiplier) === String(settings?.martingaleMultiplier) &&
    String(saved.martingaleSteps) === String(settings?.martingaleSteps);
  if (!sameSettings) return null;
  if (!Number.isFinite(Number(saved.currentAmount)) || Number(saved.currentAmount) <= 0) return null;
  return saved;
}

function clearRuntimeSession() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return Promise.resolve(false);
  return new Promise(resolve => chrome.storage.local.remove([RUNTIME_SESSION_KEY], () => resolve(true)));
}

function loadRuntimeSession() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return Promise.resolve(null);
  return new Promise(resolve => {
    chrome.storage.local.get([RUNTIME_SESSION_KEY], data => resolve(data?.[RUNTIME_SESSION_KEY] || null));
  });
}

async function restoreRuntimeSession() {
  const saved = await loadRuntimeSession();
  if (!saved?.running || saved.stopRequested) return false;
  if (Date.now() - Number(saved.savedAt || 0) > RUNTIME_SESSION_MAX_AGE_MS) {
    await clearRuntimeSession();
    return false;
  }

  state.settings = { ...getDefaultSettings(), ...(saved.settings || state.settings || {}) };
  state.currentAmount = Math.max(1, Number(saved.currentAmount) || Number(state.settings.startAmount) || 1);
  state.martingaleStep = Math.max(0, Number(saved.martingaleStep) || 0);
  state.tradesCount = Math.max(0, Number(saved.tradesCount) || 0);
  state.lastDirection = saved.lastDirection || null;
  state.amountSetFailures = Math.max(0, Number(saved.amountSetFailures) || 0);
  state.recoveryReloads = Math.max(0, Number(saved.recoveryReloads) || 0);
  state.cycleErrorReloads = Math.max(0, Number(saved.cycleErrorReloads) || 0);

  // A reload can happen after an order was sent but before its result was
  // applied. Starting a fresh cycle from that snapshot can place the same rung
  // again while the original trade is still open. Keep the saved recovery
  // context for manual inspection, but never guess the unresolved result or
  // auto-resume from an in-flight phase.
  const savedPhase = String(saved.phase || '');
  // These are written only while no order is in flight: error recovery checks
  // !state.isTradeOpen before persisting, and resolved follows result application.
  // amount_set can survive a crash between clicking and saving order_pending.
  // Unknown/future
  // phases fail closed until their safety is explicit.
  const safeResumePhases = new Set([
    'started',
    'amount_retry',
    'auto_reload_amount',
    'cycle_error_retry',
    'auto_reload_error',
    'resolved',
  ]);
  if (!safeResumePhases.has(savedPhase)) {
    state.running = false;
    state.stopRequested = true;
    state.cycleGeneration += 1;
    clearTradeLock();
    updateUI();
    updateTradeCounter();
    updateStatus('error', 'Recovered an unresolved trade. Check Pocket Option trade history and reconcile its result before starting again.');
    return false;
  }

  state.running = true;
  state.stopRequested = false;
  state.cycleGeneration += 1;
  clearTradeLock();

  updateUI();
  updateTradeCounter();
  if (typeof AvalisaTelemetry !== 'undefined') AvalisaTelemetry.session('session_start');
  updateStatus('running', `Recovered session — continuing $${state.currentAmount.toFixed(2)} recovery`);
  const gen = state.cycleGeneration;
  setTimeout(() => {
    if (isCycleActive(gen)) runTradeCycle(gen).catch(err => console.error('[Avalisa] Recovered cycle error:', err));
  }, 2500);
  return true;
}

// Merge-seed the buffer from a bulk updateHistoryNewFast payload.
// `ticks` is an array of [timestamp_seconds_float, price_float].
// v2.3.1: MERGE existing + incoming candles by time key, NEVER shrink the buffer.
// PO sometimes re-fires updateHistoryNewFast with fewer ticks (tab refocus, chart
// re-render). Old replace-seed logic clobbered larger buffers down to smaller ones.
function seedCandleBufferFromHistory(asset, period, ticks) {
  if (typeof AvalisaTelemetry !== 'undefined') AvalisaTelemetry.history(asset, ticks);
  const key = `${asset}:${period}`;
  // Start from existing buffer (preserves real-time tick data and prior history)
  const byTime = new Map();
  const existing = state.candleBuffer[key] || [];
  for (const c of existing) {
    if (c && Number.isFinite(c.time)) byTime.set(c.time, { ...c });
  }

  for (const t of ticks) {
    if (!Array.isArray(t) || t.length < 2) continue;
    const tsRaw = Number(t[0]);
    const price = Number(t[1]);
    if (!Number.isFinite(tsRaw) || !Number.isFinite(price)) continue;
    const ts = tsRaw > 1e10 ? tsRaw / 1000 : tsRaw; // normalize ms → sec
    const candleTime = Math.floor(ts / period) * period;
    const cur = byTime.get(candleTime);
    if (cur) {
      // Update existing bucket: extend high/low, update close (last tick wins)
      cur.high = Math.max(cur.high, price);
      cur.low = Math.min(cur.low, price);
      cur.close = price;
    } else {
      byTime.set(candleTime, { time: candleTime, open: price, high: price, low: price, close: price });
    }
  }
  const candles = Array.from(byTime.values())
    .sort((a, b) => a.time - b.time)
    .slice(-MAX_CANDLE_BUFFER);
  state.candleBuffer[key] = candles;
  scheduleCandleCacheSave();
  return candles.length;
}

// Pair switch: wipe every buffer except the newly active one.
function clearStalePairBuffers(keepAsset, keepPeriod) {
  const keepKey = `${keepAsset}:${keepPeriod}`;
  for (const key of Object.keys(state.candleBuffer)) {
    if (key !== keepKey) delete state.candleBuffer[key];
  }
}

// ─── Device Fingerprint ───────────────────────────────────────────────────────
function getDeviceFingerprint() {
  if (state.deviceFingerprint) return state.deviceFingerprint;
  const raw = [
    navigator.userAgent,
    navigator.language,
    screen.width,
    screen.height,
    navigator.hardwareConcurrency,
  ].join('|');
  // Simple hash
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  state.deviceFingerprint = Math.abs(hash).toString(36) + raw.length.toString(36);
  return state.deviceFingerprint;
}

// ─── Storage Helpers ──────────────────────────────────────────────────────────
// Retry wrapper — retries on network/timeout errors only (not 4xx responses)
async function withRetry(fn, maxAttempts = 3, delayMs = 10000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isNetworkErr = err instanceof TypeError || err.name === 'AbortError';
      if (!isNetworkErr || attempt === maxAttempts) {
        updateStatus('error', '❌ Server offline. Try again in 1 min.');
        throw err;
      }
      updateStatus('running', `⏳ Connecting to server... (${attempt}/${maxAttempts})`);
      await sleep(delayMs);
    }
  }
}

// ─── License Check ────────────────────────────────────────────────────────────
async function checkLicense() {
  try {
    const data = await withRetry(() => apiPost('/api/license/check', {
      userId: state.userId,
      deviceFingerprint: getDeviceFingerprint(),
    }));
    state.licenseInfo = data;
    // v2.3.2: mirror to chrome.storage.local so popup.js renders correct plan/trades.
    try { chrome.storage.local.set({ licenseInfo: data }); } catch (_) {}
    return data;
  } catch (err) {
    console.error('[Avalisa] License check failed:', err);
    // On transient network failure, trust last-known-good cached license
    if (state.licenseInfo && state.licenseInfo.allowed) {
      return { ...state.licenseInfo, _networkError: true };
    }
    return { allowed: false, reason: 'Network error', _networkError: true };
  }
}

async function incrementTrade() {
  try {
    await apiPost('/api/license/increment', {
      userId: state.userId,
      deviceFingerprint: getDeviceFingerprint(),
    });
  } catch (err) {
    console.error('[Avalisa] Increment failed:', err);
  }
}

// ─── Avalisa Bot Opportunity Scanner ────────────────────────────────────────
// periodSec defaults to the AI analysis period rather than the chart/expiry
// period. Reading it off the expiry (the old behaviour) meant a 60s expiry asked
// PO for 60s candles, and PO's fixed ~11-minute tick budget only yields ~10 of
// those — below every intensity gate, so the scan could never become ready.
async function ensureAvalisaDataForCurrentPair(
  timeoutMs = 6000,
  requiredCandles = getRequiredCandles(),
  periodSec = AI_ANALYSIS_PERIOD_SEC,
) {
  const started = Date.now();
  let restoredAsset = null;
  while (Date.now() - started < timeoutMs) {
    const asset = normalizeAssetName(getCurrentPair());
    if (asset && asset !== 'UNKNOWN' && periodSec) {
      if (restoredAsset !== asset) {
        restoredAsset = asset;
        const live = getBufferedCandlesFor(asset, periodSec);
        if (!isFreshCandleCache(live, periodSec)) await restoreCandleCache(asset, periodSec);
      }
      requestCandleHistory(asset, periodSec);
      const activeReady = state.activePair === asset && state.activePeriod === periodSec;
      const activeCount = activeReady ? getBufferedCandlesFor(asset, periodSec).length : 0;
      if (activeCount >= requiredCandles) return true;
    }
    await sleep(500);
  }
  return getBufferedCandlesFor(normalizeAssetName(getCurrentPair()), periodSec).length >= requiredCandles;
}

function evaluateAvalisaCurrentPair(intensity, payout = null, source = 'current') {
  const candles = getBufferedCandles();
  const requiredCandles = getRequiredCandles(intensity);
  if (candles.length < requiredCandles) {
    return {
      source,
      // Carry the pair/period even on the not-ready path — without these the
      // scan log printed "pair=undefined" for every stalled favourite, which is
      // precisely the case you need to be able to read.
      asset: state.activePair,
      period: state.activePeriod,
      action: 'SKIP',
      reason: `loading_${candles.length}_${requiredCandles}`,
      candleCount: candles.length,
    };
  }

  const tf = SECONDS_TO_TF[state.activePeriod] || `${state.activePeriod}s`;
  const indicators = buildIndicators(candles, state.activePair, tf);
  if (!indicators) {
    return {
      source,
      asset: state.activePair,
      period: state.activePeriod,
      action: 'SKIP',
      reason: 'missing_indicators',
      candleCount: candles.length,
    };
  }

  const sig = globalThis.AvalisaSignalEngine.evaluateSignal(indicators, intensity);
  recordSignalSnapshot(state.activePair, sig);
  const confidence = sig.snapshot?.confidence || 0;
  const payoutBonus = Number.isFinite(payout) ? Math.max(0, payout - (state.payoutMinPercent || 0)) / 2 : 0;
  const score = confidence + payoutBonus;
  return {
    source,
    asset: state.activePair,
    period: state.activePeriod,
    payout,
    indicators,
    sig,
    action: sig.action,
    reason: sig.reason || 'ok',
    confidence,
    score,
    timeframe: sig.timeframe || tf,
    candleCount: candles.length,
  };
}

function isAvalisaNoProgressReason(reason) {
  // 'otc_filter' is gone in signal engine v3 — High no longer refuses OTC pairs.
  // 'not_enough_rules' is a normal outcome, NOT a stall: the scanner looked and
  // the evidence simply did not line up yet, so it must not count toward the
  // no-progress cooldown.
  return /^loading_\d+_\d+$/.test(String(reason || '')) ||
    ['no_ready_favorite', 'no_favorite_signal', 'no_favorites_above_payout'].includes(reason);
}

function stopAvalisaForDecision(message) {
  if (typeof AvalisaTelemetry !== 'undefined') AvalisaTelemetry.event('pause', 'pair_changed');
  console.warn('[Avalisa] Avalisa stopping for decision:', message);
  state.running = false;
  state.stopRequested = true;
  clearTradeLock();
  updateUI();
  updateStatus('error', message);
}

// v2.4.8: an unexpected error no longer kills the bot on first strike — a
// mid-ladder halt leaves the user holding the accumulated loss. Retry with
// backoff, then self-heal with one page reload (session persists through it),
// and only then stop — preserving the ladder for the next Start.
async function handleTradeCycleError(err, generation) {
  const message = err?.message || String(err || 'unknown error');
  console.error('[Avalisa] Trade cycle error:', err);
  state.lastTradeCycleError = {
    at: new Date().toISOString(),
    generation,
    phase: state.tradeLockPhase || null,
    name: err?.name || 'Error',
    message,
  };

  if (generation !== state.cycleGeneration) return;

  state.cycleErrorStreak = (state.cycleErrorStreak || 0) + 1;

  if (!state.isTradeOpen && state.cycleErrorStreak <= MAX_CYCLE_ERROR_RETRIES) {
    const backoffMs = 3000 * state.cycleErrorStreak;
    clearTradeLock();
    updateStatus('running', `Page hiccup — retrying in ${Math.round(backoffMs / 1000)}s (${state.cycleErrorStreak}/${MAX_CYCLE_ERROR_RETRIES + 1})`);
    await persistRuntimeSession('cycle_error_retry');
    await sleep(backoffMs);
    if (isCycleActive(generation)) runTradeCycle(generation).catch(console.error);
    return;
  }

  if (!state.isTradeOpen && (state.cycleErrorReloads || 0) < 1) {
    state.cycleErrorReloads = (state.cycleErrorReloads || 0) + 1;
    state.cycleErrorStreak = 0;
    clearTradeLock();
    await persistRuntimeSession('auto_reload_error');
    updateStatus('running', 'Repeated page errors — reloading PO to recover, ladder continues');
    setTimeout(() => window.location.reload(), 1500);
    return;
  }

  await preservePausedLadder('cycle_error');
  state.running = false;
  state.stopRequested = true;
  state.cycleErrorStreak = 0;
  state.cycleErrorReloads = 0;
  clearTradeLock();
  clearRuntimeSession().catch(() => {});
  state.stopAfterTrade = false;
  updateUI();
  updateStatus('error', 'Avalisa stopped safely — Pocket Option changed or page error. Press Start to resume the ladder.');
}

async function chooseAvalisaOpportunity(intensity, generation) {
  if (state.tradeLock || state.isTradeOpen) {
    return { source: 'current', action: 'SKIP', reason: state.tradeLockPhase || 'trade_open' };
  }

  const { minPct } = getPayoutSettings();
  const requiredCandles = getRequiredCandles(intensity);
  const currentReady = await ensureAvalisaDataForCurrentPair(6000, requiredCandles);
  if (!isCycleActive(generation)) return { action: 'SKIP', reason: 'cancelled' };
  const currentPayout = getCurrentPayoutPercent();
  const current = currentReady
    ? evaluateAvalisaCurrentPair(intensity, currentPayout, 'current')
    : { action: 'SKIP', reason: 'no_ready_favorite', source: 'current' };
  console.log(`[Avalisa] Avalisa scan current: action=${current.action} pair=${current.asset} payout=${current.payout ?? 'n/a'} confidence=${current.confidence || 0} tf=${current.timeframe || 'n/a'} reason=${current.reason}`);
  if (current.action !== 'SKIP') return current;

  if (state.settings?.aiPairMode === 'current') {
    return { ...current, reason: current.reason || 'current_pair_only' };
  }

  const favorites = getFavoritePairs()
    .filter(f => Number.isFinite(f.payout) && f.payout >= minPct)
    .sort((a, b) => b.payout - a.payout)
    .slice(0, AI_SCAN_MAX_FAVORITES);

  if (favorites.length === 0) {
    return { ...current, reason: current.reason || 'no_favorites_above_payout' };
  }

  let sawLoadingCandidate = false;
  for (const fav of favorites) {
    if (!state.running || state.stopRequested || generation !== state.cycleGeneration) return current;
    updateStatus('running', `Scanning ${fav.name} (${fav.payout}%)`);
    console.log(`[Avalisa] Avalisa scan: switching to favorite ${fav.name} (${fav.payout}%)`);
    if (!clickFavoritePair(fav)) continue;
    await sleep(1800);
    if (!isCycleActive(generation)) return { action: 'SKIP', reason: 'cancelled' };
    const ready = await ensureAvalisaDataForCurrentPair(7000, requiredCandles);
    // Only evaluate once the buffer actually belongs to the pair we just
    // switched to. Observed live 2026-08-17: 1 scan in 12 timed out mid-switch
    // and evaluated the PREVIOUS pair's candles while labelled as the new
    // favourite — a non-SKIP there would have traded this pair on another
    // pair's indicators.
    if (!isCycleActive(generation)) return { action: 'SKIP', reason: 'cancelled' };
    const wanted = normalizeAssetName(getCurrentPair());
    if (wanted !== normalizeAssetName(fav.name) || !ready || !wanted || wanted === 'UNKNOWN' || state.activePair !== wanted) {
      console.log(`[Avalisa] Avalisa scan favorite: SKIP ${fav.name} — data not ready for ${wanted || 'unknown'} (buffer holds ${state.activePair || 'nothing'})`);
      sawLoadingCandidate = true;
      continue;
    }
    const livePayout = getCurrentPayoutPercent();
    if (livePayout === null || livePayout < minPct) continue;
    const candidate = evaluateAvalisaCurrentPair(intensity, livePayout, 'favorite');
    candidate.favoriteName = fav.name;
    console.log(`[Avalisa] Avalisa scan favorite: action=${candidate.action} pair=${candidate.asset} favorite=${fav.name} payout=${fav.payout} confidence=${candidate.confidence || 0} tf=${candidate.timeframe || 'n/a'} reason=${candidate.reason}`);
    if (candidate.action !== 'SKIP') return candidate;
    if (/^loading_\d+_\d+$/.test(candidate.reason || '')) sawLoadingCandidate = true;
  }

  return { ...current, reason: sawLoadingCandidate ? 'no_ready_favorite' : 'no_favorite_signal' };
}

// ─── Trading Engine ───────────────────────────────────────────────────────────
function isCycleActive(generation) {
  return state.running && !state.stopRequested && generation === state.cycleGeneration;
}

function setTradeLock(phase) {
  state.tradeLock = true;
  state.tradeLockPhase = phase || 'trade_open';
  state.tradeLockSince = Date.now();
  state.isTradeOpen = true;
}

function clearTradeLock() {
  state.tradeLock = false;
  state.tradeLockPhase = null;
  state.tradeLockSince = 0;
  state.isTradeOpen = false;
}

// v2.4.8: a single balance read is not enough evidence to kill a live ladder —
// PO re-renders and overlays can produce one-off misreads. Require two reads,
// a beat apart, that agree with each other before trusting the number.
async function getConfirmedBalance() {
  const first = await getBalance().catch(() => null);
  if (!Number.isFinite(first) || first <= 0) return null;
  await sleep(BALANCE_CONFIRM_DELAY_MS);
  const second = await getBalance().catch(() => null);
  if (!Number.isFinite(second) || second <= 0) return null;
  if (Math.abs(first - second) > Math.max(1, first * 0.02)) {
    console.warn(`[Avalisa] Balance reads disagree (${first} vs ${second}) — treating balance as unknown`);
    return null;
  }
  return Math.max(first, second);
}

async function retryAfterAmountSetFailure(generation, safeAmount) {
  const availableBalance = await getConfirmedBalance();
  if (Number.isFinite(availableBalance) && availableBalance > 0 && safeAmount > availableBalance + 0.01) {
    await pauseRecoveryAfterAmountSetFailure(generation, safeAmount, availableBalance);
    return;
  }

  state.amountSetFailures = (state.amountSetFailures || 0) + 1;
  state.lastTradeCycleError = {
    at: new Date().toISOString(),
    generation,
    phase: 'set_amount',
    name: 'AmountSetFailed',
    message: `Could not set trade amount ${safeAmount}`,
  };
  await persistRuntimeSession('amount_retry');
  closePOPopovers();

  if (state.amountSetFailures >= 3) {
    if ((state.recoveryReloads || 0) >= MAX_RECOVERY_RELOADS) {
      await pauseRecoveryAfterAmountSetFailure(generation, safeAmount, availableBalance);
      return;
    }
    state.recoveryReloads = (state.recoveryReloads || 0) + 1;
    state.amountSetFailures = 0;
    await persistRuntimeSession('auto_reload_amount');
    updateStatus('running', `Amount control stuck — reloading PO (${state.recoveryReloads}/${MAX_RECOVERY_RELOADS}), then continuing $${safeAmount.toFixed(2)} recovery`);
    setTimeout(() => window.location.reload(), 1500);
    return;
  }

  const retryMs = 2500 + (state.amountSetFailures * 1000);
  updateStatus('running', `Could not set $${safeAmount.toFixed(2)} — refreshing controls, retrying (${state.amountSetFailures}/3)`);
  await sleep(retryMs);
  if (isCycleActive(generation)) runTradeCycle(generation).catch(console.error);
}

async function pauseRecoveryAfterAmountSetFailure(generation, safeAmount, availableBalance = null) {
  const hasBalance = Number.isFinite(availableBalance) && availableBalance > 0;
  const balanceText = hasBalance ? ` above balance $${availableBalance.toFixed(2)}` : '';
  const aboveBalance = hasBalance && safeAmount > availableBalance + 0.01;
  state.lastTradeCycleError = {
    at: new Date().toISOString(),
    generation,
    phase: aboveBalance ? 'amount_above_balance' : 'amount_control_stuck',
    name: 'RecoveryPaused',
    message: `Could not safely set recovery amount ${safeAmount}${balanceText}`,
  };
  // Reset only the host input; the paused recovery ladder keeps its amount.
  const configuredStart = Number(state.settings?.startAmount);
  let restoreAmount = Number.isFinite(configuredStart) ? Math.max(1, configuredStart) : 1;
  let restored = setTradeAmount(restoreAmount);
  if (!restored && restoreAmount !== 1) {
    console.warn('[Avalisa] PO rejected the starting amount during reset — trying minimum 1.00');
    restoreAmount = 1;
    restored = setTradeAmount(restoreAmount);
  }
  if (restored) {
    console.log('[Avalisa] PO amount input restored after rejection:', restoreAmount.toFixed(2));
  } else {
    console.warn('[Avalisa] Could not restore PO amount input after rejection; check the amount before manual trading.');
  }
  await preservePausedLadder(aboveBalance ? 'amount_above_balance' : 'amount_control_stuck');
  state.running = false;
  state.stopRequested = true;
  state.amountSetFailures = 0;
  state.recoveryReloads = 0;
  clearTradeLock();
  await clearRuntimeSession();
  updateUI();
  updateStatus(
    'error',
    aboveBalance
      ? `Recovery paused — $${safeAmount.toFixed(2)} is above balance $${availableBalance.toFixed(2)}. Top up or lower start amount, then press Start to resume the ladder.`
      : `Recovery paused — PO would not accept $${safeAmount.toFixed(2)} after reloads. Press Start to resume the ladder.`
  );
}

async function recoverAfterUnconfirmedOrder() {
  state.unconfirmedOrderFailures = (state.unconfirmedOrderFailures || 0) + 1;
  closePOPopovers();

  if (state.unconfirmedOrderFailures >= MAX_UNCONFIRMED_ORDER_FAILURES) {
    updateStatus('error', `Order confirmation failed ${state.unconfirmedOrderFailures} times — stopped to avoid a stuck loop`);
    state.running = false;
    state.stopRequested = true;
    clearTradeLock();
    updateUI();
    return false;
  }

  const { minPct } = getPayoutSettings();
  const favorites = getFavoritePairs()
    .filter(fav => fav.payout >= minPct)
    .sort((a, b) => b.payout - a.payout);

  if (favorites.length > 0) {
    console.warn('[Avalisa] Recovering unconfirmed order by refreshing a payout-qualified favorite:', favorites[0].name, favorites[0].payout);
    clickFavoritePair(favorites[0]);
    await sleep(2500);
  } else {
    await sleep(AI_NO_PROGRESS_RETRY_MS);
  }

  return true;
}

function getNextDirection() {
  // Martingale mode — use user direction setting
  const dir = state.settings.direction;
  if (dir === 'call') return 'call';
  if (dir === 'put') return 'put';
  // alternating
  state.lastDirection = state.lastDirection === 'call' ? 'put' : 'call';
  return state.lastDirection;
}

async function runTradeCycle(generation) {
  try {
    await runTradeCycleUnsafe(generation);
  } catch (err) {
    await handleTradeCycleError(err, generation);
  }
}

async function runTradeCycleUnsafe(generation) {
  if (!isCycleActive(generation)) return;

  if (state.tradeLock || state.isTradeOpen) {
    console.log('[Avalisa] Trade locked, waiting...', state.tradeLockPhase || 'trade_open');
    updateStatus('running', 'Trade locked — waiting...');
    await sleep(3000);
    if (isCycleActive(generation)) runTradeCycle(generation).catch(err => console.error('[Avalisa] Cycle error:', err));
    return;
  }

  // License check
  const license = await checkLicense();
  if (!isCycleActive(generation)) return;
  if (!license.allowed) {
    if (license._networkError) {
      updateStatus('error', 'Network error — check connection');
    } else {
      updateStatus('error', `Trade limit reached (${license.plan || 'unknown'} plan)`);
      showLimitReachedMessage(license);
    }
    state.running = false;
    updateUI();
    return;
  }

  const aiAllowanceBlock = getAiAllowanceBlock(license);
  if (aiAllowanceBlock) {
    updateStatus('error', aiAllowanceBlock.message);
    state.running = false;
    state.stopRequested = true;
    updateUI();
    showLimitReachedMessage({ reason: aiAllowanceBlock.reason });
    return;
  }

  // Payout monitor — only on fresh martingale sequence starts (never mid-sequence)
  if (state.martingaleStep === 0) {
    const pay = await checkPayoutBeforeTrade({
      allowSwitch: !(state.settings.strategy === 'ai' && state.settings.aiPairMode === 'current'),
    });
    if (!isCycleActive(generation)) return;
    if (!pay.proceed) {
      if (pay.halt) {
        if (typeof AvalisaTelemetry !== 'undefined') AvalisaTelemetry.event('pause', 'payout_halt');
        console.warn('[Avalisa] Payout Monitor: halting bot —', pay.reason);
        updateStatus('error', `Payout Monitor: ${pay.reason}`);
        state.running = false;
        state.stopRequested = true;
        updateUI();
        return;
      }
    }
  }

  // Signal-mode guard: Basic gets limited Avalisa Bot trades; Pro is unlimited.
  if (state.settings.strategy === 'ai' && !['basic', 'lifetime'].includes(license.plan)) {
    state.settings.strategy = 'martingale';
    state.settings.aiAssist = false;
    const stratEl = document.getElementById('av-strategy');
    if (stratEl) stratEl.value = 'martingale';
    updateUI();
    updateStatus('error', 'Avalisa Bot requires Basic or Pro. Switched to Martingale.');
  }

  // AI mode: local rule engine — zero network calls
  let aiDecidedDirection = null;
  let aiSignalSnapshot = null;
  let aiSuggestedTimeframe = null;
  let signalAsset = null;
  let signalSource = null;
  let signalAt = Date.now();
  if (state.settings.strategy === 'ai') {
    // Wait for warmup — normally satisfied instantly by the updateHistoryNewFast seed
    const intensity = state.settings.intensity || state.settings.aiIntensity || 'mid';
    const requiredCandles = getRequiredCandles(intensity);
    let candles = getBufferedCandles();
    let warmupTries = 0;
    let lastCount = candles.length;
    while (candles.length < requiredCandles && state.running && !state.stopRequested) {
      updateStatus('running', `Loading: ${candles.length}/${requiredCandles}`);
      const asset = normalizeAssetName(getCurrentPair());
      const periodSec = AI_ANALYSIS_PERIOD_SEC;
      requestCandleHistory(asset, periodSec);
      await sleep(2000);
      if (!isCycleActive(generation)) return;
      candles = getBufferedCandles();
      warmupTries = candles.length > lastCount ? 0 : warmupTries + 1;
      lastCount = candles.length;
      if (warmupTries >= AI_MAX_NO_PROGRESS_CYCLES) {
        if (state.settings.aiPairMode === 'current') {
          state.aiNoProgressCycles = (state.aiNoProgressCycles || 0) + 1;
          updateStatus('running', `Waiting for candles: ${candles.length}/${requiredCandles} — retrying (${state.aiNoProgressCycles})`);
          await sleep(AI_NO_PROGRESS_RETRY_MS);
          if (isCycleActive(generation)) runTradeCycle(generation).catch(console.error);
          return;
        }
        console.warn('[Avalisa] Avalisa warmup stalled — scanning favorites instead:', candles.length, '/', requiredCandles);
        updateStatus('running', `Loading stalled (${candles.length}/${requiredCandles}) — scanning favorites`);
        break;
      }
    }
    if (!isCycleActive(generation)) return;

    // v2.3.1: settings field is `intensity` (set in saveCurrentSettings/dropdown), not `aiIntensity`.
    // Old code always fell through to 'mid' regardless of user's Low/High pick.
    const opportunity = await chooseAvalisaOpportunity(intensity, generation);
    if (!isCycleActive(generation)) return;
    const sig = opportunity?.sig || { action: 'SKIP', reason: opportunity?.reason || 'not_enough_rules' };
    signalAt = Date.now();
    aiSignalSnapshot = sig.snapshot || null;
    signalAsset = opportunity?.asset || null;
    signalSource = opportunity?.source || null;
    aiSuggestedTimeframe = opportunity?.timeframe || sig.timeframe || null;

    console.log(`[Avalisa] Avalisa selected: action=${sig.action} pair=${opportunity?.asset || getCurrentPair()} source=${opportunity?.source || 'current'} confidence=${opportunity?.confidence || 0} tf=${aiSuggestedTimeframe || 'n/a'} reason=${sig.reason || opportunity?.reason || 'ok'} rules=${sig.snapshot?.rulesMatched}`);

    if (sig.action === 'SKIP') {
      const reason = sig.reason || opportunity?.reason || 'not_enough_rules';
      const noProgressReason = isAvalisaNoProgressReason(reason);
      if (noProgressReason) {
        state.aiNoProgressCycles = (state.aiNoProgressCycles || 0) + 1;
      } else {
        state.aiNoProgressCycles = 0;
      }
      // SKIP: re-check soon, using the live PO duration as the retry clock.
      const candleMs = getCurrentPeriodSeconds() * 1000;
      const retryMs = noProgressReason ? 5000 : Math.min(candleMs, 30000);
      // Say how close it got, so a scan that is working but unconvinced does not
      // look identical to one that is stuck.
      const snap = sig.snapshot;
      const skipMsg = (reason === 'not_enough_rules' && snap && Number.isFinite(snap.rulesMatched))
        ? `SKIP — ${snap.rulesMatched}/${snap.required} rules (${snap.intensity}) — scanning again`
        : `SKIP (${reason}) — scanning again (${state.aiNoProgressCycles || 0})`;
      updateStatus('running', skipMsg);
      await sleep(retryMs);
      if (isCycleActive(generation)) {
        runTradeCycle(generation).catch(console.error);
      }
      return;
    }
    state.aiNoProgressCycles = 0;
    aiDecidedDirection = sig.action === 'CALL' ? 'call' : 'put';
  }

  const amount = state.currentAmount;
  if (!amount || amount <= 0) {
    state.currentAmount = parseFloat(state.settings.startAmount) || 1.0;
  }
  const safeAmount = state.currentAmount;

  const direction = aiDecidedDirection || getNextDirection();
  const executionAsset = normalizeAssetName(getCurrentPair());
  if (signalAsset && executionAsset !== signalAsset) {
    stopAvalisaForDecision('Pair changed after signal — restart to rescan');
    return;
  }

  updateStatus('running', `Trade #${state.tradesCount + 1} — ${direction.toUpperCase()} $${safeAmount.toFixed(2)}`);

  // Signal mode now executes on Avalisa Bot's selected duration. Martingale still uses
  // the saved bot timeframe setting from the extension panel.
  let executionTimeframe = state.settings?.timeframe || 'M1';
  if (state.settings.strategy === 'ai') {
    const requestedTf = aiSuggestedTimeframe && TF_TO_SECONDS[aiSuggestedTimeframe]
      ? aiSuggestedTimeframe
      : (SECONDS_TO_TF[getCurrentPeriodSeconds()] || 'M1');
    const selectedTf = await setTimeframe(requestedTf);
    if (!selectedTf) {
      updateStatus('running', `Timeframe ${requestedTf} unavailable — retrying`);
      await sleep(AI_NO_PROGRESS_RETRY_MS);
      if (isCycleActive(generation)) runTradeCycle(generation).catch(console.error);
      return;
    }
    executionTimeframe = selectedTf;
    if (selectedTf !== requestedTf) {
      const asset = normalizeAssetName(getCurrentPair());
      const periodSec = TF_TO_SECONDS[selectedTf] || getCurrentPeriodSeconds(selectedTf);
      requestCandleHistory(asset, periodSec, true);
      updateStatus('running', `${requestedTf} unavailable — using ${selectedTf}, rescanning`);
      await sleep(1500);
      if (isCycleActive(generation)) runTradeCycle(generation).catch(console.error);
      return;
    }
  } else {
    const requestedTf = state.settings.timeframe || 'M1';
    const selectedTf = await setTimeframe(requestedTf);
    if (!selectedTf) {
      updateStatus('running', `Timeframe ${requestedTf} unavailable — retrying`);
      await sleep(AI_NO_PROGRESS_RETRY_MS);
      if (isCycleActive(generation)) runTradeCycle(generation).catch(console.error);
      return;
    }
    executionTimeframe = selectedTf;
    if (selectedTf !== requestedTf) {
      state.settings.timeframe = selectedTf;
      const tfEl = document.getElementById('av-timeframe');
      if (tfEl) tfEl.value = selectedTf;
      updateStatus('running', `${requestedTf} unavailable — using ${selectedTf}`);
    }
  }
  if (!isCycleActive(generation)) return;

  if (!setTradeAmount(safeAmount)) {
    if (!isCycleActive(generation)) return;
    await retryAfterAmountSetFailure(generation, safeAmount);
    return;
  }
  state.amountSetFailures = 0;
  state.recoveryReloads = 0;
  state.cycleErrorStreak = 0;
  state.cycleErrorReloads = 0;
  await persistRuntimeSession('amount_set');

  // PO can accept a favorite/timeframe click visually before its trade controls
  // are fully ready. Give pair switches a short settle window before order click.
  const pairSwitchAge = state.lastPairSwitchAt ? Date.now() - state.lastPairSwitchAt : Infinity;
  if (pairSwitchAge < 2500) await sleep(2500 - pairSwitchAge);
  await sleep(700);
  if (!isCycleActive(generation)) return;

  await sleep(500);
  if (!isCycleActive(generation)) return;
  const balanceBefore = await getBalance();
  if (!isCycleActive(generation)) return;
  console.log('[Avalisa] Balance before trade:', balanceBefore);

  const expiryMs = getExpiryMs();

  const preTradeSignatures = getLatestDealSignatures();
  const preTradeDealCount = countDealElements();
  console.log('[Avalisa] pre-trade deal signatures:', preTradeSignatures);

  const tradeStartTs = Date.now();
  closePOPopovers();
  await sleep(200);
  if (!isCycleActive(generation)) return;
  if (normalizeAssetName(getCurrentPair()) !== executionAsset) {
    stopAvalisaForDecision('Pair changed before order — restart to rescan');
    return;
  }
  state.currentDealId = null;
  state.currentTradeIdentity = { tradeStartTs, asset: executionAsset, amount: safeAmount };
  const tradeMeta = {
    payoutPct: getCurrentPayoutPercent(),
    martingaleStep: state.martingaleStep,
    extVersion: chrome.runtime.getManifest().version,
    source: signalSource,
    intensity: aiSignalSnapshot?.intensity || null,
    ...(typeof AvalisaTelemetry !== 'undefined' ? {
      market: AvalisaTelemetry.market(executionAsset),
      expirySeconds: expiryMs / 1000,
      entryDelayMs: Math.max(0, Date.now() - signalAt),
    } : {}),
  };
  const orderStrategy = state.settings?.strategy || 'martingale';
  const orderIsDemo = isDemoMode();
  const clickedAt = Date.now();
  if (typeof AvalisaTelemetry !== 'undefined') AvalisaTelemetry.event('order_attempt', null, { pair: executionAsset, amount: safeAmount });
  const placed = direction === 'call' ? clickCall() : clickPut();
  if (!placed) {
    if (typeof AvalisaTelemetry !== 'undefined') AvalisaTelemetry.event('open_unconfirmed', 'button_missing');
    if (!isCycleActive(generation)) return;
    updateStatus('error', `Could not find ${direction.toUpperCase()} button`);
    return;
  }

  setTradeLock('order_pending');
  await persistRuntimeSession('order_pending');
  updateStatus('running', 'Order sent — confirming open...');

  // PO can delay stake deduction under load/background throttling. Waiting
  // longer is safer than retrying while a first click may still become live.
  let openResult = await waitForTradeOpen(balanceBefore, safeAmount, 45000, preTradeDealCount);
  if (!isCycleActive(generation)) return;
  if (!openResult.opened) {
    console.warn('[Avalisa] Trade click was not confirmed open — watching for a late PO open:', openResult.method);
    state.tradeLockPhase = `unconfirmed_${openResult.method}`;
    updateStatus('running', `Order not confirmed (${openResult.method}) — watching for late open`);
    openResult = await waitForTradeOpen(balanceBefore, safeAmount, LATE_OPEN_WATCH_MS, preTradeDealCount);
    if (!isCycleActive(generation)) return;
    if (!openResult.opened) {
      console.warn('[Avalisa] No late balance confirmation — clearing lock and continuing without counting trade:', openResult.method);
      if (typeof AvalisaTelemetry !== 'undefined') AvalisaTelemetry.event('open_unconfirmed', openResult.method);
      clearTradeLock();
      if (state.stopAfterTrade) { stopBot(); return; }
      const canContinue = await recoverAfterUnconfirmedOrder();
      if (!canContinue || !isCycleActive(generation)) return;
      const cooldownMs = Math.min(Math.max(AI_NO_PROGRESS_RETRY_MS, 5000), 15000);
      updateStatus('running', `No confirmed order — refreshed controls, retrying in ${Math.round(cooldownMs / 1000)}s`);
      await sleep(cooldownMs);
      if (isCycleActive(generation)) runTradeCycle(generation).catch(console.error);
      return;
    }
  }
  const balanceDuringTrade = openResult.balanceDuring;

  setTradeLock('trade_open');
  await persistRuntimeSession('trade_open');
  state.unconfirmedOrderFailures = 0;
  console.log('[Avalisa] Trade confirmed open. isTradeOpen = true. Balance during:', balanceDuringTrade, 'method:', openResult.method);

  const tradeGuardTimeout = setTimeout(() => {
    if (state.tradeLock || state.isTradeOpen) {
      console.warn('[Avalisa] Safety timeout — marking unknown and allowing resolver/loop to continue');
      state.tradeLockPhase = 'safety_timeout';
      updateStatus('running', 'Trade result delayed — resolving as unknown if needed');
    }
  }, expiryMs + 30000);

  state.tradesCount++;
  await incrementTrade();
  updateTradeCounter();

  updateStatus('running', `Trade open — waiting ${Math.round(expiryMs / 1000)}s for result…`);
  await sleep(expiryMs + 3000);

  clearTimeout(tradeGuardTimeout);
  state.tradeLockPhase = 'resolving_result';
  if (!isCycleActive(generation)) return;

  // 3-tier result detection: WS close event → DOM scrape → balance diff
  const result = await resolveTradeResult(balanceBefore, balanceDuringTrade, safeAmount, tradeStartTs, preTradeSignatures);
  const balanceAfter = await getBalance();
  if (!isCycleActive(generation)) return;

  if (typeof AvalisaTelemetry !== 'undefined') {
    tradeMeta.po = AvalisaTelemetry.po();
    tradeMeta.timeToResultMs = Math.max(0, Date.now() - clickedAt);
    if (result === 'unknown') AvalisaTelemetry.event('result_unknown', state.lastTradeResultDebug?.method || 'unknown');
  }
  const detectedResultMethod = state.lastTradeResultDebug?.method || 'unknown';
  tradeMeta.resultMethod = ['ws', 'balance', 'dom-late', 'unknown'].includes(detectedResultMethod)
    ? detectedResultMethod : 'other';
  if (state.jwt) {
    withRetry(() => apiPost('/api/trades/log', {
      pair: executionAsset,
      direction,
      amount: safeAmount,
      result,
      balanceBefore,
      balanceAfter,
      isDemo: orderIsDemo,
      strategy: orderStrategy,
      timeframe: executionTimeframe
        ? executionTimeframe
        : (state.activePeriod ? `${state.activePeriod}s` : (state.settings?.timeframe || 'M1')),
      signalSnapshot: aiSignalSnapshot,
      meta: tradeMeta,
    })).catch(console.error);
  }

  applyMartingaleLogic(result);
  await persistRuntimeSession('resolved');
  clearTradeLock();
  if (state.stopAfterTrade) { stopBot(); return; }

  if (isCycleActive(generation)) {
    updateStatus('running', `Last: ${result.toUpperCase()} | Next: $${state.currentAmount.toFixed(2)}`);
    updateBottomStatus();
  }

  if (!isCycleActive(generation)) return;

  // AI mode: short delay (AI decides timing). Martingale mode: user delay.
  const delay = state.settings.strategy === 'ai' ? 1500 : (state.settings.delaySeconds || 6) * 1000;
  await sleep(delay);

  if (isCycleActive(generation)) {
    runTradeCycle(generation).catch(err => console.error('[Avalisa] Cycle error:', err));
  }
}

// v2.3.1: stronger guard. Old code reset to startAmount only when amount<=0,
// allowing NaN to leak through. Now any non-finite or non-positive value triggers reset.
function applyMartingaleLogic(result) {
  const s = state.settings;
  // Guard against undefined/NaN settings values from stale stored settings
  const multiplier = parseFloat(s.martingaleMultiplier) || 2.0;
  const startAmount = parseFloat(s.startAmount) || 1.0;
  const maxSteps = s.martingaleSteps === 'infinite' ? Infinity : (parseInt(s.martingaleSteps) || Infinity);

  // TIE/UNKNOWN: hold current amount and step. Never ladder or reset on unclear data.
  if (result === 'tie' || result === 'unknown') {
    console.log(`[Avalisa] Martingale: result=${String(result).toUpperCase()} step=${state.martingaleStep} nextAmount=${state.currentAmount} (holding)`);
    return;
  }

  if (result === 'loss') {
    if (state.martingaleStep < maxSteps) {
      state.martingaleStep++;
      state.currentAmount = parseFloat((state.currentAmount * multiplier).toFixed(2));
    } else {
      // Max steps reached — reset
      state.martingaleStep = 0;
      state.currentAmount = startAmount;
    }
  } else {
    // Win — reset
    state.martingaleStep = 0;
    state.currentAmount = startAmount;
  }
  // A preserved ladder is only meaningful between a safety stop and the next
  // Start. Once the live ladder has resolved back to step 0 that snapshot is
  // history, and leaving it in storage lets a LATER Start resurrect an old high
  // rung: observed 2026-08-17 — a $4/step-2 snapshot was preserved mid-ladder,
  // that ladder then WON and reset, and 22 minutes later Start restored $4 and
  // opened there instead of $1 (PAUSED_LADDER_MAX_AGE_MS is 30 min).
  if (state.martingaleStep === 0) {
    clearPausedLadder().catch(() => {});
  }

  console.log(`[Avalisa] Martingale: result=${result} step=${state.martingaleStep} nextAmount=${state.currentAmount} multiplier=${multiplier}`);
}

// ─── UI Overlay ────────────────────────────────────────────────────────────────
let overlayEl = null;

function injectOverlay() {
  if (document.getElementById('avalisa-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'avalisa-overlay';
  overlay.innerHTML = getOverlayHTML();

  const style = document.createElement('style');
  style.textContent = getOverlayCSS();

  document.head.appendChild(style);
  document.body.appendChild(overlay);
  overlayEl = overlay;

  bindOverlayEvents();
  updateUI();
  if (state.jwt) checkClaimStatus();
}

function injectHeaderButton() {
  if (document.getElementById('avalisa-header-btn')) return;
  const header = document.querySelector('.header__right') ||
    document.querySelector('.header-right') ||
    document.querySelector('header');
  if (!header) return;

  const btn = document.createElement('button');
  btn.id = 'avalisa-header-btn';
  btn.textContent = 'Bot Menu';
  btn.style.cssText = `
    background: #7c3aed; color: #fff; border: none; border-radius: 6px;
    padding: 6px 14px; font-size: 13px; font-weight: 600; cursor: pointer;
    margin-left: 10px; z-index: 9999;
  `;
  btn.addEventListener('click', () => {
    const panel = document.getElementById('avalisa-overlay');
    if (panel) panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
  });
  header.appendChild(btn);
}

function applyStrategyUI(strategy) {
  const isAi = strategy === 'ai';
  const strategySelect = document.getElementById('av-strategy');
  const rowDirection = document.getElementById('av-row-direction');
  const rowTimeframe = document.getElementById('av-row-timeframe');
  const rowIntensity = document.getElementById('av-row-intensity');
  const rowAiPairMode = document.getElementById('av-row-ai-pair-mode');

  if (rowDirection) rowDirection.style.display = isAi ? 'none' : 'flex';
  if (rowTimeframe) rowTimeframe.style.display = isAi ? 'none' : 'flex';
  if (rowIntensity) rowIntensity.style.display = isAi ? 'flex' : 'none';
  if (rowAiPairMode) rowAiPairMode.style.display = isAi ? 'flex' : 'none';
  if (strategySelect) {
    strategySelect.style.borderColor = isAi ? '#7C3AED' : '#2d2d5b';
    strategySelect.style.borderWidth = isAi ? '2px' : '1px';
  }
}

function applyPayoutControlsUI() {
  const payoutEnabled = document.getElementById('av-payout-enabled');
  const payoutMin = document.getElementById('av-payout-min');
  const payoutAction = document.getElementById('av-payout-action');
  const enabled = payoutEnabled ? payoutEnabled.checked : true;
  const locked = state.running;
  if (payoutMin) payoutMin.disabled = locked || !enabled;
  if (payoutAction) payoutAction.disabled = locked || !enabled;
}

function formatUserEmailForPanel(email) {
  const value = String(email || '').trim();
  if (value.length <= 22) return value;
  const at = value.indexOf('@');
  if (at > 0) {
    const local = value.slice(0, at);
    const domain = value.slice(at + 1);
    if (local.length > 12) return `${local.slice(0, 12)}...@${domain}`;
  }
  return `${value.slice(0, 17)}...`;
}

function bindOverlayEvents() {
  document.getElementById('av-close').addEventListener('click', () => {
    document.getElementById('avalisa-overlay').style.display = 'none';
  });

  document.getElementById('av-register-free-btn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_TAB', url: state.affiliateLink });
  });
  document.getElementById('av-logout-btn').addEventListener('click', handleLogout);
  makePanelDraggable();
  document.getElementById('av-start-btn').addEventListener('click', startBot);
  document.getElementById('av-stop-btn').addEventListener('click', stopBot);

  // Strategy dropdown — toggle UI between Martingale and AI mode
  document.getElementById('av-strategy').addEventListener('change', (e) => {
    const strategy = e.target.value;
    state.settings.strategy = strategy;
    state.settings.aiAssist = strategy === 'ai';
    state.lastSignal = null;
    if (!state.running && strategy === 'martingale') updateStatus('', 'Stopped');
    applyStrategyUI(strategy);
    updateBottomStatus();
    if (strategy === 'ai') prefillCandleHistory().catch(console.error);
    saveCurrentSettings();
  });

  // Bot pill — open dashboard bots tab
  const pill = document.getElementById('av-bot-pill');
  if (pill) {
    pill.addEventListener('click', () => {
      window.open(`${DASHBOARD_URL}/dashboard?tab=bots`, '_blank');
    });
  }

  // Settings changes — auto-save
  ['av-direction', 'av-timeframe', 'av-multiplier', 'av-steps', 'av-intensity', 'av-ai-pair-mode'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', saveCurrentSettings);
  });
  document.getElementById('av-start-amount').addEventListener('change', saveCurrentSettings);

  // Payout Monitor inputs — persist directly to chrome.storage.local
  const payoutMin = document.getElementById('av-payout-min');
  if (payoutMin) {
    const commit = () => {
      let v = parseInt(payoutMin.value, 10);
      if (!Number.isFinite(v)) v = 90;
      v = Math.max(1, Math.min(100, v));
      payoutMin.value = v;
      state.payoutMinPercent = v;
      chrome.storage.local.set({ payoutMinPercent: v });
    };
    payoutMin.addEventListener('change', commit);
    payoutMin.addEventListener('blur', commit);
  }
  const payoutEnabled = document.getElementById('av-payout-enabled');
  const payoutAction = document.getElementById('av-payout-action');
  const commitPayoutAction = () => {
    const enabled = payoutEnabled ? payoutEnabled.checked : true;
    const action = enabled ? (payoutAction?.value || 'switch') : 'off';
    state.payoutAction = action;
    applyPayoutControlsUI();
    chrome.storage.local.set({ payoutAction: action });
  };
  if (payoutEnabled) payoutEnabled.addEventListener('change', commitPayoutAction);
  if (payoutAction) payoutAction.addEventListener('change', commitPayoutAction);

  document.getElementById('av-affiliate-link').href = state.affiliateLink;
  document.getElementById('av-upgrade-link').href = `${DASHBOARD_URL}/pricing`;
  const plansLink = document.getElementById('av-plans-link');
  if (plansLink) plansLink.href = `${DASHBOARD_URL}/pricing`;

  document.getElementById('av-claim-btn').addEventListener('click', handleClaimClick);
  document.getElementById('av-claim-submit').addEventListener('click', handleClaimSubmit);
}

// Sign-in moved to the toolbar popup in v2.4.9. There is deliberately no login
// handler here: this script runs inside Pocket Option's page, so a password
// typed here would be readable by PO's own scripts and by any other extension,
// and Chrome's password manager would refill it on every load. The popup runs on
// the extension's own origin, where none of that applies. This script only ever
// sees the resulting JWT, picked up from chrome.storage below.

function handleLogout() {
  state.jwt = null;
  state.userId = null;
  chrome.storage.local.remove(['jwt', 'userId', 'userEmail']);
  updateUI();
}

function diagnosePOInterface() {
  if (!avDebugEnabled()) return;
  console.log('[Avalisa] === PO INTERFACE DIAGNOSTIC ===');

  // Find timeframe elements by keyword
  const tfKeywords = ['timeframe', 'time-frame', 'duration', 'expir', 'period'];
  tfKeywords.forEach(kw => {
    const els = document.querySelectorAll(`[class*="${kw}"], [data-${kw}]`);
    if (els.length) {
      els.forEach(el => debugLog(`[Avalisa] TF element (${kw}):`, el.className, el.textContent.trim().substring(0, 50)));
    }
  });

  // Find all buttons/clickable elements with time-like text
  document.querySelectorAll('button, [role="button"], li, .item').forEach(el => {
    const text = el.textContent.trim();
    if (/^(S\d+|M\d+|H\d+|\d+[smh])$/i.test(text)) {
      debugLog('[Avalisa] Time button found:', el.tagName, el.className, text);
    }
  });

  // Find all input elements.
  // Never log inp.value: this dump runs on every Start and used to print the
  // Avalisa account password in clear text, along with whatever else happened to
  // be in a PO field (we observed a Google OAuth authorization code). Shape only.
  const inputs = document.querySelectorAll('input');
  inputs.forEach(inp => {
    if (inp.type === 'password') {
      debugLog('[Avalisa] Input found:', inp.className, inp.name, inp.type, '<redacted>');
      return;
    }
    debugLog('[Avalisa] Input found:', inp.className, inp.name, inp.type, 'len=' + (inp.value?.length ?? 0));
  });

  // Find active/selected element
  const active = document.querySelector('.active, .selected, [aria-selected="true"]');
  if (active) debugLog('[Avalisa] Active element:', active.className, active.textContent.trim());

  console.log('[Avalisa] === END DIAGNOSTIC ===');
}

// ─── Candle History Prefill ───────────────────────────────────────────────────
let lastHistoryRequestKey = null;
let lastHistoryRequestAt = 0;

function requestCandleHistory(asset, periodSec, force = false) {
  if (!asset || asset === 'UNKNOWN' || !periodSec) return;
  const key = `${asset}:${periodSec}`;
  const now = Date.now();
  if (!force && lastHistoryRequestKey === key && now - lastHistoryRequestAt < 10000) return;
  lastHistoryRequestKey = key;
  lastHistoryRequestAt = now;
  window.postMessage({ type: 'AVALISA_REQUEST_HISTORY', asset, period: periodSec }, '*');
}

async function prefillCandleHistory() {
  const asset = normalizeAssetName(getCurrentPair());
  // AI-only path: always warm the analysis period, not the expiry period.
  const periodSec = AI_ANALYSIS_PERIOD_SEC;
  if (asset && asset !== 'UNKNOWN') {
    await restoreCandleCache(asset, periodSec);
    requestCandleHistory(asset, periodSec);
    debugLog('[Avalisa] prefillCandleHistory: requested history for', asset + ':' + periodSec);
  } else {
    debugLog('[Avalisa] prefillCandleHistory: waiting for active pair before requesting history');
  }
}

async function warmupCandleHistory(attempts = 3, delayMs = 1200) {
  const requiredCandles = getRequiredCandles();
  for (let i = 0; i < attempts; i++) {
    if (state.stopRequested) return;
    await prefillCandleHistory();
    if (getBufferedCandles().length >= requiredCandles) return;
    await sleep(delayMs);
  }
}

async function watchPOSelectionForAvalisa() {
  if (state.settings?.strategy !== 'ai' || state.running) return;
  const asset = normalizeAssetName(getCurrentPair());
  const periodSec = AI_ANALYSIS_PERIOD_SEC;
  if (!asset || asset === 'UNKNOWN') return;
  if (state.activePair === asset && state.activePeriod === periodSec) return;
  await restoreCandleCache(asset, periodSec);
  requestCandleHistory(asset, periodSec);
  updateBottomStatus();
}

// ─── Status Display ──────────────────────────────────────────────────────────
// ─── PO-linked entitlement (no sign-in needed) ───────────────────────────────
// If this Pocket Option account is already linked to a paid Avalisa account, the
// modes unlock without the user typing anything. This is NOT a login: the server
// hands back only the plan and allowance — never a token, an email, or history —
// so a guessed UID buys bot modes on the guesser's own PO account and nothing
// more. Signing in is still required for settings sync, history and support.
async function tryPoLinkedEntitlement() {
  if (state.jwt) return false;                 // a real session always wins
  const uid = getPoUidFromDom();
  if (!uid) return false;
  if (state.poEntitlementUid === uid) return false;   // already resolved this UID
  state.poEntitlementUid = uid;

  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/license/po-entitlement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ poUid: uid }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    if (!data?.linked || !data.plan || data.plan === 'free') return false;

    state.licenseInfo = {
      allowed: true,
      plan: data.plan,
      tradesUsed: data.tradesUsed,
      tradesLimit: data.tradesLimit,
      aiTradesAllowance: data.aiTradesAllowance,
      aiTradesUsed: data.aiTradesUsed,
      viaPoLink: true,
    };
    console.log('[Avalisa] Entitlement unlocked from linked PO account:', data.plan);
    updateUI();
    updateBottomStatus();
    return true;
  } catch (err) {
    return false;
  }
}

// ─── Draggable panel ─────────────────────────────────────────────────────────
// The panel sits over Pocket Option's chart, so it has to be movable. Drag by
// the header; the position is remembered per browser. Double-click the header to
// snap back to the default corner if it ever ends up somewhere awkward.
const PANEL_POS_KEY = 'avalisaPanelPos';

function clampPanelPos(left, top, el) {
  const w = el?.offsetWidth || 280;
  const h = el?.offsetHeight || 200;
  // Always leave a grabbable strip on screen, even if the window is resized
  // smaller than the stored position.
  const maxLeft = Math.max(0, window.innerWidth - w);
  const maxTop = Math.max(0, window.innerHeight - 40);
  return {
    left: Math.min(Math.max(0, left), maxLeft),
    top: Math.min(Math.max(0, top), maxTop),
  };
}

function applyPanelPos(pos) {
  const el = document.getElementById('avalisa-overlay');
  if (!el || !pos) return;
  const { left, top } = clampPanelPos(pos.left, pos.top, el);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.style.right = 'auto';
  el.style.bottom = 'auto';
}

function resetPanelPos() {
  const el = document.getElementById('avalisa-overlay');
  if (!el) return;
  el.style.left = '';
  el.style.top = '';
  el.style.right = '';
  el.style.bottom = '';
  chrome.storage.local.remove(PANEL_POS_KEY);
}

function makePanelDraggable() {
  const el = document.getElementById('avalisa-overlay');
  const handle = el?.querySelector('.av-header');
  if (!el || !handle || handle.dataset.avDrag) return;
  handle.dataset.avDrag = '1';

  chrome.storage.local.get([PANEL_POS_KEY], data => {
    if (data[PANEL_POS_KEY]) applyPanelPos(data[PANEL_POS_KEY]);
  });

  let startX = 0, startY = 0, baseLeft = 0, baseTop = 0, dragging = false;

  const onMove = (e) => {
    if (!dragging) return;
    e.preventDefault();
    const { left, top } = clampPanelPos(baseLeft + (e.clientX - startX), baseTop + (e.clientY - startY), el);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('av-dragging');
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('mouseup', onUp, true);
    chrome.storage.local.set({
      [PANEL_POS_KEY]: { left: parseInt(el.style.left, 10) || 0, top: parseInt(el.style.top, 10) || 0 },
    });
  };

  handle.addEventListener('mousedown', (e) => {
    // Let the close button and anything else interactive keep working.
    if (e.button !== 0 || e.target.closest('button, a, input, select')) return;
    const r = el.getBoundingClientRect();
    baseLeft = r.left; baseTop = r.top;
    startX = e.clientX; startY = e.clientY;
    dragging = true;
    el.classList.add('av-dragging');
    // Capture phase so PO's own chart handlers cannot swallow the drag.
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', onUp, true);
    e.preventDefault();
  });

  handle.addEventListener('dblclick', (e) => {
    if (e.target.closest('button, a, input, select')) return;
    resetPanelPos();
  });

  // Keep it on screen if the window shrinks.
  window.addEventListener('resize', () => {
    if (!el.style.left) return;
    applyPanelPos({ left: parseInt(el.style.left, 10) || 0, top: parseInt(el.style.top, 10) || 0 });
  });
}

// Latest signal verdict, for the panel readout. Kept on state so it survives
// re-renders and can be shown while idle as well as mid-scan.
function recordSignalSnapshot(pair, sig) {
  const snap = sig?.snapshot;
  if (!snap || !Array.isArray(snap.rules) || snap.rules.length === 0) return;
  state.lastSignal = {
    pair: pair || state.activePair || null,
    at: Date.now(),
    action: snap.action,
    side: snap.side,
    strategy: snap.strategy,
    intensity: snap.intensity,
    matched: snap.rulesMatched,
    required: snap.required,
    total: snap.totalRules,
    rules: snap.rules.map(r => ({ label: r.label, met: !!r.met })),
  };
  renderSignalBox();
}

function renderSignalBox() {
  const box = document.getElementById('av-signal-box');
  if (!box) return;

  // Only meaningful for Avalisa Bot — Martingale does not evaluate indicators.
  if (state.settings?.strategy !== 'ai' || !state.lastSignal) {
    box.style.display = 'none';
    return;
  }

  const sig = state.lastSignal;
  box.style.display = '';

  const pairEl = document.getElementById('av-signal-pair');
  if (pairEl) {
    const dir = sig.side === 'put' ? 'PUT' : 'CALL';
    pairEl.textContent = `${sig.pair || 'pair'} · ${sig.strategy || ''} · ${dir}`;
  }

  const scoreEl = document.getElementById('av-signal-score');
  if (scoreEl) {
    scoreEl.textContent = `${sig.matched}/${sig.required} rules`;
    scoreEl.classList.toggle('ready', sig.matched >= sig.required);
    scoreEl.title = `${sig.matched} of ${sig.total} rules met; ${sig.intensity} needs ${sig.required}`;
  }

  const list = document.getElementById('av-signal-rules');
  if (list) {
    list.innerHTML = '';
    sig.rules.forEach(r => {
      const li = document.createElement('li');
      if (r.met) li.className = 'met';
      const tick = document.createElement('span');
      tick.className = 'av-tick';
      tick.textContent = r.met ? '\u2713' : '\u00b7';
      const label = document.createElement('span');
      label.textContent = r.label;
      li.appendChild(tick);
      li.appendChild(label);
      list.appendChild(li);
    });
  }

  updateSignalAge();
}

// A visible heartbeat: without it a correct-but-unconvinced scan is
// indistinguishable from a frozen panel.
function updateSignalAge() {
  const el = document.getElementById('av-signal-age');
  if (!el || !state.lastSignal) return;
  const secs = Math.max(0, Math.round((Date.now() - state.lastSignal.at) / 1000));
  const when = secs < 2 ? 'just now' : secs < 60 ? `${secs}s ago` : `${Math.round(secs / 60)}m ago`;
  el.textContent = `checked ${when}`;
  el.style.color = secs > 90 ? '#f87171' : '#475569';
}

function updateBottomStatus() {
  const isAi = state.settings?.strategy === 'ai';

  // Idle AI status: reflect candle-buffer readiness in the main status line.
  // Skip while running — runTradeCycle drives the status text itself.
  if (isAi && !state.running) {
    const n = getBufferedCandles().length;
    const intensity = getCurrentAiIntensity();
    const requiredCandles = getRequiredCandles(intensity);
    if (n === 0) {
      updateStatus('', 'Waiting for pair data...');
    } else if (n < requiredCandles) {
      updateStatus('', `Loading: ${n}/${requiredCandles} (${intensity})`);
    } else {
      updateStatus('', `Ready (${n} candles, ${intensity})`);
    }
  }

  renderSignalBox();

  // Trade allowance — only visible when strategy=ai
  const tokenEl = document.getElementById('av-token-status');
  if (tokenEl) {
    const allowance = state.licenseInfo?.aiTradesAllowance;
    const usedCount = state.licenseInfo?.aiTradesUsed;
    // v2.3.2: Pro users see infinity; the backend stores this as lifetime for compatibility.
    if (isAi && state.licenseInfo?.plan === 'lifetime') {
      tokenEl.textContent = 'Trade allowance: ∞ (Pro)';
      tokenEl.style.display = '';
    } else if (isAi && Number.isFinite(allowance) && Number.isFinite(usedCount)) {
      tokenEl.textContent = `Trade allowance: ${usedCount}/${allowance}`;
      tokenEl.style.display = '';
    } else {
      tokenEl.style.display = 'none';
    }
  }
}

async function startBot() {
  if (state.running) return;

  const startGeneration = state.cycleGeneration + 1;
  state.cycleGeneration = startGeneration; // invalidates stale cycles and marks this pending start
  state.stopRequested = false;
  diagnosePOInterface();

  await saveCurrentSettings();
  if (state.stopRequested || state.cycleGeneration !== startGeneration) return;
  const license = await checkLicense();
  if (state.stopRequested || state.cycleGeneration !== startGeneration) return;

  if (!license.allowed) {
    showLimitReachedMessage(license);
    return;
  }

  const aiAllowanceBlock = getAiAllowanceBlock(license);
  if (aiAllowanceBlock) {
    updateStatus('error', aiAllowanceBlock.message);
    showLimitReachedMessage({ reason: aiAllowanceBlock.reason });
    return;
  }

  const layoutHealth = assessPOLayoutHealth();
  if (!layoutHealth.ok) {
    console.warn('[Avalisa] PO layout health check failed before start:', layoutHealth);
    updateStatus('error', layoutHealth.message);
    return;
  }

  state.running = true;
  state.stopAfterTrade = false;
  clearTradeLock();                  // clear any stale open-trade flag from last run
  state.currentAmount = parseFloat(state.settings.startAmount) || 1.0;
  state.martingaleStep = 0;
  state.aiNoProgressCycles = 0;
  state.unconfirmedOrderFailures = 0;
  state.amountSetFailures = 0;
  state.recoveryReloads = 0;
  state.cycleErrorStreak = 0;
  state.cycleErrorReloads = 0;

  // v2.4.8: if a safety pause preserved a mid-recovery ladder and the
  // martingale settings are unchanged, resume it instead of restarting at
  // step 0 — restarting abandons the accumulated recovery.
  const pausedLadder = await consumePausedLadder(state.settings);
  if (state.stopRequested || state.cycleGeneration !== startGeneration) return;
  if (pausedLadder) {
    state.currentAmount = Number(pausedLadder.currentAmount);
    state.martingaleStep = Math.max(0, Number(pausedLadder.martingaleStep) || 0);
    state.tradesCount = Math.max(state.tradesCount, Number(pausedLadder.tradesCount) || 0);
    state.lastDirection = pausedLadder.lastDirection || state.lastDirection;
    console.log('[Avalisa] Resuming paused ladder:', pausedLadder);
    const ageMin = Math.round((Date.now() - Number(pausedLadder.savedAt || 0)) / 60000);
    updateStatus('running', `Resuming paused ladder at $${Number(pausedLadder.currentAmount).toFixed(2)} (step ${state.martingaleStep}, saved ${ageMin}m ago)`);
  }

  const gen = startGeneration;
  updateUI();
  updateStatus('running', pausedLadder
    ? `Resuming recovery at $${state.currentAmount.toFixed(2)} (step ${state.martingaleStep})`
    : 'Starting...');
  if (typeof AvalisaTelemetry !== 'undefined') AvalisaTelemetry.session('session_start');
  await persistRuntimeSession('started');
  warmupCandleHistory().catch(console.error);
  runTradeCycle(gen);
}

function stopBot() {
  if (typeof AvalisaTelemetry !== 'undefined' && !state.stopAfterTrade) AvalisaTelemetry.event('stop', 'manual');
  // Finish tracking an accepted/pending order before unlocking Start.
  if (state.tradeLock || state.isTradeOpen) {
    state.stopAfterTrade = true;
    updateUI();
    updateStatus('running', 'Stopping — waiting for the current order to resolve');
    return;
  }
  if (typeof AvalisaTelemetry !== 'undefined') AvalisaTelemetry.session('session_stop');
  state.stopAfterTrade = false;
  state.cycleGeneration++;           // invalidates any running cycle immediately
  state.running = false;
  state.stopRequested = true;
  clearTradeLock();
  state.aiNoProgressCycles = 0;
  state.unconfirmedOrderFailures = 0;
  state.amountSetFailures = 0;
  state.recoveryReloads = 0;
  state.cycleErrorStreak = 0;
  state.cycleErrorReloads = 0;
  clearRuntimeSession().catch(() => {});
  clearPausedLadder().catch(() => {}); // manual Stop = intentional reset, drop any preserved ladder
  updateUI();
  updateStatus('', 'Stopped');
  updateBottomStatus(); // re-evaluate idle AI status (Ready / Loading / Waiting)
}

async function saveCurrentSettings() {
  const strategy = document.getElementById('av-strategy')?.value || 'martingale';
  const intensityEl = document.getElementById('av-intensity');
  const intensity = intensityEl && ['low', 'mid', 'high'].includes(intensityEl.value)
    ? intensityEl.value
    : (state.settings?.intensity || 'mid');
  const aiPairModeEl = document.getElementById('av-ai-pair-mode');
  const aiPairMode = aiPairModeEl && ['auto', 'current'].includes(aiPairModeEl.value)
    ? aiPairModeEl.value
    : (state.settings?.aiPairMode || 'auto');
  const multiplierRaw = parseFloat(document.getElementById('av-multiplier')?.value);
  const multiplier = Number.isFinite(multiplierRaw)
    ? multiplierRaw
    : (parseFloat(state.settings?.martingaleMultiplier) || 2.0);
  const selectedTimeframe = document.getElementById('av-timeframe')?.value;
  const settings = {
    strategy,
    // AI keeps the control hidden and follows its own/live signal duration.
    // Martingale still uses the user's explicit dropdown selection.
    timeframe: strategy === 'ai'
      ? (state.settings?.timeframe || 'S30')
      : (selectedTimeframe || state.settings?.timeframe || 'M1'),
    direction: document.getElementById('av-direction').value,
    delaySeconds: state.settings?.delaySeconds ?? 6,
    martingaleMultiplier: multiplier,
    martingaleSteps: document.getElementById('av-steps').value,
    startAmount: parseFloat(document.getElementById('av-start-amount').value) || 1.0,
    aiAssist: strategy === 'ai',
    intensity,
    aiPairMode,
  };
  await saveSettings(settings);

  if (state.jwt) {
    apiPost('/api/settings', settings).catch(console.error);
  }
}

function updateUI() {
  const startBtn = document.getElementById('av-start-btn');
  const stopBtn = document.getElementById('av-stop-btn');
  const loginForm = document.getElementById('av-login-form');
  const loggedIn = document.getElementById('av-logged-in');
  const claimBlock = document.getElementById('av-claim-block');

  if (startBtn) startBtn.disabled = state.running;
  if (stopBtn) stopBtn.disabled = !state.running || state.stopAfterTrade;

  // Lock config inputs while the bot is Running — prevents mid-run strategy/config crashes
  const lockedIds = [
    'av-strategy', 'av-direction', 'av-timeframe', 'av-intensity', 'av-ai-pair-mode',
    'av-start-amount', 'av-multiplier', 'av-steps',
    'av-payout-min', 'av-payout-enabled', 'av-payout-action',
  ];
  const lockTitle = state.running ? 'Stop bot to change strategy' : '';
  lockedIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      if (!el.dataset.tip) el.dataset.tip = el.title || '';
      el.disabled = state.running;
      el.title = state.running ? lockTitle : el.dataset.tip;
    }
  });
  const payoutEnabled = document.getElementById('av-payout-enabled');
  const payoutAction = document.getElementById('av-payout-action');
  if (payoutEnabled) {
    if (!payoutEnabled.dataset.tip) payoutEnabled.dataset.tip = payoutEnabled.title || '';
    payoutEnabled.disabled = state.running;
    payoutEnabled.title = lockTitle || payoutEnabled.dataset.tip || payoutEnabled.title;
  }
  if (payoutAction) {
    if (!payoutAction.dataset.tip) payoutAction.dataset.tip = payoutAction.title || '';
    payoutAction.title = lockTitle || payoutAction.dataset.tip || payoutAction.title;
  }
  applyPayoutControlsUI();

  // Auth UI
  if (state.jwt) {
    if (loginForm) loginForm.style.display = 'none';
    if (loggedIn) loggedIn.style.display = 'flex';
    chrome.storage.local.get('userEmail', data => {
      const emailEl = document.getElementById('av-user-email');
      if (emailEl && data.userEmail) {
        emailEl.textContent = formatUserEmailForPanel(data.userEmail);
        emailEl.title = data.userEmail;
      }
    });
    // Plan badge
    const badgeEl = document.getElementById('av-plan-badge');
    if (badgeEl && state.licenseInfo?.plan) {
      const plan = state.licenseInfo.plan;
      const cls = plan === 'lifetime' ? 'plan-lifetime' : plan === 'basic' ? 'plan-basic' : 'plan-free';
      badgeEl.className = `av-plan-badge ${cls}`;
      badgeEl.textContent = plan === 'lifetime' ? 'pro' : plan === 'free' ? 'demo' : plan;
    }
  } else {
    if (loginForm) loginForm.style.display = 'block';
    if (loggedIn) loggedIn.style.display = 'none';
  }
  const plan = state.licenseInfo?.plan;
  if (claimBlock) claimBlock.style.display = state.jwt && plan === 'free' ? 'block' : 'none';
  syncLimitReachedMessage();

  // Load settings into UI
  const s = state.settings;
  if (s) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    set('av-strategy', s.strategy || 'martingale');
    set('av-timeframe', (s.timeframe === 'S15' ? 'S30' : s.timeframe) || 'M1');
    set('av-direction', s.direction || 'alternating');
    set('av-delay', s.delaySeconds || 6);
    set('av-multiplier', parseFloat(s.martingaleMultiplier || 2.0).toFixed(1));
    set('av-steps', s.martingaleSteps || 'infinite');
    set('av-start-amount', s.startAmount || 1.0);
    set('av-intensity', ['low', 'mid', 'high'].includes(s.intensity) ? s.intensity : 'mid');
    set('av-ai-pair-mode', ['auto', 'current'].includes(s.aiPairMode) ? s.aiPairMode : 'auto');

    // Apply AI/Martingale UI layout
    applyStrategyUI(s.strategy || 'martingale');

    // Payout Monitor values — read from dedicated top-level state (seeded from chrome.storage.local on init)
    const payoutMin = document.getElementById('av-payout-min');
    if (payoutMin) {
      const v = Number.isFinite(+state.payoutMinPercent) ? +state.payoutMinPercent : 90;
      payoutMin.value = Math.max(1, Math.min(100, v));
    }
    const action = state.payoutAction === 'keep'
      ? 'off'
      : (['off', 'stop', 'switch'].includes(state.payoutAction) ? state.payoutAction : 'switch');
    const payoutEnabled = document.getElementById('av-payout-enabled');
    const payoutAction = document.getElementById('av-payout-action');
    if (payoutEnabled) payoutEnabled.checked = action !== 'off';
    if (payoutAction) {
      payoutAction.value = action === 'off' ? 'switch' : action;
    }
    applyPayoutControlsUI();

    updateBottomStatus();
  }
}

function updateStatus(type, message) {
  const el = document.getElementById('av-status');
  if (!el) return;
  el.textContent = `Status: ${message}`;
  el.className = `av-status${type ? ' ' + type : ''}`;
}

function updateTradeCounter() {
  const el = document.getElementById('av-trade-counter');
  if (!el) return;
  const license = state.licenseInfo;
  if (license?.plan === 'free') {
    el.textContent = `Trades: ${license.tradesUsed || state.tradesCount} / ${license.tradesLimit} demo`;
  } else if (license?.plan === 'basic') {
    el.textContent = 'Trades: Unlimited';
  } else {
    el.textContent = `Trades this session: ${state.tradesCount}`;
  }
}

function getAiAllowanceBlock(license) {
  if (state.settings?.strategy !== 'ai') return null;
  if (isDemoMode()) return null;
  if (!license || license.plan === 'lifetime') return null;

  const allowance = Number(license.aiTradesAllowance);
  const used = Number(license.aiTradesUsed);
  if (!Number.isFinite(allowance) || !Number.isFinite(used)) return null;
  if (used < allowance) return null;

  return {
    reason: 'Avalisa Bot trade allowance exhausted',
    message: `Avalisa Bot allowance reached (${used}/${allowance}). Upgrade to Pro for unlimited Avalisa Bot trades.`,
  };
}

function showLimitReachedMessage(license) {
  const limitMsg = document.getElementById('av-limit-msg');
  if (limitMsg) limitMsg.style.display = 'block';
  updateStatus('error', license?.reason || 'Limit reached');
}

function hideLimitReachedMessage() {
  const limitMsg = document.getElementById('av-limit-msg');
  if (limitMsg) limitMsg.style.display = 'none';
}

function syncLimitReachedMessage() {
  const license = state.licenseInfo;
  const aiAllowanceBlock = license?.allowed ? getAiAllowanceBlock(license) : null;
  if (license?.allowed && !aiAllowanceBlock) {
    hideLimitReachedMessage();
  }
}

// ─── Load affiliate link from backend ────────────────────────────────────────
async function loadAffiliateLink() {
  // Check storage first (cached from last run)
  const stored = await new Promise(resolve =>
    chrome.storage.local.get('affiliateLink', d => resolve(d.affiliateLink || null))
  );
  if (stored) state.affiliateLink = stored;

  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/config/affiliate-link`, {});
    const data = await res.json();
    if (data?.url) {
      state.affiliateLink = data.url;
      chrome.storage.local.set({ affiliateLink: data.url });
    }
  } catch (err) {
    // silent — use stored or hardcoded fallback
  }

  // Update overlay links if already injected
  const el = document.getElementById('av-affiliate-link');
  if (el) el.href = state.affiliateLink;
  const btn = document.getElementById('av-register-free-btn');
  if (btn) btn.dataset.href = state.affiliateLink;
}



// ─── Load settings from backend on startup ────────────────────────────────────
async function loadSettingsFromBackend() {
  if (!state.jwt) return;
  // Preserve payout monitor top-level state — backend settings don't include these.
  const savedPayoutMinPercent = state.payoutMinPercent;
  const savedPayoutAction = state.payoutAction;
  const localAiPairMode = state.settings?.aiPairMode;
  try {
    const data = await apiGet('/api/settings');
    if (data && !data.error) {
      state.settings = {
        ...getDefaultSettings(),
        ...data,
        aiPairMode: ['auto', 'current'].includes(localAiPairMode)
          ? localAiPairMode
          : (['auto', 'current'].includes(data.aiPairMode) ? data.aiPairMode : getDefaultSettings().aiPairMode),
      };
      await new Promise(resolve => chrome.storage.local.set({ settings: state.settings }, resolve));
      console.log('[Avalisa] Settings loaded from backend');
    }
  } catch (err) {
    console.warn('[Avalisa] Could not load settings from backend — using local defaults');
  } finally {
    // Restore payout monitor values that were seeded from chrome.storage.local.
    state.payoutMinPercent = savedPayoutMinPercent;
    state.payoutAction = savedPayoutAction;
  }
}

// ─── WS Interceptor — installed by Chrome via MAIN-world content_script ──────
// injected.js runs in the page's JS world at document_start and postMessages
// AVALISA_WS_* frames to this listener. No manual script-tag injection needed.
window.addEventListener('message', (e) => {
  const t = e.data?.type;
  if (t === 'AVALISA_WS') {
    parseWsMessage(e.data.data);
  } else if (t === 'AVALISA_DEBUG_REQUEST') {
    emitAvalisaDebugSnapshot();
  } else if (t === 'AVALISA_WS_TICK') {
    // Binary Blob decoded: [[asset, timestamp, price], ...]
    try {
      const ticks = JSON.parse(e.data.data);
      if (Array.isArray(ticks)) {
        if (_tickLogCount < 5) {
          debugLog('[Avalisa] WS_TICK sample:', JSON.stringify(ticks).substring(0, 300));
          _tickLogCount++;
        }
        ticks.forEach(tick => {
          if (Array.isArray(tick) && tick.length >= 3) {
            if (_tickLogCount < 10) {
              debugLog('[Avalisa] TICK ingest: asset=', JSON.stringify(tick[0]), 'ts=', tick[1], 'price=', tick[2], '→ keys: ' + tick[0] + ':30, ' + tick[0] + ':60, ...');
              _tickLogCount++;
            }
            ingestTick(tick[0], tick[1], tick[2]);
          }
        });
      }
    } catch (_) {}
  } else if (t === 'AVALISA_WS_BINARY') {
    // PO's authoritative trade events arrive as BINARY socket frames, named by
    // the placeholder that precedes them. These are the source of truth for
    // "did my order open" and "did it win" — the balance DOM is only a fallback,
    // and a throttled background tab can delay it by 30s+.
    try {
      const payload = JSON.parse(e.data.data);
      const evName = e.data.event || '';

      if (/successopenOrder/i.test(evName)) {
        recordWsOpen(payload);
        debugLog('[Avalisa] WS open confirmed:', payload?.asset, payload?.amount, 'req', payload?.requestId);
      } else if (/successcloseOrder|deals?Closed|closeOrder/i.test(evName)) {
        state.recentCloseEvents.push({ ts: Date.now(), event: evName, payload });
        if (state.recentCloseEvents.length > 20) state.recentCloseEvents.shift();
        debugLog('[Avalisa] WS close event:', evName, JSON.stringify(payload).slice(0, 200));
      }
    } catch (_) {}
  } else if (t === 'AVALISA_WS_HISTORY') {
    debugLog('[Avalisa] HISTORY binary received, length:', e.data.data.length);
    try {
      const parsed = JSON.parse(e.data.data);

      debugLog('[Avalisa] HISTORY raw payload keys:', Object.keys(parsed || {}));
      debugLog('[Avalisa] HISTORY raw payload sample:', JSON.stringify(parsed).substring(0, 800));
      if (parsed?.history) {
        const ticks = parsed.history;
        debugLog('[Avalisa] HISTORY ticks:', ticks.length,
          'first:', JSON.stringify(ticks[0]),
          'last:', JSON.stringify(ticks[ticks.length - 1]),
          'span_seconds:', ticks.length > 1 ? Number(ticks[ticks.length-1][0]) - Number(ticks[0][0]) : 'n/a');
      }

      const pair = getCurrentPair();
      const asset = normalizeAssetName(pair) || 'UNKNOWN';
      const periodSec = getCurrentPeriodSeconds();

      if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.history)) {
        // Format: {asset, period, history: [[ts_float, price_float], ...]}
        const histAsset = normalizeAssetName(parsed.asset) || asset;
        // Bucket the seed at the period the frame itself declares.
        //
        // This used to be hardcoded to the UI expiry on the theory that
        // parsed.period was PO's transport granularity. Verified live
        // 2026-08-17: it is not — parsed.period is exactly the period asked for
        // in changeSymbol (confirmed at 30 / 60 / 300). Ignoring it meant a
        // requested 30s seed (~24 candles) was filed as 60s and re-bucketed down
        // to ~14, which is what kept the AI gates permanently unreachable.
        // Fall back to the UI expiry only if PO omits or mangles the field.
        const parsedPeriod = Number(parsed.period);
        const histPeriod = Number.isFinite(parsedPeriod) && parsedPeriod > 0 ? parsedPeriod : periodSec;

        // Detect pair / period switch and wipe stale buffers from other pairs
        const pairChanged = state.activePair !== histAsset || state.activePeriod !== histPeriod;
        if (pairChanged) {
          clearStalePairBuffers(histAsset, histPeriod);
          state.activePair = histAsset;
          state.activePeriod = histPeriod;
          console.log('[Avalisa] Pair switch detected →', histAsset + ':' + histPeriod);
        }

        // REPLACE (not append) the buffer with bucketed candles from this seed
        const candleCount = seedCandleBufferFromHistory(histAsset, histPeriod, parsed.history);
        console.log('[Avalisa] HISTORY seeded', candleCount, 'candles for', histAsset + ':' + histPeriod,
          '(ticks:', parsed.history.length + ')');
        updateBottomStatus();
      } else if (Array.isArray(parsed)) {
        // Legacy array format
        let ingested = 0;
        parsed.forEach(item => {
          let candle = null;

          if (Array.isArray(item)) {
            if (ingested < 3) debugLog('[Avalisa] HISTORY candle raw:', JSON.stringify(item));
            if (item.length >= 5) {
              candle = { time: item[0], open: item[1], high: item[3], low: item[4], close: item[2], asset, period: periodSec };
            } else if (item.length >= 4) {
              candle = { time: item[0], open: item[1], high: item[2], low: item[3], close: item[1], asset, period: periodSec };
            }
          } else if (item && typeof item === 'object') {
            if (ingested < 3) debugLog('[Avalisa] HISTORY candle obj:', JSON.stringify(item));
            candle = {
              time: item.time || item.timestamp || item.t,
              open: item.open || item.o,
              high: item.high || item.h,
              low: item.low || item.l,
              close: item.close || item.c,
              asset, period: periodSec
            };
          }

          if (candle && candle.time && candle.open) {
            ingestCandle(candle);
            ingested++;
          }
        });
        // Legacy format: best-effort activePair assignment so getBufferedCandles works
        if (state.activePair !== asset || state.activePeriod !== periodSec) {
          clearStalePairBuffers(asset, periodSec);
          state.activePair = asset;
          state.activePeriod = periodSec;
        }
        scheduleCandleCacheSave();
        console.log('[Avalisa] HISTORY ingested', ingested, 'candles for', asset + ':' + periodSec);
        updateBottomStatus();
      }
    } catch (err) {
      console.warn('[Avalisa] HISTORY parse error:', err, 'raw:', e.data.data.substring(0, 200));
    }
  } else if (t === 'AVALISA_WS_SEND') {
    // Log outgoing WS — helps identify what PO sends to trigger AI
    if (e.data.data && !e.data.data.startsWith('2') && !e.data.data.startsWith('3')) {
      debugLog('[Avalisa] WS SEND:', e.data.data.substring(0, 300));
    }
  } else if (t === 'AVALISA_FETCH') {
    debugLog('[Avalisa] FETCH', e.data.method, e.data.url, e.data.body ? '| body:' + e.data.body : '');
  } else if (t === 'AVALISA_FETCH_RES') {
    debugLog('[Avalisa] FETCH_RES', e.data.url, '|', e.data.body);
  } else if (t === 'AVALISA_XHR') {
    debugLog('[Avalisa] XHR', e.data.method, e.data.url, '|', e.data.response);
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  await loadFromStorage();
  await loadSettingsFromBackend();
  injectOverlay();
  loadAffiliateLink(); // fire-and-forget
  // Paid users whose PO account is already linked get unlocked without signing in.
  tryPoLinkedEntitlement().catch(() => {});
  if (state.jwt) {
    // v2.3.3: also seed licenseInfo on init — popup reads from chrome.storage,
    // and without this call licenseInfo only populated on Start (popup stuck showing FREE).
    // updateBottomStatus renders "Trade allowance" from licenseInfo, so it must run AGAIN when
    // the licence lands — updateUI() does not call it. Before #55 this was covered by accident:
    // the /api/ai/token-status round-trip usually resolved after checkLicense, so the allowance
    // painted late but painted. Depending on an unrelated request's latency is not a mechanism.
    checkLicense().then(lic => { state.licenseInfo = lic; updateUI(); updateBottomStatus(); }).catch(() => {});
    updateBottomStatus();
  }
  setTimeout(() => prefillCandleHistory().catch(console.error), 3000);
  // The login iframe tells us the moment it succeeds, so the panel swaps over
  // instantly instead of waiting for the storage event.
  window.addEventListener('message', (e) => {
    if (e.data?.type !== 'AVALISA_AUTH_OK') return;
    chrome.storage.local.get(['jwt', 'userId'], data => {
      if (!data.jwt) return;
      state.jwt = data.jwt;
      state.userId = data.userId || null;
      checkLicense().then(lic => { state.licenseInfo = lic; updateUI(); }).catch(() => {});
      updateUI();
    });
  });

  // Sign-in happens in an extension-origin iframe inside the panel, so the panel
  // has to notice the JWT arriving (or being cleared) rather than owning the form.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.jwt) return;
    const token = changes.jwt.newValue || null;
    if (token === state.jwt) return;
    state.jwt = token;
    if (!token) {
      state.userId = null;
      state.licenseInfo = null;
      updateUI();
      return;
    }
    chrome.storage.local.get(['userId'], data => {
      if (data.userId) state.userId = data.userId;
      checkLicense().then(lic => { state.licenseInfo = lic; updateUI(); }).catch(() => {});
      updateUI();
      updateStatus('running', 'Signed in from the extension popup');
    });
  });

  setInterval(updateBottomStatus, 10000);
  // Tick the "checked Ns ago" line every second so the readout is visibly live.
  setInterval(updateSignalAge, 1000);
  setInterval(() => watchPOSelectionForAvalisa().catch(console.error), 2000);
  // The UID node renders late on some PO layouts — keep looking until resolved.
  setInterval(() => { tryPoLinkedEntitlement().catch(() => {}); }, 15000);
  setTimeout(() => restoreRuntimeSession().catch(console.error), 2500);

  // Wait for PO header to render before injecting button
  const headerInterval = setInterval(() => {
    const header = document.querySelector('.header__right, .header-right, header');
    if (header) {
      injectHeaderButton();
      clearInterval(headerInterval);
    }
  }, 1000);
}

// Message listener — handles messages from popup and background
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'TOGGLE_PANEL') {
    const panel = document.getElementById('avalisa-overlay');
    if (panel) panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
    sendResponse({ ok: true });
  }
});

// At document_start the DOM is never ready yet — always wait for DOMContentLoaded
document.addEventListener('DOMContentLoaded', init);

// ─── Debug helper — run window.avDebug() in PO devtools console ───────────────
window.avDebug = function () {
  const out = getAvalisaDebugSnapshot();
  console.log('[Avalisa Debug]', JSON.stringify(out, null, 2));
  return out;
};

function getAvalisaDebugSnapshot() {
  const buf = state.candleBuffer || {};
  const allKeys = Object.keys(buf);
  const durationSeconds = getDurationSecondsFromDom();
  const favoritePairs = getFavoritePairs();
  return {
    version: chrome.runtime.getManifest().version,
    modules: {
      poDom: typeof setTimeframe === 'function' && typeof getBalance === 'function',
      tradeResult: typeof resolveTradeResult === 'function',
    },
    activePair: state.activePair,
    activePeriod: state.activePeriod,
    activeKey: `${state.activePair}:${state.activePeriod}`,
    po: {
      layoutHealth: typeof assessPOLayoutHealth === 'function' ? assessPOLayoutHealth() : null,
      mode: isDemoMode() ? 'demo' : 'real',
      currentPair: getCurrentPair(),
      normalizedPair: normalizeAssetName(getCurrentPair()),
      durationSeconds,
      currentPeriodSeconds: getCurrentPeriodSeconds(),
      payoutPercent: getCurrentPayoutPercent(),
      favoritePairs: favoritePairs.map(f => ({ name: f.name, payout: f.payout })),
    },
    bufferKeys: allKeys,
    bufferSizes: allKeys.reduce((acc, k) => { acc[k] = buf[k].length; return acc; }, {}),
    activeBufferSample: buf[`${state.activePair}:${state.activePeriod}`]?.slice(0, 3) || [],
    activeBufferLast: buf[`${state.activePair}:${state.activePeriod}`]?.slice(-3) || [],
    settings: state.settings,
    licenseInfo: state.licenseInfo,
    running: state.running,
    isTradeOpen: state.isTradeOpen,
    tradeLock: state.tradeLock,
    tradeLockPhase: state.tradeLockPhase,
    tradeLockAgeMs: state.tradeLockSince ? Date.now() - state.tradeLockSince : 0,
    martingaleStep: state.martingaleStep,
    currentAmount: state.currentAmount,
    tradesCount: state.tradesCount, // live-test/publish gate waits on this — keep exposed
    amountSetFailures: state.amountSetFailures,
    recoveryReloads: state.recoveryReloads,
    cycleErrorStreak: state.cycleErrorStreak,
    cycleErrorReloads: state.cycleErrorReloads,
    lastTradeResultDebug: state.lastTradeResultDebug,
    lastTradeCycleError: state.lastTradeCycleError,
  };
}

function emitAvalisaDebugSnapshot() {
  try {
    window.postMessage({ type: 'AVALISA_DEBUG_RESPONSE', data: getAvalisaDebugSnapshot() }, '*');
  } catch (_) {}
}

setInterval(emitAvalisaDebugSnapshot, 5000);
setTimeout(emitAvalisaDebugSnapshot, 1500);
console.log('[Avalisa] Debug helper ready — run window.avDebug() in PO console anytime');
