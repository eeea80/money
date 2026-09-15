/**
 * Avalisa PO Bot v2 - Trade result resolver
 * Loaded before content.js by manifest order.
 */

function extractResultFromCloseEvent(payload) {
  if (!payload) return null;

  // PO's successcloseOrder looks like { profit: 0, deals: [ { profit: -1, ... } ] }
  // where the OUTER profit is a batch total and the per-deal profit is the real
  // result. Reading the outer field first turned a real loss into a "tie" and
  // froze the martingale ladder, so the deal list always wins.
  if (Array.isArray(payload.deals) && payload.deals.length > 0) {
    const deal = payload.deals[payload.deals.length - 1];
    if (deal && typeof deal.profit === 'number') {
      if (deal.profit > 0) return 'win';
      if (deal.profit < 0) return 'loss';
      return 'tie';
    }
  }

  if (typeof payload.profit === 'number') {
    if (payload.profit === 0) return 'tie';
    return payload.profit > 0 ? 'win' : 'loss';
  }
  if (typeof payload.profitAmount === 'number') {
    if (payload.profitAmount === 0) return 'tie';
    return payload.profitAmount > 0 ? 'win' : 'loss';
  }
  if (payload.result === 'win' || payload.status === 'win') return 'win';
  if (payload.result === 'loss' || payload.status === 'loss' || payload.result === 'lose') return 'loss';
  if (payload.openPrice && payload.closePrice && payload.command !== undefined) {
    if (payload.closePrice === payload.openPrice) return 'tie';
    const up = payload.closePrice > payload.openPrice;
    const wasCall = payload.command === 0 || payload.direction === 'call' || payload.type === 'call';
    return (up === wasCall) ? 'win' : 'loss';
  }
  if (Array.isArray(payload) && payload.length > 0) {
    return extractResultFromCloseEvent(payload[payload.length - 1]);
  }
  if (Array.isArray(payload.deals) && payload.deals.length > 0) {
    return extractResultFromCloseEvent(payload.deals[payload.deals.length - 1]);
  }
  return null;
}

function getDealItems(limit = 5) {
  return Array.from(document.querySelectorAll('.deals-list__item')).slice(0, limit);
}

