/**
 * Avalisa PO Bot v2 - Pocket Option DOM helpers
 * Loaded before content.js by manifest order.
 */

function normalizeAssetName(name) {
  if (!name) return name;
  return name
    .replace(/\s+OTC$/i, '_otc')
    .replace(/\//g, '')
    .trim();
}

function getDurationSecondsFromDom() {
  const el = document.querySelector(PO_SELECTORS.durationBlock);
  if (!el) return null;
  const text = el.textContent || '';
  if (text.includes('UTC')) return null;
  const match = text.match(/(\d{2}):(\d{2}):(\d{2})/);
  if (!match) return null;
  const seconds = (+match[1] * 3600) + (+match[2] * 60) + (+match[3]);
  return seconds > 0 && seconds <= 3600 ? seconds : null;
}

function getCurrentPeriodSeconds(fallbackTf = state.settings?.timeframe || 'M1') {
  return getDurationSecondsFromDom() || TF_TO_SECONDS[fallbackTf] || 60;
}

async function getBalance() {
  const demo = isDemoMode();
  const selectors = demo ? PO_SELECTORS.balance.demo : PO_SELECTORS.balance.real;

  // v2.4.8: dedicated balance selectors are the primary source (visibility-guarded
  // so hidden/stale account elements are skipped). Free-text parsing of the page
  // is fallback only — it can grab an unrelated number, and a misread balance can
  // falsely pause a live martingale ladder.
  for (let attempt = 1; attempt <= 3; attempt++) {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && isVisibleAccountBalanceElement(el)) {
        const text = el.textContent.replace(/[^0-9.]/g, '');
        const val = parseFloat(text);
        if (val > 0) {
          debugLog(`[Avalisa] Balance found via: ${sel} = ${val} (mode=${demo ? 'demo' : 'real'}, attempt=${attempt})`);
          return val;
        }
      }
    }
    const activeTextBalance = getActiveAccountBalanceFromText(demo);
    if (activeTextBalance !== null) {
      debugLog(`[Avalisa] Balance found via active account text = ${activeTextBalance} (mode=${demo ? 'demo' : 'real'}, attempt=${attempt})`);
      return activeTextBalance;
    }
    if (attempt < 3) await sleep(300);
  }
  console.warn('[Avalisa] Balance not found after 3 attempts — mode:', demo ? 'demo' : 'real');
  return null;
}

function isVisibleAccountBalanceElement(el) {
  if (!(el instanceof Element)) return false;
  if (el.closest('#avalisa-overlay') || el.closest('#avalisa-panel')) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function getActiveAccountBalanceFromText(demo) {
  const lines = getBodyTextLines();
  const modePattern = demo ? /\bdemo\b/i : /\breal\b/i;
  const amountPattern = /(?:\$|USD\s*)\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i;

  for (let i = 0; i < lines.length; i++) {
    if (!modePattern.test(lines[i])) continue;
    const windowText = lines.slice(i, i + 5).join(' ');
    const match = windowText.match(amountPattern);
    if (!match) continue;
    const val = parseFloat(match[1].replace(/,/g, ''));
    if (Number.isFinite(val) && val > 0) return val;
  }

  return null;
}

function getTradeAmountInput() {
  const selectors = PO_SELECTORS.tradeAmount;

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && !el.closest('#avalisa-overlay') && !el.closest('#avalisa-panel')) {
      return { input: el, selector: sel };
    }
  }

  return { input: null, selector: null, selectors };
}

function setTradeAmount(amount) {
  const { input, selector: matchedSelector, selectors } = getTradeAmountInput();

  if (!input) {
    console.warn('[Avalisa] setTradeAmount: no input found. Tried:', selectors);
    return false;
  }

  const valueStr = amount.toFixed(2);
  console.log('[Avalisa] setTradeAmount: using selector:', matchedSelector, '| setting amount:', valueStr);

  input.focus();
  input.select();

  const typed = typeof document.execCommand === 'function'
    ? document.execCommand('insertText', false, valueStr)
    : false;

  if (!typed) {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeSetter.call(input, valueStr);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  const acceptedValue = parseFloat(String(input.value || '').replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(acceptedValue) || Math.abs(acceptedValue - amount) > 0.01) {
    console.warn('[Avalisa] setTradeAmount: value did not stick. wanted:', valueStr, 'actual:', input.value);
    input.focus();
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeSetter.call(input, valueStr);
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertReplacementText',
      data: valueStr,
    }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  }

  const finalValue = parseFloat(String(input.value || '').replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(finalValue) || Math.abs(finalValue - amount) > 0.01) {
    console.warn('[Avalisa] setTradeAmount: PO rejected amount. wanted:', valueStr, 'actual:', input.value);
    return false;
  }

  return true;
}

