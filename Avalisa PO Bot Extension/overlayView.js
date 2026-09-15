/**
 * Avalisa PO Bot v2 - Overlay view templates
 * Static HTML/CSS used by content.js overlay lifecycle.
 */

function getOverlayHTML() {
  const logoUrl = chrome.runtime.getURL('icons/avalisa-signature-logo-transparent.png');
  const loginUrl = chrome.runtime.getURL('login.html');
  const manifestVersion = chrome.runtime.getManifest().version;
  return `
    <div id="avalisa-panel">
      <div class="av-header" title="Drag to move the panel · double-click to reset position">
        <span class="av-logo">
          <img src="${logoUrl}" alt="Avalisa PO Bot" class="av-logo-img" />
          <span>Avalisa PO Bot</span>
          <span id="av-build-badge" class="av-build-badge" title="Loaded extension build">v${manifestVersion}</span>
        </span>
        <button id="av-close" class="av-icon-btn">✕</button>
      </div>

      <div id="av-auth-section" class="av-section">
        <!-- Sign-in is right here in the panel (visible the moment PO loads, no
             extra clicks) but the fields themselves live in an IFRAME on the
             extension's own origin. The panel is injected into Pocket Option's
             DOM, so a password typed directly here would be readable by PO's
             page scripts and by every other installed extension, and Chrome's
             password manager would refill it against po.trade on every load.
             Cross-origin means the page cannot reach into the frame. -->
        <div id="av-login-form">
          <div id="av-auto-note" class="av-signin-note" style="display:none"></div>
          <iframe id="av-login-frame" class="av-login-frame"
                  src="${loginUrl}" title="Sign in to Avalisa"></iframe>
          <button id="av-register-free-btn" class="av-btn av-btn-outline">Affiliate Pro</button>
        </div>
        <div id="av-logged-in" style="display:none">
          <div class="av-user-row">
            <span id="av-user-email" class="av-label"></span>
            <span id="av-plan-badge" class="av-plan-badge"></span>
            <button id="av-logout-btn" class="av-btn av-btn-sm">Logout</button>
          </div>
        </div>
      </div>

      <div class="av-section">
        <div class="av-row" id="av-row-strategy">
          <label class="av-label" title="Choose the bot logic. Martingale follows your direction rules. Avalisa Bot waits for indicator-based signals.">Strategy</label>
          <select id="av-strategy" class="av-select" title="Choose the bot logic. Martingale follows your direction rules. Avalisa Bot waits for indicator-based signals.">
            <option value="martingale" title="Rule mode: trade the selected direction and increase after losses.">Martingale</option>
            <!-- value stays "ai": it is persisted in every user's chrome.storage and sent
                 to the backend on each trade. The LABEL is what changed. -->
            <option value="ai" title="Signal mode: Avalisa checks candles, RSI, Bollinger Bands, volatility, and trend against a fixed rule set.">Avalisa Bot</option>
          </select>
        </div>
        <div class="av-row" id="av-row-direction">
          <label class="av-label" title="Direction used by Martingale mode.">Direction</label>
          <select id="av-direction" class="av-select" title="Direction used by Martingale mode.">
            <option value="alternating" title="Switches Buy/Sell each trade.">Alternating</option>
            <option value="call" title="Always places Buy/Call trades.">Always Buy</option>
            <option value="put" title="Always places Sell/Put trades.">Always Sell</option>
          </select>
        </div>
        <div class="av-row" id="av-row-timeframe">
          <label class="av-label" title="Trade expiry for Martingale mode.">Timeframe</label>
          <select id="av-timeframe" class="av-select" title="Trade expiry for Martingale mode.">
            <option value="S30" title="30 second expiry.">30s</option>
            <option value="M1" selected title="1 minute expiry.">1min</option>
            <option value="M3" title="3 minute expiry.">3min</option>
            <option value="M5" title="5 minute expiry.">5min</option>
          </select>
        </div>
        <div class="av-row" id="av-row-intensity" style="display:none">
          <label class="av-label" title="How many of the four rules must agree before Avalisa Bot trades.">Intensity</label>
          <select id="av-intensity" class="av-select" title="Required agreement: Low 2 of 4 rules, Mid 3 of 4, High 4 of 4. All allow OTC.">
            <option value="low" title="Most active. Lower confirmation, allows OTC.">Low</option>
            <option value="mid" selected title="Requires 3 of 4 rules. Allows OTC.">Mid</option>
            <option value="high" title="Requires all 4 rules. Allows OTC.">High</option>
          </select>
        </div>
        <div class="av-row" id="av-row-ai-pair-mode" style="display:none">
          <label class="av-label" title="Controls whether Avalisa Bot can rotate through favorite pairs.">Pair Scan</label>
          <select id="av-ai-pair-mode" class="av-select" title="Auto scan checks favorite pairs. Current pair only stays on the visible chart.">
            <option value="auto" selected title="Scan PO favorite pairs and switch to a payout-qualified signal.">Auto scan favorites</option>
            <option value="current" title="Never rotate pairs; trade only the visible chart.">Current pair only</option>
          </select>
        </div>
        <div class="av-row">
          <label class="av-label" title="First stake amount. Martingale resets to this after a win.">Start Amount ($)</label>
          <input id="av-start-amount" type="number" min="1" step="1" value="1" class="av-input av-input-sm" title="First stake amount. Martingale resets to this after a win." />
        </div>
        <div class="av-row">
          <label class="av-label" title="How much to multiply the next stake after a loss.">Martingale ×</label>
          <select id="av-multiplier" class="av-select" title="How much to multiply the next stake after a loss.">
            <option value="2.0" selected title="Double after each loss.">2.0×</option>
            <option value="2.2" title="Increase by 2.2x after each loss.">2.2×</option>
            <option value="2.4" title="Increase by 2.4x after each loss.">2.4×</option>
            <option value="2.6" title="Increase by 2.6x after each loss.">2.6×</option>
            <option value="2.8" title="Increase by 2.8x after each loss.">2.8×</option>
            <option value="3.0" title="Triple after each loss.">3.0×</option>
          </select>
        </div>
        <div class="av-row">
          <label class="av-label" title="Maximum recovery steps before returning to the start amount.">Martingale Steps</label>
          <select id="av-steps" class="av-select" title="Maximum recovery steps before returning to the start amount. Ties keep the same step and amount.">
            <option value="infinite" selected title="Keep recovering until a win or manual stop.">Infinite</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
            <option value="5">5</option>
            <option value="6">6</option>
            <option value="8">8</option>
            <option value="10">10</option>
            <option value="12">12</option>
          </select>
        </div>
        <div class="av-row av-payout-row">
          <label class="av-label" for="av-payout-min" title="Minimum payout Avalisa should accept before placing a trade.">Minimum payout %</label>
          <span class="av-payout-controls">
          <label class="av-switch" title="When on, Avalisa checks payout before trading.">
            <input id="av-payout-enabled" type="checkbox" checked />
            <span class="av-switch-slider"></span>
          </label>
          <input id="av-payout-min" type="number" min="1" max="100" step="1" value="90"
            class="av-input av-input-sm" title="Minimum payout Avalisa should accept before placing a trade." />
          </span>
        </div>
        <div class="av-row av-payout-action-row">
          <span></span>
          <select id="av-payout-action" class="av-select" title="Choose how Avalisa reacts when payout is below the minimum.">
            <option value="switch" selected title="Try to switch to the highest-payout favorite that meets the minimum.">Auto-switch favorite</option>
            <option value="stop" title="Stop the bot when payout is below the minimum.">Stop bot</option>
          </select>
        </div>
      </div>

      <div class="av-section av-controls">
        <button id="av-start-btn" class="av-btn av-btn-green">▶ Start</button>
        <button id="av-stop-btn" class="av-btn av-btn-red" disabled>■ Stop</button>
      </div>

      <div class="av-section av-status-block">
        <div id="av-status" class="av-status">Status: Stopped</div>
        <!-- Live signal readout (Avalisa Bot only). Shows which of the four rules
             currently agree, so a scan that is working but unconvinced is
             visibly different from one that has stalled. -->
        <div id="av-signal-box" class="av-signal-box" style="display:none">
          <div class="av-signal-head">
            <span id="av-signal-pair" class="av-signal-pair"></span>
            <span id="av-signal-score" class="av-signal-score"></span>
          </div>
          <ul id="av-signal-rules" class="av-signal-rules"></ul>
          <div id="av-signal-age" class="av-signal-age"></div>
        </div>
        <div id="av-token-status" class="av-counter" style="display:none"></div>
        <div id="av-trade-counter" class="av-counter">Trades this session: 0</div>
      </div>

      <div id="av-claim-block" class="av-section" style="display:none">
        <div id="av-claim-section" style="margin-top:8px; border-top:1px solid #2a4060; padding-top:8px;">
          <p style="font-size:11px; color:#8fa8c8; margin:0 0 6px 0;">Registered a new Pocket Option account through our link? Claim your free Pro access.</p>
          <button id="av-claim-btn" style="width:100%; padding:6px; background:#7c3aed; color:white; border:none; border-radius:4px; font-size:12px; cursor:pointer;">
            Claim Pro Access
          </button>
          <div id="av-claim-uid-input" style="display:none; margin-top:6px;">
            <input id="av-claim-uid" type="text" placeholder="Enter your Pocket Option UID"
              style="width:100%; padding:5px 8px; background:#0f0f23; border:1px solid #2d2d5b; border-radius:4px; color:#e2e8f0; font-size:11px; box-sizing:border-box; margin-bottom:4px;" />
            <button id="av-claim-submit" style="width:100%; padding:5px; background:#7c3aed; color:white; border:none; border-radius:4px; font-size:11px; cursor:pointer;">
              Submit Claim
            </button>
          </div>
          <div id="av-claim-status" style="font-size:11px; margin-top:6px; display:none;"></div>
        </div>
      </div>

      <div id="av-limit-msg" class="av-limit-msg" style="display:none">
        <p>Trade limit reached!</p>
        <a id="av-affiliate-link" class="av-btn av-btn-outline" target="_blank">Free Pro — needs a NEW PO account</a>
        <a id="av-upgrade-link" class="av-btn av-btn-primary" target="_blank">Upgrade Plan</a>
      </div>

      <div class="av-footer">
        <a href="https://avalisabot.vercel.app" target="_blank" rel="noopener">avalisabot.vercel.app</a>
        <span class="av-footer-sep"> · </span>
        <a id="av-plans-link" target="_blank" rel="noopener">Plans</a>
        <span class="av-footer-sep"> · </span>
        <a href="mailto:AvalisaPOBot@gmail.com">AvalisaPOBot@gmail.com</a>
      </div>
    </div>
  `;
}