function getDealSignature(el) {
  if (!el) return null;
  const text = (el.innerText || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return text || null;
}

function getLatestDealSignatures(limit = 5) {
  return getDealItems(limit)
    .map(getDealSignature)
    .filter(Boolean);
}

function readDealResult(el) {
  if (!el) return null;
  const payoutCell = el.querySelector('.item-row .centered');
  const text = (payoutCell?.innerText || el.innerText || '').trim();

  if (payoutCell?.classList.contains('price-up')) return 'win';
  if (payoutCell?.classList.contains('price-down')) return 'loss';
  if (/\+\s*\$/.test(text) || /\bwin\b/i.test(text)) return 'win';
  if (/\-\s*\$/.test(text) || /\bloss\b/i.test(text)) return 'loss';
  return null;
}

function findResolvedNewDealResult(preTradeSignatures) {
  const previous = new Set(preTradeSignatures || []);
  for (const item of getDealItems(5)) {
    const sig = getDealSignature(item);
    if (!sig || previous.has(sig)) continue;
    const result = readDealResult(item);
    if (result) return { result, signature: sig };
  }
  return null;
}

// Pull the result for ONE specific deal id out of a close event, ignoring any
// other deals PO batched into the same frame.
function resultForDealId(payload, dealId) {
  if (!payload || !dealId) return null;
  const deals = Array.isArray(payload.deals) ? payload.deals
    : (Array.isArray(payload) ? payload : null);
  if (!deals) return null;
  const deal = deals.find(d => d && d.id === dealId);
  if (!deal || typeof deal.profit !== 'number') return null;
  if (deal.profit > 0) return 'win';
  if (deal.profit < 0) return 'loss';
  return 'tie';
}

// Keep open events separately: close-like updates must not evict late identity.
function recordWsOpen(payload, ts = Date.now()) {
  const event = { ts, event: 'successopenOrder', payload };
  state.lastWsOpen = event;
  if (!state.recentOpenEvents) state.recentOpenEvents = [];
  state.recentOpenEvents.push(event);
  if (state.recentOpenEvents.length > 100) state.recentOpenEvents.shift();
  reconcileCurrentDealId();
}

function dealOpenTimeMs(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  const ms = Number.isFinite(numeric)
    ? (numeric < 1e12 ? numeric * 1000 : numeric)
    : (typeof value === 'string' ? Date.parse(value) : NaN);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

function reconcileCurrentDealId(tradeStartTs = state.currentTradeIdentity?.tradeStartTs) {
  if (state.currentDealId) return state.currentDealId;
  const identity = state.currentTradeIdentity;
  if (!identity || identity.tradeStartTs !== tradeStartTs || !identity.asset || identity.asset === 'UNKNOWN') return null;
  if (!state.usedDealIds) state.usedDealIds = new Set();
  const matches = new Map();
  const consider = (deal, needsOpenTime) => {
    if (!deal || typeof deal.id !== 'string' || !deal.id || state.usedDealIds.has(deal.id)) return;
    if (typeof deal.asset !== 'string' || normalizeAssetName(deal.asset) !== identity.asset || Number(deal.amount) !== Number(identity.amount)) return;
    const opened = dealOpenTimeMs(deal.openTime);
    // Open receipt time is permitted evidence, but an explicitly stale server
    // openTime must never override it. Closes always need server openTime.
    if ((needsOpenTime && opened === null) || (opened !== null && opened < tradeStartTs)) return;
    matches.set(deal.id, deal);
  };
  for (const ev of state.recentOpenEvents || []) {
    if (ev.ts >= tradeStartTs) consider(ev.payload, false);
  }
  for (const ev of state.recentCloseEvents || []) {
    if (ev.ts < tradeStartTs || !/^successcloseOrder$/i.test(ev.event)) continue;
    const deals = Array.isArray(ev.payload?.deals) ? ev.payload.deals
      : (Array.isArray(ev.payload) ? ev.payload : []);
    for (const deal of deals) consider(deal, true);
  }
  // Count distinct IDs across all retained evidence, not just the last batch.
  if (matches.size !== 1) return null;
  const id = matches.keys().next().value;
  state.currentDealId = id;
  state.usedDealIds.add(id); // retained across Stop/Start for this page lifetime
  console.log('[Avalisa] Trade confirmed identity via reconciled PO deal:', id);
  return id;
}

// Match PO's close event to the deal we actually opened.
//
// Matching on time alone attributed the WRONG trade's result: a previous
// trade's close event can land just after the next trade opens, so the new
// trade's resolver read the old verdict. Observed live 2026-08-17 — a stale WIN
// was applied to a losing $1 trade, the ladder "reset" to $1 it was already on,
// and the next trade repeated $1 instead of doubling to $2.
//
// successopenOrder gives us the deal id, and every closed deal carries the same
// id, so the pairing is exact. Without an id, a timestamp cannot distinguish
// a late previous close from this trade; reconcile identity first or keep waiting.
function readWsTradeResultSince(tradeStartTs, dealId = state.currentDealId) {
  if (!dealId) dealId = reconcileCurrentDealId(tradeStartTs);
  const recentWs = state.recentCloseEvents.filter(e => e.ts >= tradeStartTs);

  if (dealId) {
    for (const ev of recentWs.slice().reverse()) {
      const result = resultForDealId(ev.payload, dealId);
      if (result) return { result, event: `${ev.event}#${dealId.slice(0, 8)}` };
    }
    // Known id but no matching close yet — do NOT fall back to another deal's
    // verdict, just keep waiting.
    return null;
  }

  return null;
}

// True when the page is backgrounded, where Chrome throttles timers and PO's
// balance DOM updates lazily — balance-derived verdicts cannot be trusted.
function isDocumentThrottled() {
  try { return document.visibilityState === 'hidden'; } catch (_) { return false; }
}

function classifyResultFromBalance(balanceBefore, balanceDuringTrade, balanceNow, amount, iteration, elapsedMs = iteration * 500) {
  if (balanceNow === null) return null;

  const settleTolerance = Math.max(0.15, amount * 0.15);
  const tieTolerance = Math.max(0.05, amount * 0.05);
  const tieToleranceDuring = Math.max(0.10, amount * 0.10);
  const enoughTieTime = iteration >= 4 || elapsedMs >= 4000;
  const enoughLossTime = iteration >= 10 || elapsedMs >= 10000;

  if (balanceBefore !== null) {
    const deltaFromBefore = balanceNow - balanceBefore;

    if (enoughTieTime && Math.abs(deltaFromBefore) <= tieTolerance) {
      return { result: 'tie', detail: `balance returned to pre-trade level (${deltaFromBefore.toFixed(2)})` };
    }

    if (deltaFromBefore > amount * 0.5) {
      return { result: 'win', detail: `balance vs before +${deltaFromBefore.toFixed(2)}` };
    }

    if (enoughLossTime && deltaFromBefore < -(amount * 0.5)) {
      // Interim guard: a hidden tab is throttled, so PO's balance can lag 30s+
      // and a WIN's payout may simply not have landed yet. Measured live:
      // 31s to see a stake in a background tab vs 1-2s in the foreground, and a
      // $1 win booked as a LOSS because the +1.92 arrived after the verdict.
      // Never ladder on that; keep waiting for the socket event instead.
      if (isDocumentThrottled()) return null;
      return { result: 'loss', detail: `balance vs before ${deltaFromBefore.toFixed(2)}` };
    }
  }

  if (balanceDuringTrade !== null) {
    const deltaFromDuring = balanceNow - balanceDuringTrade;

    if (enoughTieTime && Math.abs(deltaFromDuring - amount) <= tieToleranceDuring) {
      return { result: 'tie', detail: `stake returned vs during (${deltaFromDuring.toFixed(2)} ≈ ${amount.toFixed(2)})` };
    }

    if (deltaFromDuring > amount * 1.1) {
      return { result: 'win', detail: `balance vs during +${deltaFromDuring.toFixed(2)}` };
    }

    if (enoughLossTime && Math.abs(deltaFromDuring) <= settleTolerance) {
      if (isDocumentThrottled()) return null;   // same guard as above
      return { result: 'loss', detail: `balance stayed near trade-open balance (${deltaFromDuring.toFixed(2)})` };
    }
  }

  return null;
}

async function resolveTradeResult(balanceBefore, balanceDuringTrade, amount, tradeStartTs, preTradeSignatures) {
  const resolveStartTs = Date.now();
  const debug = {
    startedAt: new Date(tradeStartTs).toISOString(),
    amount,
    balanceBefore,
    balanceDuringTrade,
    samples: [],
    method: null,
    result: null,
    detail: null,
  };

  for (let i = 0; i < 80; i++) {
    const wsResult = readWsTradeResultSince(tradeStartTs);
    if (wsResult) {
      console.log('[Avalisa] RESULT:', wsResult.result.toUpperCase(), 'via WS event:', wsResult.event);
      state.lastTradeResultDebug = { ...debug, method: 'ws', result: wsResult.result, detail: wsResult.event };
      return wsResult.result;
    }

    const balanceNow = await getBalance();
    debug.samples.push({
      i,
      ts: Date.now(),
      balanceNow,
      deltaFromBefore: balanceBefore !== null && balanceNow !== null ? +(balanceNow - balanceBefore).toFixed(2) : null,
      deltaFromDuring: balanceDuringTrade !== null && balanceNow !== null ? +(balanceNow - balanceDuringTrade).toFixed(2) : null,
    });
    if (debug.samples.length > 20) debug.samples.shift();

    const balanceResult = classifyResultFromBalance(balanceBefore, balanceDuringTrade, balanceNow, amount, i, Date.now() - resolveStartTs);
    if (balanceResult) {
      console.log(`[Avalisa] RESULT: ${balanceResult.result.toUpperCase()} via ${balanceResult.detail}`);
      state.lastTradeResultDebug = { ...debug, method: 'balance', result: balanceResult.result, detail: balanceResult.detail };
      return balanceResult.result;
    }

    if (i >= 20) {
      const domResult = findResolvedNewDealResult(preTradeSignatures);
      if (domResult) {
        console.log(`[Avalisa] RESULT: ${domResult.result.toUpperCase()} via late DOM deal scrape (${domResult.signature})`);
        state.lastTradeResultDebug = { ...debug, method: 'dom-late', result: domResult.result, detail: domResult.signature };
        return domResult.result;
      }
    }

    await sleep(500);
  }

  console.warn('[Avalisa] RESULT: UNKNOWN (inconclusive after all tiers — holding martingale state)');
  state.lastTradeResultDebug = { ...debug, method: 'inconclusive', result: 'unknown', detail: 'holding martingale state' };
  return 'unknown';
}