async function ensureDurationPanel() {
  const block = document.querySelector(PO_SELECTORS.durationBlock);
  if (!block) return;

  const blockText = block.textContent || '';
  if (!blockText.includes('UTC')) return;

  console.log('[Avalisa] ensureDurationPanel: clock panel detected — switching to duration panel');

  const toggleSelectors = PO_SELECTORS.durationToggle;

  for (const sel of toggleSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      console.log('[Avalisa] ensureDurationPanel: trying toggle selector:', sel);
      el.click();
      await sleep(700);
      if (!document.querySelector(PO_SELECTORS.durationBlock)?.textContent?.includes('UTC')) {
        console.log('[Avalisa] ensureDurationPanel: switched successfully');
        return;
      }
    }
  }

  console.warn('[Avalisa] ensureDurationPanel: could not switch panels — logging block children to help diagnose:');
  block.querySelectorAll('*').forEach(el => {
    if (el.tagName && el.children.length === 0 && el.textContent.trim()) {
      console.log('[Avalisa]  child:', el.tagName, el.className, JSON.stringify(el.textContent.trim().substring(0, 30)));
    }
  });
}

async function setTimeframe(tf, retried = false) {
  const tfTimeMap = {
    S30: '00:00:30',
    M1:  '00:01:00', M3:  '00:03:00',
    M5:  '00:05:00', M30: '00:30:00',
    H1:  '01:00:00',
  };
  const targetTime = tfTimeMap[tf];
  if (!targetTime) {
    console.warn('[Avalisa] setTimeframe: unknown tf:', tf);
    return null;
  }

  await ensureDurationPanel();

  const valEl = document.querySelector(PO_SELECTORS.durationValue);
  const current = valEl?.textContent?.trim();
  if (current === targetTime) {
    console.log('[Avalisa] setTimeframe: already set to', tf);
    return tf;
  }
  console.log('[Avalisa] setTimeframe: current =', current, '→ target =', tf, '(', targetTime, ')');

  // The trigger TOGGLES the list. If it is already open (PO often leaves it open
  // after a manual change) clicking would close it and we would then read zero
  // options — observed live 2026-08-17 as an endless
  // "could not find option ... items found: 0" retry that never traded.
  const trigger = document.querySelector(PO_SELECTORS.durationTrigger);
  const listOpen = () => document.querySelectorAll(PO_SELECTORS.timeframeItems).length > 0;
  if (trigger && !listOpen()) {
    trigger.click();
    for (let i = 0; i < 25; i++) {
      await sleep(100);
      if (listOpen()) break;
    }
    // One retry: a stray click elsewhere can swallow the first open.
    if (!listOpen()) {
      trigger.click();
      for (let i = 0; i < 15; i++) {
        await sleep(100);
        if (listOpen()) break;
      }
    }
  }

  let items = document.querySelectorAll(PO_SELECTORS.timeframeItems);

  // A "+"-prefixed item ("+S30", "+M1") means the panel is in ABSOLUTE-TIME mode,
  // where that button ADDS 30s/1m to the expiry clock rather than selecting a
  // 30s/1m trade. Clicking one would arm a trade of the wrong length, so these
  // are never selectable — seeing them means we must switch panels and retry.
  // (An earlier fix treated "+S30" as equivalent to "S30"; that was wrong.)
  const isAddButton = t => /^\s*\+/.test(String(t || ''));
  const normTf = t => String(t || '').trim().toUpperCase();

  const clickItem = async (item, selectedTf, reason) => {
    item.click();
    console.log('[Avalisa] setTimeframe:', reason, selectedTf);
    await sleep(300);
    closePOPopovers();
    for (let i = 0; i < 10; i++) {
      const actual = document.querySelector(PO_SELECTORS.durationValue)?.textContent?.trim();
      if (actual === tfTimeMap[selectedTf]) return selectedTf;
      await sleep(100);
    }
    console.warn('[Avalisa] Expiry change was not confirmed:', selectedTf);
    return null;
  };

  const selectable = Array.from(items).filter(i => !isAddButton(i.textContent));

  // Only "+" items on offer → we are in absolute-time mode. Switch and retry once.
  if (items.length > 0 && selectable.length === 0) {
    console.warn('[Avalisa] setTimeframe: expiry panel is in absolute-time mode ("+" buttons) — switching to duration and retrying');
    closePOPopovers();
    await sleep(400);
    await ensureDurationPanel();
    await sleep(400);
    return retried ? null : setTimeframe(tf, true);
  }

  for (const item of selectable) {
    if (normTf(item.textContent) === normTf(tf)) {
      return clickItem(item, tf, 'clicked grid item');
    }
  }

  for (const item of selectable) {
    if (normTf(item.textContent) === normTf(targetTime)) {
      return clickItem(item, tf, 'clicked item by time string');
    }
  }

  const fallbackTf = chooseAvailableTimeframeFallback(tf, selectable);
  if (fallbackTf) {
    const fallbackTime = tfTimeMap[fallbackTf];
    for (const item of selectable) {
      const text = normTf(item.textContent);
      if (text === normTf(fallbackTf) || text === normTf(fallbackTime)) {
        console.warn('[Avalisa] setTimeframe: requested option unavailable, falling back', tf, '→', fallbackTf);
        return clickItem(item, fallbackTf, 'clicked fallback item');
      }
    }
  }

  console.warn('[Avalisa] setTimeframe: could not find option for', tf,
    '| items found:', items.length,
    '| texts:', Array.from(items).map(i => i.textContent.trim()));
  // Leave the panel closed rather than toggling blindly — a list left open is
  // exactly what makes the NEXT attempt read zero options.
  closePOPopovers();
  return null;
}