function getOverlayCSS() {
  return `
    #avalisa-overlay {
      position: fixed; top: 80px; right: 20px; z-index: 999999;
      display: flex; font-family: 'Inter', system-ui, sans-serif;
    }
    #avalisa-panel {
      background: #1a1a2e; border: 1px solid #2d2d5b; border-radius: 12px;
      padding: 16px; width: 280px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      color: #e2e8f0;
    }
    .av-header {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 12px; cursor: grab; user-select: none;
    }
    .av-header:active { cursor: grabbing; }
    #avalisa-overlay.av-dragging { opacity: 0.92; }
    #avalisa-overlay.av-dragging #avalisa-panel { box-shadow: 0 12px 44px rgba(0,0,0,0.65); }
    .av-logo {
      display: inline-flex; align-items: center; gap: 8px;
      font-size: 15px; font-weight: 700; color: #a78bfa;
    }
    .av-logo-img { height: 26px; width: 52px; object-fit: contain; display: block; flex-shrink: 0; }
    .av-build-badge {
      font-size: 10px; font-weight: 700; color: #15120a; background: #f4c95d;
      border-radius: 999px; padding: 2px 6px; line-height: 1; letter-spacing: 0;
    }
    .av-icon-btn { background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 14px; }
    .av-icon-btn:hover { color: #e2e8f0; }
    .av-section { margin-bottom: 12px; border-bottom: 1px solid #2d2d5b; padding-bottom: 12px; }
    .av-section:last-child { border-bottom: none; margin-bottom: 0; }
    .av-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .av-row:last-child { margin-bottom: 0; }
    .av-label { font-size: 12px; color: #94a3b8; }
    .av-select, .av-input {
      background: #0f0f23; border: 1px solid #2d2d5b; border-radius: 6px;
      color: #e2e8f0; font-size: 12px; padding: 4px 8px;
    }
    .av-select { width: 130px; box-sizing: border-box; }
    .av-select:disabled, .av-input:disabled { opacity: 0.4; cursor: not-allowed; }
    .av-input { width: 100%; box-sizing: border-box; margin-top: 4px; padding: 6px 10px; }
    .av-input-sm { width: 130px; margin-top: 0; padding: 4px 8px; }
    .av-sublink {
      font-size: 11px; color: #A78BFA; text-decoration: none; cursor: pointer;
    }
    .av-sublink:hover { color: #C4B5FD; text-decoration: underline; }
    .av-controls { display: flex; gap: 8px; }
    .av-btn {
      border: none; border-radius: 6px; padding: 8px 14px; font-size: 13px;
      font-weight: 600; cursor: pointer; transition: opacity 0.2s; flex: 1;
    }
    .av-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .av-btn-primary { background: #7c3aed; color: #fff; }
    .av-btn-outline { background: transparent; border: 1px solid #7c3aed; color: #a78bfa; }
    .av-btn-green { background: #059669; color: #fff; }
    .av-btn-red { background: #dc2626; color: #fff; }
    .av-btn-sm { padding: 4px 10px; font-size: 11px; flex: none; }
    #av-logout-btn { background: #dc2626; color: #ffffff; }
    .av-user-row { display: flex; align-items: center; gap: 6px; flex-wrap: nowrap; }
    .av-user-row .av-label {
      flex: 1 1 auto; min-width: 0; max-width: 118px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .av-plan-badge {
      font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 10px;
      text-transform: uppercase; letter-spacing: 0.5px;
    }
    .av-plan-badge.plan-lifetime { background: #f4c95d; color: #15120a; }
    .av-plan-badge.plan-basic { background: #059669; color: #fff; }
    .av-plan-badge.plan-free { background: #3b82f6; color: #fff; }
    .av-login-frame {
      /* 196px, not 162px. The sign-in iframe is a FIXED-height box and an iframe CLIPS: when
         login.html gained the "Create an account / Forgot password?" links and the two-line
         note explaining that an Avalisa account is separate from Pocket Option, the content
         measured 192px against a 162px frame and the note - the exact sentence that answers
         the confusion a real customer wrote in about - was cut off entirely. Measured in the
         panel's true 248px content width, not eyeballed. Raise this if either grows again. */
      width: 100%; height: 196px; border: 0; display: block;
      margin-bottom: 8px; background: transparent; color-scheme: normal;
    }
    .av-signin-note {
      font-size: 11px; line-height: 1.5; color: #8fa8c8;
      background: #10182a; border: 1px solid #2a4060; border-radius: 6px;
      padding: 8px; margin-bottom: 8px;
    }
    .av-signin-note strong { color: #f4c95d; }
    .av-status-block { }
    .av-signal-box {
      margin: 6px 0 4px; padding: 6px 8px; border: 1px solid #2a4060;
      border-radius: 6px; background: #10182a;
    }
    .av-signal-head {
      display: flex; justify-content: space-between; align-items: baseline;
      gap: 6px; margin-bottom: 4px;
    }
    .av-signal-pair { font-size: 11px; color: #8fa8c8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .av-signal-score { font-size: 11px; font-weight: 700; color: #a78bfa; white-space: nowrap; }
    .av-signal-score.ready { color: #34d399; }
    .av-signal-rules { list-style: none; margin: 0; padding: 0; }
    .av-signal-rules li {
      font-size: 11px; line-height: 1.5; color: #64748b;
      display: flex; align-items: center; gap: 5px;
    }
    .av-signal-rules li.met { color: #cbd5e1; }
    .av-signal-rules li .av-tick { width: 10px; flex-shrink: 0; color: #475569; }
    .av-signal-rules li.met .av-tick { color: #34d399; }
    .av-signal-age { font-size: 10px; color: #475569; margin-top: 4px; }
    .av-status { font-size: 12px; color: #a78bfa; margin-bottom: 4px; }
    .av-status.error { color: #f87171; }
    .av-status.running { color: #34d399; }
    .av-counter { font-size: 11px; color: #64748b; margin-bottom: 2px; }
    .av-limit-msg { text-align: center; font-size: 12px; }
    .av-limit-msg p { color: #fbbf24; margin-bottom: 8px; }
    .av-limit-msg .av-btn { display: block; text-align: center; text-decoration: none; margin-bottom: 6px; }
    #av-auth-section input.av-input { margin-bottom: 6px; }
    #av-login-btn, #av-register-free-btn { width: 100%; margin-bottom: 6px; }
    #av-logged-in { display: flex; justify-content: space-between; align-items: center; }
    .av-section-title {
      font-size: 11px; font-weight: 700; color: #a78bfa; text-transform: uppercase;
      letter-spacing: 0.5px; margin-bottom: 8px;
    }
    .av-payout-row { margin-top: 8px; }
    .av-payout-controls {
      display: inline-flex; align-items: center; justify-content: flex-end;
      gap: 10px; width: 130px;
    }
    .av-payout-action-row { margin-top: -3px; }
    .av-switch {
      position: relative; display: inline-block; width: 36px; height: 20px; flex-shrink: 0;
    }
    .av-switch input { opacity: 0; width: 0; height: 0; }
    .av-switch-slider {
      position: absolute; cursor: pointer; inset: 0; background: #334155;
      transition: 0.2s; border-radius: 999px; border: 1px solid #475569;
    }
    .av-switch-slider:before {
      content: ""; position: absolute; height: 14px; width: 14px; left: 2px; top: 2px;
      background: #e2e8f0; transition: 0.2s; border-radius: 50%;
    }
    .av-switch input:checked + .av-switch-slider {
      background: #7c3aed; border-color: #a78bfa;
    }
    .av-switch input:checked + .av-switch-slider:before { transform: translateX(16px); }
    .av-switch input:disabled + .av-switch-slider { opacity: 0.45; cursor: not-allowed; }
    .av-footer {
      margin-top: 12px; padding-top: 10px; border-top: 1px solid #2d2d5b;
      font-size: 10px; color: #64748b; text-align: center;
    }
    .av-footer a { color: #94a3b8; text-decoration: none; }
    .av-footer a:hover { color: #a78bfa; }
    .av-footer-sep { color: #475569; }
  `;
}
