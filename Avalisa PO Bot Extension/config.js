/**
 * Avalisa PO Bot v2 - Shared configuration
 * Loaded before content.js by manifest order.
 */

const API_BASE = 'https://avalisa-backend.onrender.com';
// Single source of truth. PocketPartners supplies ac, cid, and al campaign
// parameters; changing them without its dashboard breaks revenue tracking silently.
const AFFILIATE_LINK = 'https://u3.shortink.io/register?utm_campaign=36377&utm_source=affiliate&utm_medium=sr&a=h00sp8e1L95KmS&al=1272290&ac=april2024&cid=845788&code=WELCOME50';
const DASHBOARD_URL = 'https://avalisabot.vercel.app';

const TF_TO_SECONDS = { S30: 30, M1: 60, M3: 180, M5: 300, M30: 1800, H1: 3600 };
const SECONDS_TO_TF = Object.fromEntries(Object.entries(TF_TO_SECONDS).map(([tf, sec]) => [sec, tf]));
const AI_SCAN_MAX_FAVORITES = 6;

const PO_SELECTORS = {
  balance: {
    demo: ['.js-balance-demo', '.js-hd.js-balance-demo', '[class*="balance-demo"]', '.balance__value', '.header-balance'],
    real: ['.js-balance-real-USD', '.js-balance-real', '.js-hd.js-balance-real', '[class*="balance-real"]', '.balance__value', '.header-balance'],
  },
  tradeAmount: [
    '.block--bet-amount .value__val input',
    '.value__val input',
    'input[data-testid="trade-amount"]',
    '.trade-amount input',
    'input[name="amount"]',
  ],
  durationBlock: '.block--expiration-inputs',
  durationToggle: [
    '.block--expiration-inputs a',
    '.block--expiration-inputs .block__icon',
    '.block--expiration-inputs [class*="icon"]',
    '.block--expiration-inputs [class*="switch"]',
    '.block--expiration-inputs [class*="toggle"]',
    '.block--expiration-inputs button',
  ],
  durationValue: '.block--expiration-inputs .value__val',
  // Opens the DURATION picker (S3/S15/S30/M1/...) without changing panel mode.
  // Verified live 2026-08-17: '.block--expiration-inputs a' is the MODE TOGGLE,
  // not a picker opener — clicking it flips the panel into absolute-time mode,
  // where the list becomes "+S30"/"+M1" ("add 30s to the expiry clock"). Using
  // it to open the picker is what made the bot pick wrong or no expiry.
  // '.value' opens the list and leaves the mode alone. '.value__val' TOGGLES it
  // shut, so it must come last.
  durationTrigger: '.block--expiration-inputs .value, .block--expiration-inputs .control__value, .block--expiration-inputs .value__val',
  timeframeItems: '.dops__timeframes-item',
  closePopoverTarget: '.chart-container, .trading-chart, main, body',
  tradeButtons: {
    call: [
      'a.btn.btn-call',
      'button.btn.btn-call',
      '.trade-action--call',
      '.call-action',
      '[data-test="btn-call"]',
      '[data-action="call"]',
      '[class*="btn-call"]',
      '[class*="call-btn"]',
      'button[data-direction="call"]',
      'a[data-direction="call"]',
    ],
    put: [
      'a.btn.btn-put',
      'button.btn.btn-put',
      '.trade-action--put',
      '.put-action',
      '[data-test="btn-put"]',
      '[data-action="put"]',
      '[class*="btn-put"]',
      '[class*="put-btn"]',
      'button[data-direction="put"]',
      'a[data-direction="put"]',
    ],
  },
  deals: [
    '.deal',
    '.deals-list__item',
    '.active-trade',
    '[class*="deal-timer"]',
    '[class*="deals-list"] [class*="item"]',
    '.trade-result',
  ],
  payoutDirect: [
    '.asset-select .asset__profit',
    '.current-symbol__profit',
    '.block--payout .value__val',
    '.block--profit .value__val',
    '.estimated-profit__val',
    '.profit-value',
    '[class*="payout"] .value__val',
    '[class*="profit"] .value__val',
  ],
  payoutHeader: '.asset-select, .current-symbol, .assets-block, .header__asset',
  favoriteContainers: [
    '.assets-favorites-list__item',
    '.favorite-list__item',
    '.pair-favorites__item',
    '.assets-block .favorites-list__item',
    '[class*="favorit"] [class*="item"]',
  ],
  favoriteName: '.assets-favorites-list__label, .asset__name, .pair-name, [class*="label"], [class*="name"]',
  activeAccountLabels: '[class*="balance-info-block"] [class*="label"], [class*="balance__label"]',
  currentPair: ['.asset-select .asset__name', '.current-symbol', '[class*="asset-name"]'],
};