function chooseAvailableTimeframeFallback(preferredTf, items) {
  const tfTimeMap = {
    S30: '00:00:30',
    M1:  '00:01:00', M3:  '00:03:00',
    M5:  '00:05:00', M30: '00:30:00',
    H1:  '01:00:00',
  };
  const fallbackOrder = {
    S30: ['M1', 'M3', 'M5'],
    M1: ['S30', 'M3', 'M5'],
    M3: ['M1', 'M5', 'S30'],
    M5: ['M3', 'M1', 'S30'],
    M30: ['M5', 'M3', 'M1'],
    H1: ['M30', 'M5', 'M3', 'M1'],
  };
  // "+" items are absolute-time add-buttons, never valid durations; callers
  // pass an already-filtered list, so a plain upper-case compare is right here.
  const norm = t => String(t || '').trim().toUpperCase();
  const texts = new Set(Array.from(items || []).map(item => norm(item.textContent)));
  const choices = fallbackOrder[preferredTf] || ['M1', 'M3', 'M5', 'S30'];
  return choices.find(candidate => texts.has(norm(candidate)) || texts.has(norm(tfTimeMap[candidate]))) || null;
}

function closePOPopovers() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  document.body?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  document.querySelector(PO_SELECTORS.closePopoverTarget)?.click();
}

