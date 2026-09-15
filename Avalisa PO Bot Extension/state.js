/**
 * Avalisa PO Bot v2 - Shared runtime state
 * Loaded before content.js by manifest order.
 */

const state = {
  running: false,
  isTradeOpen: false,
  tradeLock: false,
  tradeLockPhase: null,
  tradeLockSince: 0,
  currentAmount: 0,
  martingaleStep: 0,
  tradesCount: 0,
  amountSetFailures: 0,
  recoveryReloads: 0,
  cycleErrorStreak: 0,
  cycleErrorReloads: 0,
  lastDirection: null,
  licenseInfo: null,
  settings: null,
  jwt: null,
  userId: null,
  deviceFingerprint: null,
  stopRequested: false,
  stopAfterTrade: false, // Stop drains the current order before allowing another Start
  cycleGeneration: 0,  // incremented on each start/stop; stale cycles self-terminate
  affiliateLink: AFFILIATE_LINK,  // updated from DB on startup
  // AI assist (background, non-blocking)
  candleBuffer: {},   // { "EURUSD_otc:60": [{time,open,high,low,close},...] }
  activePair: null,   // normalized asset key from last updateHistoryNewFast
  activePeriod: null, // period (seconds) from last updateHistoryNewFast
  recentCloseEvents: [], // [{ ts, event, payload }] — from PO's binary successcloseOrder
  recentOpenEvents: [], // retained successopenOrder evidence for late identity
  currentTradeIdentity: null, // immutable pair, stake and click window for attribution
  usedDealIds: new Set(), // never reuse a deal across trades in this page session
  lastWsOpen: null,      // last successopenOrder payload (authoritative open confirmation)
  currentDealId: null,   // PO deal id of the trade in flight, so results pair exactly
  lastSignal: null,   // latest AvalisaSignalEngine verdict, for the panel readout
  poEntitlementUid: null, // PO UID already resolved against /license/po-entitlement
  lastTradeResultDebug: null,
  lastTradeCycleError: null,
  aiNoProgressCycles: 0,
  unconfirmedOrderFailures: 0,
  lastPairSwitchAt: 0,
  // Payout monitor (populated from chrome.storage.local)
  payoutMinPercent: 90,
  payoutAction: 'switch',
};

function getDefaultSettings() {
  return {
    strategy: 'martingale',
    timeframe: 'M1',
    direction: 'alternating',
    martingaleMultiplier: 2.0,
    martingaleSteps: 'infinite',
    delaySeconds: 6,
    startAmount: 1.0,
    aiAssist: false,
    intensity: 'mid',
    aiPairMode: 'auto', // auto = scan payout-qualified favorites; current = never rotate pairs
  };
}

const MAX_CANDLE_BUFFER = 50;
// How many candles PO can actually give us (measured live 2026-08-17):
// every history frame carries a fixed ~1300-1400 raw ticks (~11 minutes), so the
// candle count is span/period, NOT something we can ask for more of:
//   30s period -> ~22 candles   60s -> ~10   300s -> ~2
// Requesting a deeper window does not work; "loadHistoryPeriod" is ignored
// outright and "changeSymbol" always returns the same ~11-minute tick budget.
//
// The old values (mid 20, high 30) were therefore unreachable while scanning at
// a 60s period: Mid and High never once cleared the gate, so Avalisa Bot placed
// zero trades at its own default intensity. Every value below is now under the
// ~22 a 30s seed provides (see AI_ANALYSIS_PERIOD_SEC) and at or above the 15
// closes RSI-14 needs to return a number at all.
//
// Intensity strictness lives in signalEngine.js: as of v3 it is a single dial,
// how many of the four rules must agree (Low 2, Mid 3, High 4). This constant is
// only a data-sufficiency floor and must not be used to make a level stricter.
const REQUIRED_CANDLES_BY_INTENSITY = { low: 12, mid: 16, high: 20 };
// Candle period the AI analyses on. 30s is the only period whose seed clears the
// High gate, so scanning pins to it regardless of the expiry a signal later picks.
const AI_ANALYSIS_PERIOD_SEC = 30;
const IDEAL_CANDLES = 50;
const AI_MAX_NO_PROGRESS_CYCLES = 3;
const AI_NO_PROGRESS_RETRY_MS = 5000;
const LATE_OPEN_WATCH_MS = 90000;
const MAX_UNCONFIRMED_ORDER_FAILURES = 3;
const CANDLE_CACHE_KEY = 'avalisaCandleCache';
const RUNTIME_SESSION_KEY = 'avalisaRuntimeSession';
const RUNTIME_SESSION_MAX_AGE_MS = 10 * 60 * 1000;
// Preserved martingale ladder from a safety pause; consumed by the next Start
// so a paused recovery can resume instead of restarting at step 0.
const PAUSED_LADDER_KEY = 'avalisaPausedLadder';
const PAUSED_LADDER_MAX_AGE_MS = 30 * 60 * 1000;
const MAX_RECOVERY_RELOADS = 2;
const MAX_CYCLE_ERROR_RETRIES = 2;
const BALANCE_CONFIRM_DELAY_MS = 1200;
let candleCacheSaveTimer = null;
