// Shared free-trial UI: scan counter, post-value email gate, personalised paywall
// and the Multi-Strategy tease. Loaded by popup.html, multiple-strategies.html and auth.html.
const Trial = (() => {
  const CHECKOUT_BASE = 'https://inventabot.com/software/traid';

  // ---------- state ----------

  function getStatus(callback) {
    chrome.runtime.sendMessage({ action: 'getTrialStatus' }, (status) => {
      if (chrome.runtime.lastError || !status) {
        callback({ licensed: false, scansUsed: 0, scansLeft: 3, limit: 3, hasEmail: false,
                   needsEmail: false, multiUnlocked: true, canScan: true });
        return;
      }
      callback(status);
    });
  }

  function getAuthCode() {
    return new Promise((resolve) => {
      chrome.storage.sync.get('uniqueInstallationId', (data) => {
        if (data.uniqueInstallationId) {
          resolve(data.uniqueInstallationId);
          return;
        }
        chrome.storage.local.get('uniqueInstallationId', (local) => {
          resolve(local.uniqueInstallationId || '');
        });
      });
    });
  }

  function openCheckout() {
    chrome.storage.local.set({ pendingLicenseRecheck: true });
    chrome.storage.local.get('email', async (data) => {
      const email = data.email || '';
      const authCode = await getAuthCode();
      window.open(`${CHECKOUT_BASE}?auth=${authCode}&email=${encodeURIComponent(email)}`, '_blank');
    });
  }

  // ---------- risk maths, so the paywall can talk about their own trade ----------

  function num(value) {
    const parsed = parseFloat(String(value == null ? '' : value).replace(/[^0-9.-]+/g, ''));
    return isNaN(parsed) ? null : parsed;
  }

  function riskProfile(signal) {
    if (!signal) return null;
    const entry = num(signal.entry);
    const stop = num(signal.stop);
    const target = num(signal.profit);
    if (entry === null || stop === null || target === null || entry === 0) return null;

    const risk = Math.abs(entry - stop);
    const reward = Math.abs(target - entry);
    if (risk === 0) return null;

    return {
      coin: signal.coin || 'your setup',
      riskPct: (risk / entry) * 100,
      rewardPct: (reward / entry) * 100,
      rr: reward / risk
    };
  }

  function getHistory(callback) {
    chrome.storage.local.get(['scanHistory', 'firstMultiResult'], (data) => {
      callback({
        history: Array.isArray(data.scanHistory) ? data.scanHistory : [],
        firstMulti: data.firstMultiResult || null
      });
    });
  }

  // ---------- styles (injected once, so both stylesheets stay untouched) ----------

  // Black surfaces with the app's existing --accent-blue (#2962FF). Flat and restrained:
  // one accent hairline instead of decorative gradients.
  const CSS = `
  .traid-trial-banner{margin:12px 0;padding:12px 14px;border-radius:10px;text-align:center;
    font-size:13.5px;font-weight:600;color:#E8EAF0;background:#0A0D13;
    border:1px solid rgba(41,98,255,.30);border-left:3px solid #2962FF;}
  .traid-trial-banner b{font-weight:800;color:#5C8CFF;}
  .traid-trial-banner .traid-sub{display:block;margin-top:4px;font-size:11.5px;
    font-weight:500;color:#8A90A0;}
  .traid-card{margin:14px 0;padding:24px 20px;border-radius:14px;text-align:center;
    background:#0A0D13;border:1px solid rgba(255,255,255,.07);
    border-top:2px solid #2962FF;}
  .traid-card h3{margin:0 0 8px;font-size:19px;font-weight:800;color:#fff;letter-spacing:-.2px;}
  .traid-card p{margin:0 0 14px;font-size:13.5px;line-height:1.6;color:#A8AEBD;}
  .traid-card input{width:100%;box-sizing:border-box;padding:13px 14px;margin-bottom:10px;
    border-radius:8px;border:1px solid rgba(255,255,255,.14);background:#05070B;
    color:#fff;font-size:14px;outline:none;transition:border-color .15s ease;}
  .traid-card input:focus{border-color:#2962FF;}
  .traid-card input::placeholder{color:#5F6674;}
  .traid-btn{width:100%;padding:14px 20px;border:none;border-radius:8px;cursor:pointer;
    font-size:15px;font-weight:700;color:#fff;letter-spacing:.2px;background:#2962FF;
    transition:background .15s ease;}
  .traid-btn:hover{background:#1E4FD8;}
  .traid-btn.secondary{background:transparent;border:1px solid rgba(255,255,255,.14);
    color:#A8AEBD;font-size:13.5px;font-weight:600;padding:11px 18px;margin-top:9px;}
  .traid-btn.secondary:hover{background:rgba(255,255,255,.04);color:#E8EAF0;}
  .traid-note{margin:12px 0 0;font-size:11.5px;color:#5F6674;line-height:1.5;}
  .traid-err{margin:0 0 10px;font-size:12.5px;color:#EF5350;font-weight:600;}
  .traid-stat{background:#05070B;border-radius:10px;padding:14px;margin:0 0 14px;
    border:1px solid rgba(255,255,255,.06);}
  .traid-stat-row{display:flex;justify-content:space-between;align-items:center;
    font-size:13px;padding:6px 0;color:#A8AEBD;}
  .traid-stat-row span:last-child{font-weight:700;color:#fff;}
  .traid-stat-head{font-size:10.5px;letter-spacing:1.3px;text-transform:uppercase;
    color:#5F6674;font-weight:700;margin-bottom:10px;}
  .traid-rr{color:#26A69A !important;}
  .traid-blur{filter:blur(7px);pointer-events:none;user-select:none;opacity:.8;}
  .traid-lock-wrap{position:relative;overflow:hidden;border-radius:10px;}
  .traid-lock-over{position:absolute;inset:0;display:flex;flex-direction:column;
    align-items:center;justify-content:center;text-align:center;padding:16px;
    background:linear-gradient(180deg,rgba(5,7,11,.6) 0%,rgba(5,7,11,.94) 100%);}
  .traid-lock-over .traid-lock-icon{font-size:28px;margin-bottom:6px;}
  .traid-lock-over strong{color:#fff;font-size:15px;font-weight:800;display:block;margin-bottom:4px;}
  .traid-lock-over em{color:#A8AEBD;font-size:12.5px;font-style:normal;line-height:1.5;}
  .traid-chips{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin:2px 0 14px;}
  .traid-chip{background:rgba(41,98,255,.10);border:1px solid rgba(41,98,255,.28);
    color:#8FB0FF;font-size:11.5px;font-weight:700;padding:4px 10px;border-radius:6px;}
  `;

  function injectStyles() {
    if (document.getElementById('traid-trial-styles')) return;
    const style = document.createElement('style');
    style.id = 'traid-trial-styles';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // ---------- components ----------

  // The running counter. Scan 1 is sold as the headline offer.
  function renderBanner(container, status) {
    injectStyles();
    if (!container || status.licensed) return;

    if (status.scansLeft <= 0) {
      container.innerHTML = `<div class="traid-trial-banner">🔒 Free scans used — unlock to keep going</div>`;
      return;
    }

    if (status.scansUsed === 0) {
      container.innerHTML = `<div class="traid-trial-banner">
        🎁 Your first scan is <b>free</b> — and it's the full 10-strategy analysis
        <span class="traid-sub">No card, no signup. Just hit Analyze.</span>
      </div>`;
      return;
    }

    container.innerHTML = `<div class="traid-trial-banner">
      🎁 <b>${status.scansLeft} of ${status.limit}</b> free scan${status.scansLeft === 1 ? '' : 's'} left
    </div>`;
  }

  // Asked only after they've seen a real result — never before.
  function renderEmailGate(container, onUnlocked) {
    injectStyles();
    container.innerHTML = `
      <div class="traid-card">
        <h3>Nice — want more free scans?</h3>
        <p>Drop your email and we'll unlock the rest of your free scans right now — no card needed.</p>
        <p class="traid-err" id="traid-email-err" style="display:none;"></p>
        <input type="email" id="traid-email-input" placeholder="you@email.com" autocomplete="email">
        <button class="traid-btn" id="traid-email-btn">Unlock My Free Scans</button>
        <p class="traid-note">🔒 We'll only email you about your Traid access.</p>
      </div>`;

    const input = container.querySelector('#traid-email-input');
    const button = container.querySelector('#traid-email-btn');
    const error = container.querySelector('#traid-email-err');

    const submit = () => {
      const email = input.value.trim();
      if (!email || !email.includes('@')) {
        error.textContent = 'Please enter a valid email address.';
        error.style.display = 'block';
        return;
      }
      button.disabled = true;
      button.textContent = 'Unlocking...';
      chrome.runtime.sendMessage({ action: 'saveTrialEmail', email: email }, (response) => {
        if (response && response.success) {
          container.innerHTML = '';
          if (onUnlocked) onUnlocked(response.trial);
        } else {
          button.disabled = false;
          button.textContent = 'Unlock My Free Scans';
          error.textContent = (response && response.error) || 'Something went wrong. Try again.';
          error.style.display = 'block';
        }
      });
    };

    button.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    setTimeout(() => input.focus(), 60);
  }

  // Paywall built from the user's own scans instead of generic "license expired" copy.
  function renderPaywall(container) {
    injectStyles();
    getHistory(({ history }) => {
      const profile = riskProfile(history[0]);
      const coins = [];
      history.forEach(s => {
        const name = (s.coin || '').trim();
        if (name && name.toLowerCase() !== 'unknown' && coins.indexOf(name) === -1) coins.push(name);
      });

      let tradeBlock = '';
      if (profile) {
        // Their own numbers — no invented position sizes, no unverifiable price claims
        tradeBlock = `
          <div class="traid-stat">
            <div class="traid-stat-head">Your last setup — ${profile.coin}</div>
            <div class="traid-stat-row"><span>Risk</span><span>${profile.riskPct.toFixed(2)}%</span></div>
            <div class="traid-stat-row"><span>Target</span><span>${profile.rewardPct.toFixed(2)}%</span></div>
            <div class="traid-stat-row"><span>Risk-to-reward</span><span class="traid-rr">1:${profile.rr.toFixed(1)}</span></div>
          </div>
          <p>That setup carried <b>${profile.rr.toFixed(1)}x</b> more upside than downside —
             the kind of edge that's easy to miss by eye. Don't stop at ${history.length}.</p>`;
      } else {
        tradeBlock = `<p>Keep every strategy, every timeframe and every signal — and stop reading charts by eye.</p>`;
      }

      const chips = coins.length
        ? `<div class="traid-chips">${coins.slice(0, 6).map(c => `<div class="traid-chip">${c}</div>`).join('')}</div>`
        : '';

      const scanned = history.length
        ? `<p style="margin-bottom:8px;">You analysed <b>${history.length} chart${history.length === 1 ? '' : 's'}</b> on your free scans.</p>`
        : '';

      container.innerHTML = `
        <div class="traid-card">
          <h3>Your free scans are done</h3>
          ${scanned}
          ${chips}
          ${tradeBlock}
          <button class="traid-btn" id="traid-buy-btn">Unlock Unlimited Scans</button>
          <p class="traid-note">⚠️ Not financial advice. Figures are from your own scans, for information only.</p>
        </div>`;

      container.querySelector('#traid-buy-btn').addEventListener('click', openCheckout);
      container.style.display = 'block';
    });
  }

  // Multi-Strategy tease. Uses the consensus they genuinely earned on scan 1.
  function renderMultiUpsell(container) {
    injectStyles();
    getHistory(({ firstMulti }) => {
      let proof = '';
      if (firstMulti && (firstMulti.longScore || firstMulti.shortScore)) {
        const long = firstMulti.longScore || 0;
        const short = firstMulti.shortScore || 0;
        const side = long >= short ? 'LONG' : 'SHORT';
        const agree = Math.max(long, short);
        const total = firstMulti.strategyCount || (long + short);
        proof = `
          <div class="traid-stat">
            <div class="traid-stat-head">Your first multi-strategy scan</div>
            <div class="traid-stat-row"><span>Chart</span><span>${firstMulti.coin || '—'}</span></div>
            <div class="traid-stat-row"><span>Consensus</span><span class="traid-rr">${agree} of ${total} agreed ${side}</span></div>
          </div>`;
      }

      container.innerHTML = `
        <div class="traid-card">
          <h3>🚀 Multi-Strategy is a Pro feature</h3>
          ${proof}
          <p>Run all 10 strategies at once on any chart and get a single consolidated verdict —
             with the long/short scoreboard behind it.</p>
          <div class="traid-lock-wrap">
            <div class="traid-blur">
              <div class="traid-stat" style="margin:0;">
                <div class="traid-stat-row"><span>Wyckoff</span><span>LONG</span></div>
                <div class="traid-stat-row"><span>Elliott Wave</span><span>LONG</span></div>
                <div class="traid-stat-row"><span>Market Structure</span><span>SHORT</span></div>
                <div class="traid-stat-row"><span>Fibonacci</span><span>LONG</span></div>
              </div>
            </div>
            <div class="traid-lock-over">
              <div class="traid-lock-icon">🔒</div>
              <strong>All 10 strategies</strong>
              <em>Unlock to see every verdict and the consolidated signal</em>
            </div>
          </div>
          <button class="traid-btn" id="traid-multi-buy" style="margin-top:14px;">Unlock Multi-Strategy</button>
          <button class="traid-btn secondary" id="traid-multi-back">← Back to Single Strategy</button>
        </div>`;

      container.querySelector('#traid-multi-buy').addEventListener('click', openCheckout);
      container.querySelector('#traid-multi-back').addEventListener('click', () => {
        window.location.href = 'popup.html';
      });
    });
  }

  return {
    getStatus,
    renderBanner,
    renderEmailGate,
    renderPaywall,
    renderMultiUpsell,
    openCheckout,
    riskProfile
  };
})();