function isUsableTradeButton(el) {
  if (!(el instanceof Element)) return false;
  if (el.closest('#avalisa-overlay') || el.closest('#avalisa-panel')) return false;
  if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return false;

  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

function resolveTradeButton(action, selectors) {
  for (const sel of selectors) {
    const btn = document.querySelector(sel);
    if (isUsableTradeButton(btn)) {
      debugLog(`[Avalisa] ${action.toUpperCase()} button found with selector:`, sel);
      return btn;
    }
  }
  return null;
}

function assessPOLayoutHealth() {
  const issues = [];
  const amount = getTradeAmountInput();
  const callButton = resolveTradeButton('call', getCallButtonSelectors());
  const putButton = resolveTradeButton('put', getPutButtonSelectors());
  const durationSeconds = getDurationSecondsFromDom();
  const currentPair = getCurrentPair();

  if (!amount.input) issues.push('amount input');
  if (!callButton) issues.push('CALL button');
  if (!putButton) issues.push('PUT button');
  if (!currentPair || currentPair === 'UNKNOWN') issues.push('active pair');

  return {
    ok: issues.length === 0,
    message: issues.length === 0 ? 'PO layout ready' : `PO layout changed: missing ${issues.join(', ')}`,
    issues,
    controls: {
      amountSelector: amount.selector,
      hasCallButton: Boolean(callButton),
      hasPutButton: Boolean(putButton),
      durationSeconds,
      currentPair,
      mode: isDemoMode() ? 'demo' : 'real',
    },
  };
}

function getCallButtonSelectors() {
  return PO_SELECTORS.tradeButtons.call.slice();
}

function getPutButtonSelectors() {
  return PO_SELECTORS.tradeButtons.put.slice();
}

function clickCall() {
  const selectors = getCallButtonSelectors();
  const btn = resolveTradeButton('call', selectors);
  if (btn) { btn.click(); return true; }
  console.warn('[Avalisa] clickCall: no call button found. Tried:', selectors);
  return false;
}

function clickPut() {
  const selectors = getPutButtonSelectors();
  const btn = resolveTradeButton('put', selectors);
  if (btn) { btn.click(); return true; }
  console.warn('[Avalisa] clickPut: no put button found. Tried:', selectors);
  return false;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getExpiryMs() {
  const tf = state.settings?.timeframe || 'M1';
  const settingsMs = (TF_TO_SECONDS[tf] || 60) * 1000;
  const domSeconds = getDurationSecondsFromDom();
  if (domSeconds) {
    const domMs = domSeconds * 1000;
    console.log('[Avalisa] Expiry from DOM:', domSeconds + 's | from settings:', settingsMs / 1000 + 's');
    return domMs;
  }

  console.log('[Avalisa] Expiry from settings (DOM failed):', settingsMs / 1000 + 's');
  return settingsMs;
}

function countDealElements() {
  let count = 0;
  for (const sel of PO_SELECTORS.deals) {
    count += document.querySelectorAll(sel).length;
  }
  return count;
}

async function waitForTradeOpen(balanceBefore, amount, timeoutMs = 10000, dealCountBefore = null) {
  // Confirming an open used to require an ABSOLUTE drop below
  // balanceBefore - amount*0.3. That silently fails whenever the PREVIOUS
  // trade's payout lands inside this window: the payout pushes the balance UP,
  // so the new stake never crosses the threshold, the order is declared
  // unconfirmed, and the cycle re-fires THE SAME MARTINGALE RUNG — while the
  // first order is in fact live. Observed on 2026-08-17: $16 then $16 again,
  // and $64 immediately after a $64 win paid +122.88, i.e. $128 of real
  // exposure on a rung the user believed was $64.
  //
  // Three signals now, cheapest first, and any one of them counts as open:
  //   1. absolute drop below the threshold  (clean case, no payout interference)
  //   2. a step-down of ~the stake between consecutive samples (survives a
  //      payout landing mid-window, because it measures the delta not the level)
  //   3. a new deal element in PO's own list — direct evidence PO accepted the
  //      order, previously logged as a "hint" and then thrown away
  const threshold = balanceBefore - (amount * 0.3);
  const stepDrop = amount * 0.7;
  const beforeCount = Number.isFinite(dealCountBefore) ? dealCountBefore : countDealElements();
  let sawNewDealElement = false;
  let lastBalance = balanceBefore;
  let prevSample = null;

  await sleep(1500);
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    // PO's own successopenOrder event is authoritative and arrives on the socket
    // even when a throttled tab has frozen the balance DOM. Prefer it.
    const dealId = reconcileCurrentDealId();
    if (dealId) {
      console.log('[Avalisa] Trade confirmed via PO socket:', dealId);
      const bal = await getBalance();
      return { opened: true, balanceDuring: bal ?? lastBalance ?? balanceBefore, method: 'ws-open' };
    }

    const dealCountNow = countDealElements();
    if (!sawNewDealElement && dealCountNow > beforeCount) {
      sawNewDealElement = true;
      console.log('[Avalisa] New deal appeared in PO list (count:', beforeCount, '→', dealCountNow, ')');
    }

    const bal = await getBalance();
    if (bal !== null) lastBalance = bal;

    if (bal !== null && bal <= threshold) {
      console.log('[Avalisa] Trade confirmed via balance drop:', balanceBefore, '→', bal);
      return { opened: true, balanceDuring: bal, method: 'balance-drop' };
    }

    // Stake deduction seen as a step down, even if a payout raised the level.
    if (bal !== null && prevSample !== null && (prevSample - bal) >= stepDrop) {
      console.log('[Avalisa] Trade confirmed via balance step-down:', prevSample, '→', bal, '(stake ~', amount, ')');
      return { opened: true, balanceDuring: bal, method: 'balance-step-drop' };
    }
    if (bal !== null) prevSample = bal;

    await sleep(250);
  }

  const finalBal = await getBalance();

  // PO showed a new deal but the balance never gave us a clean reading. The
  // order is far more likely live than lost, and the costs are asymmetric:
  // calling it open risks one unresolved trade (the resolver books it 'unknown'
  // and the ladder HOLDS), while calling it closed re-fires the same rung and
  // doubles real money at risk. Take the safe error.
  if (sawNewDealElement) {
    console.warn('[Avalisa] No clean balance confirmation, but PO listed a new deal — treating as OPEN to avoid re-firing the same rung. balance:', finalBal, 'was:', balanceBefore);
    return {
      opened: true,
      balanceDuring: finalBal ?? lastBalance ?? balanceBefore,
      method: 'dom-deal-no-balance-drop',
    };
  }

  console.warn('[Avalisa] waitForTradeOpen: no balance deduction and no new deal — not counting trade. balance:', finalBal, 'was:', balanceBefore);
  return {
    opened: false,
    balanceDuring: finalBal ?? lastBalance ?? balanceBefore,
    method: 'timeout-no-balance-drop',
  };
}

function parsePayoutPercent(text) {
  if (!text) return null;
  const m = String(text).match(/\+?\s*(\d{1,3})\s*%/);
  if (!m) return null;
  const v = parseInt(m[1], 10);
  return v >= 0 && v <= 200 ? v : null;
}

function getCurrentPayoutPercent() {
  for (const sel of PO_SELECTORS.payoutDirect) {
    const el = document.querySelector(sel);
    const v = parsePayoutPercent(el?.textContent);
    if (v !== null) return v;
  }
  const header = document.querySelector(PO_SELECTORS.payoutHeader);
  const v = parsePayoutPercent(header?.textContent);
  if (v !== null) return v;
  return null;
}

function getFavoritePairs() {
  const seen = new Set();
  const seenNames = new Set();
  const results = [];
  for (const sel of PO_SELECTORS.favoriteContainers) {
    const nodes = document.querySelectorAll(sel);
    if (nodes.length === 0) continue;
    nodes.forEach(node => {
      if (seen.has(node)) return;
      seen.add(node);
      const nameEl = node.querySelector(PO_SELECTORS.favoriteName);
      const name = (nameEl?.textContent || node.getAttribute('data-asset') || '').trim();
      const payout = parsePayoutPercent(node.textContent);
      const key = normalizeAssetName(name);
      if (name && payout !== null && !seenNames.has(key)) {
        seenNames.add(key);
        results.push({ name, payout, el: node });
      }
    });
    if (results.length > 0) break;
  }
  return results;
}

function clickFavoritePair(fav) {
  if (!fav || !fav.el) return false;
  try {
    fav.el.click();
    state.lastPairSwitchAt = Date.now();
    setTimeout(closePOPopovers, 400);
    return true;
  } catch (err) {
    console.warn('[Avalisa] Payout Monitor: click favorite failed', err);
    return false;
  }
}

function getPayoutSettings() {
  const minPct = Number.isFinite(+state.payoutMinPercent) ? +state.payoutMinPercent : 90;
  const action = state.payoutAction === 'keep'
    ? 'off'
    : (['off', 'stop', 'switch'].includes(state.payoutAction) ? state.payoutAction : 'switch');
  return { minPct, action };
}

async function checkPayoutBeforeTrade(options = {}) {
  const allowSwitch = options.allowSwitch !== false;
  const { minPct, action } = getPayoutSettings();
  if (action === 'off') return { proceed: true };
  const current = getCurrentPayoutPercent();

  if (current === null) {
    return { proceed: false, halt: true, reason: 'Cannot read current pair payout. Wait for PO to load and restart.' };
  }
  console.log(`[Avalisa] Payout Monitor: current=${current}% threshold=${minPct}% action=${action}`);

  if (current >= minPct) return { proceed: true };

  if (action === 'stop') {
    return { proceed: false, halt: true, reason: `Payout ${current}% below ${minPct}% threshold` };
  }

  if (!allowSwitch) {
    return { proceed: false, halt: true, reason: `Payout ${current}% below ${minPct}% threshold; current-pair mode prevents switching` };
  }

  const favorites = getFavoritePairs();
  if (favorites.length === 0) {
    return { proceed: false, halt: true, reason: 'Star at least 1 pair in PO Favorites to use Auto-switch.' };
  }
  favorites.sort((a, b) => b.payout - a.payout);
  const best = favorites[0];
  if (best.payout < minPct) {
    return { proceed: false, halt: true, reason: `No favorite >= ${minPct}% (highest ${best.payout}%)` };
  }

  const currentPair = (getCurrentPair() || '').trim();
  if (normalizeAssetName(best.name) === normalizeAssetName(currentPair)) {
    return { proceed: false, halt: true, reason: `Current pair payout ${current}% below ${minPct}% threshold` };
  }

  console.log(`[Avalisa] Payout Monitor: switching to ${best.name} (${best.payout}%)`);
  if (!clickFavoritePair(best)) {
    return { proceed: false, halt: true, reason: `Could not switch to ${best.name}` };
  }
  await sleep(1500);
  if (normalizeAssetName(getCurrentPair() || '') !== normalizeAssetName(best.name)) {
    return { proceed: false, halt: true, reason: `Could not confirm switch to ${best.name}` };
  }
  const switchedPayout = getCurrentPayoutPercent();
  if (switchedPayout === null || switchedPayout < minPct) {
    return { proceed: false, halt: true, reason: `Cannot confirm payout >= ${minPct}% after switching to ${best.name}` };
  }
  return { proceed: true };
}

function isDemoMode() {
  // Detect the ACTIVE Pocket Option account.
  //
  // IMPORTANT: the demo-balance element (.js-balance-demo) is ALWAYS present in
  // the DOM — even on a real account, it keeps holding the demo balance. Using
  // its presence/value to decide (the old behaviour) made real accounts report
  // as demo, so the bot read the demo balance, every real trade resolved as a
  // "tie" (balance never moved), and Martingale never laddered on real accounts.
  //
  // Reliable signals instead:
  //   1. URL — PO encodes the mode: demo => "/cabinet/demo-quick-high-low/...",
  //      real => "/cabinet/quick-high-low/...".
  //   2. The visible active-account label ("… Demo" vs "… Real").
  if (/\bdemo\b/i.test(location.pathname)) return true;

  const labels = document.querySelectorAll(PO_SELECTORS.activeAccountLabels);
  for (const el of labels) {
    const t = el.textContent || '';
    if (/\bdemo\b/i.test(t)) return true;
    if (/\breal\b/i.test(t)) return false;
  }

  const textMode = getActiveAccountModeFromText();
  if (textMode === 'demo') return true;
  if (textMode === 'real') return false;

  // Couldn't resolve from URL or label → assume REAL. Never silently treat a
  // real account as demo (that's the failure mode we're fixing).
  return false;
}

function getActiveAccountModeFromText() {
  const lines = getBodyTextLines();

  for (const line of lines) {
    if (/^(QT\s+)?Demo$/i.test(line)) return 'demo';
    if (/^(QT\s+)?Real$/i.test(line)) return 'real';
  }

  return null;
}

function getBodyTextLines() {
  const innerText = document.body?.innerText;
  if (innerText) {
    return innerText.split(/\n+/).map(line => line.trim()).filter(Boolean);
  }

  const leaves = Array.from(document.body?.querySelectorAll('*') || [])
    .filter(el => el.children.length === 0)
    .map(el => (el.textContent || '').trim())
    .filter(Boolean);
  if (leaves.length) return leaves;

  return (document.body?.textContent || '')
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean);
}

function getCurrentPair() {
  for (const sel of PO_SELECTORS.currentPair) {
    const assetEl = document.querySelector(sel);
    const pair = assetEl?.textContent?.trim();
    if (pair) return pair;
  }
  return 'UNKNOWN';
}
