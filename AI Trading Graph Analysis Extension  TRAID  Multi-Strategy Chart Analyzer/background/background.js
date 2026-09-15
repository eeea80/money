// This should be your Vercel project URL
const VERCEL_URL = 'https://traid-two.vercel.app/';

// Elite trading filter — prepended to every strategy prompt
const ELITE_SYSTEM_PROMPT = `IMAGE CHECK (do this first):
Set "chart_detected": true if the image shows a financial price chart of any kind (forex, stocks, crypto, commodities, indices) with visible price action — even if it is messy, zoomed in, low quality or has no clear setup.
Set "chart_detected": false ONLY if the image is not a price chart at all (a web page, article, email, video, dashboard, blank screen, etc.). When false, set dont_trade: true, Confidence Level: 0, all price fields to "N/A" and explain that a chart screenshot is needed.

You are an elite trading analysis engine. Your PRIMARY RESPONSIBILITY is to protect the user from low-quality setups. You are a professional sniper — less trades, better trades, higher quality.

CORE RULES:
1. Do NOT force a trade. If no clean, high-probability setup exists, set dont_trade: true.
2. Only return a real trade signal when MOST of these are present: clear directional bias, strong market structure alignment, clean reaction from an important zone, confluence between multiple factors, logical stop loss, minimum 1:2 risk-to-reward, entry is not late or overextended.
3. If market is choppy, unclear, overextended, or structure is messy → dont_trade: true
4. If the move is already extended and late → dont_trade: true
5. If risk-to-reward is not attractive or entry would be forced → dont_trade: true
6. BUY/SELL = only if momentum and confirmation justify immediate execution
7. BUY LIMIT/SELL LIMIT = when price is better entered from a retracement into a strong zone

ORDER TYPE FIELD RULES (CRITICAL):
- Use "BUY" for long market entries. Use "SELL" for short market entries.
- Use "BUY LIMIT" for long limit entries. Use "SELL LIMIT" for short limit entries.
- NEVER use "MARKET" as the Order Type. Always specify BUY, SELL, BUY LIMIT, or SELL LIMIT.
- The Take Profit must always be in the correct direction: for BUY/BUY LIMIT the TP must be ABOVE entry; for SELL/SELL LIMIT the TP must be BELOW entry.

RISK MANAGEMENT RULES (CRITICAL — apply to every setup):
- Stop Loss must be placed at a logical structure level (below demand/support for longs, above supply/resistance for shorts). Do NOT place it arbitrarily far away.
- Never risk more than is structurally necessary. Tight, justified stops are always preferred over wide stops.
- Minimum acceptable Risk-to-Reward is 1:2. Do not suggest a trade below this threshold.
- Prefer conservative, achievable targets over ambitious ones. A realistic 1:2 that hits is better than a 1:5 that doesn't.

DONT_TRADE OUTPUT (shown to the user as "TRADE SOON" — a wait signal, not a rejection):
- Set dont_trade: true ONLY when there is NO valid setup of any kind — not a market entry AND not a limit entry. Write a concise 1-line reason in the "reason" field that tells the user WHAT TO WAIT FOR, not just what is wrong (e.g. "Structure is choppy — wait for a clean break and retest of 1.0850 before entering.").
- Set dont_trade: false when ANY valid setup exists — including BUY LIMIT or SELL LIMIT. A limit order IS a valid trade signal; price just has not reached the zone yet.
- When dont_trade: true, still populate all other fields as best as possible.

`;


// ===== FREE TRIAL =====
// Scan 1  : free, no email asked, and Multi-Strategy is unlocked — this is the "wow" scan.
// Scan 2-3: unlocked by leaving an email in-panel (asked AFTER they've seen value, not before).
// After   : personalised paywall built from their own scan history.
// Demo scans on the bundled example chart never count and never need an email.
const FREE_SCAN_LIMIT = 3;
const TRIAL_ENDED_ERROR = 'Your free scans are used up. Unlock Traid to keep scanning the markets.';
const MAX_SCAN_HISTORY = 10;

function getTrialData() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['freeScansUsed', 'trialEmail'], (data) => {
      resolve({ used: data.freeScansUsed || 0, email: data.trialEmail || null });
    });
  });
}

function getFreeScansUsed() {
  return getTrialData().then(trial => trial.used);
}

function hasValidLicense() {
  return new Promise((resolve) => {
    chrome.storage.local.get('licenseExpiry', (data) => {
      resolve(!!data.licenseExpiry && new Date(data.licenseExpiry) > new Date());
    });
  });
}

// Single source of truth for what the user is currently allowed to do
async function getTrialStatus() {
  const licensed = await hasValidLicense();
  const { used, email } = await getTrialData();
  const scansLeft = Math.max(0, FREE_SCAN_LIMIT - used);
  return {
    licensed,
    scansUsed: used,
    scansLeft,
    limit: FREE_SCAN_LIMIT,
    hasEmail: !!email,
    // The first scan costs nothing — we only ask for the email once they've seen a result
    needsEmail: !licensed && used >= 1 && !email && scansLeft > 0,
    multiUnlocked: licensed || used === 0,
    canScan: licensed || (scansLeft > 0 && (used === 0 || !!email))
  };
}

// Demo scans pass in a bundled example chart; real scans grab the visible tab
function captureChart(imageData, callback) {
  if (imageData) {
    callback(imageData, null);
    return;
  }
  chrome.tabs.captureVisibleTab(null, { format: 'jpeg' }, (dataUrl) => {
    if (chrome.runtime.lastError) {
      callback(null, chrome.runtime.lastError.message);
      return;
    }
    callback(dataUrl, null);
  });
}

async function canScan(isDemo) {
  if (isDemo) return { allowed: true, isTrial: false, isDemo: true };
  const status = await getTrialStatus();
  if (status.licensed) return { allowed: true, isTrial: false, status };
  if (status.scansLeft <= 0) return { allowed: false, reason: 'trial_ended', status };
  if (status.needsEmail) return { allowed: false, reason: 'email_required', status };
  return { allowed: true, isTrial: true, status };
}

// Read an AI response into two independent facts:
//   chartDetected - did we actually analyse a chart? Only this decides whether a scan is billed.
//   signal        - usable entry/stop/target levels, if any (used for the paywall's risk maths).
// A valid chart that says "TRADE SOON" is still a delivered analysis and MUST cost a scan;
// only a genuine non-chart image is free. Missing field => treat as a chart (never give away scans).
function readAnalysis(analysisText, isMulti) {
  try {
    const parsed = JSON.parse(analysisText);
    const rec = isMulti ? parsed['Final Recommendation'] : parsed;
    const chartDetected = parsed.chart_detected !== false;
    if (!rec) return { chartDetected: chartDetected, signal: null };

    const confidence = rec['Confidence Level'];
    const entry = rec['Entry Point'];
    const stop = rec['Stop Loss'];
    const profit = rec['Take Profit'];
    const missing = (v) => !v || String(v).trim().toUpperCase() === 'N/A';

    // No usable levels — still a real scan, just nothing to plot on the paywall
    if (!confidence || confidence <= 0) return { chartDetected: chartDetected, signal: null };
    if (missing(entry) || missing(stop) || missing(profit)) return { chartDetected: chartDetected, signal: null };

    return {
      chartDetected: chartDetected,
      signal: {
        coin: rec['Coin Name'] || 'Unknown',
        orderType: rec['Order Type'] || '',
        entry: entry,
        stop: stop,
        profit: profit,
        confidence: confidence,
        longScore: isMulti ? (parsed['Long Score'] || 0) : null,
        shortScore: isMulti ? (parsed['Short Score'] || 0) : null,
        strategyCount: isMulti && Array.isArray(parsed.strategies) ? parsed.strategies.length : null,
        ts: Date.now()
      }
    };
  } catch (e) {
    // Unparseable response: bill it as a chart scan rather than hand out free usage
    return { chartDetected: true, signal: null };
  }
}

// Record a scan that actually produced a signal: burn a free scan and remember it
// so the paywall can talk about the user's own trades instead of generic copy.
function noteSuccessfulScan(scan, analysisText, isMulti) {
  const { chartDetected, signal } = readAnalysis(analysisText, isMulti);
  // Only a genuine non-chart image is free of charge
  if (!chartDetected) return Promise.resolve(null);

  return new Promise((resolve) => {
    const burnScan = () => {
      if (!scan.isTrial) return resolve(signal);
      getFreeScansUsed().then((used) => {
        chrome.storage.sync.set({ freeScansUsed: used + 1 }, () => resolve(signal));
      });
    };

    // A chart with no tradeable levels still counts — there's just nothing to record
    if (!signal) return burnScan();

    chrome.storage.local.get(['scanHistory', 'firstMultiResult'], (data) => {
      const history = Array.isArray(data.scanHistory) ? data.scanHistory : [];
      history.unshift(signal);
      const trimmed = history.slice(0, MAX_SCAN_HISTORY);

      const toStore = { scanHistory: trimmed };
      // Keep the first multi-strategy consensus — it powers the Pro upsell later
      if (isMulti && signal.longScore !== null && !data.firstMultiResult) {
        toStore.firstMultiResult = {
          coin: signal.coin,
          longScore: signal.longScore,
          shortScore: signal.shortScore,
          strategyCount: signal.strategyCount
        };
      }

      chrome.storage.local.set(toStore, burnScan);
    });
  });
}

// Helper to get API key - Always use vercelgemini backend API key
async function getApiKey() {
  try {
    const response = await fetch('https://inventabot-proxy-backend.vercel.app/api/get-trial-key', {
      method: 'GET',
      credentials: 'include'
    });

    if (!response.ok) {
      throw new Error('Failed to get API key from backend');
    }

    const data = await response.json();
    if (!data.success || !data.apiKey) {
      throw new Error('No API key available');
    }

    return data.apiKey;
  } catch (e) {
    throw new Error('Failed to access API service. Please try again.');
  }
}

// Generate unique installation ID
function generateUniqueInstallationId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  return `traid_${timestamp}_${random}`;
}

// Get or create unique installation ID with migration from local to sync storage
async function getUniqueInstallationId() {
  return new Promise((resolve) => {
    // First check chrome.storage.sync (new persistent location)
    chrome.storage.sync.get('uniqueInstallationId', (syncData) => {
      if (syncData.uniqueInstallationId) {
        console.log('Found existing ID in sync storage:', syncData.uniqueInstallationId);
        resolve(syncData.uniqueInstallationId);
        return;
      }

      // If not in sync, check chrome.storage.local (old location)
      chrome.storage.local.get('uniqueInstallationId', (localData) => {
        if (localData.uniqueInstallationId) {
          console.log('Migrating existing ID from local to sync storage:', localData.uniqueInstallationId);
          // Migrate from local to sync storage
          chrome.storage.sync.set({ uniqueInstallationId: localData.uniqueInstallationId }, () => {
            // Optional: Clean up local storage after successful migration
            chrome.storage.local.remove('uniqueInstallationId');
            resolve(localData.uniqueInstallationId);
          });
        } else {
          // Generate new ID for new users
          const newId = generateUniqueInstallationId();
          chrome.storage.sync.set({ uniqueInstallationId: newId }, () => {
            console.log('Generated new unique installation ID in sync storage:', newId);
            resolve(newId);
          });
        }
      });
    });
  });
}

async function checkLicense() {
  const extensionId = await getUniqueInstallationId();
  fetch(`${VERCEL_URL}/api/check-license?extensionId=${extensionId}`)
    .then(response => response.json())
    .then(data => {
      console.log('API Response in checkLicense():', data);
      if (data.status === 'valid') {
        chrome.storage.local.set({ licenseExpiry: data.expiry });
        chrome.sidePanel.setOptions({ path: 'popup/popup.html', enabled: true });
      } else {
        // No valid license — let the user in while free trial scans remain
        getFreeScansUsed().then(used => {
          const path = used < FREE_SCAN_LIMIT ? 'popup/popup.html' : 'popup/auth.html';
          chrome.sidePanel.setOptions({ path: path, enabled: true });
        });
      }
    })
    .catch(error => {
      console.error('Error checking license:', error);
      // Offline/network error — still honor remaining free scans
      getFreeScansUsed().then(used => {
        const path = used < FREE_SCAN_LIMIT ? 'popup/popup.html' : 'popup/auth.html';
        chrome.sidePanel.setOptions({ path: path, enabled: true });
      });
    });
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('Traid: Multi-Strategy Trading AI Chart Analyzer installed.');
  checkLicense();
  chrome.alarms.create('licenseCheck', { periodInMinutes: 4320 }); // 3 days
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'licenseCheck') {
    checkLicense();
  }
});

// Open the side panel when the toolbar icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Load strategies at the beginning
let strategies = {};
fetch(chrome.runtime.getURL('strategies/trading-strategies.json'))
  .then(response => response.json())
  .then(data => {
    strategies = data.strategies;
  })
  .catch(error => {
    console.error('Error loading strategies:', error);
  });

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Background script received message:", request);
  if (request.action === 'analyze') {
    canScan(request.isDemo).then(scan => {
    if (!scan.allowed) {
      sendResponse({
        error: scan.reason === 'email_required' ? 'Email required to continue.' : TRIAL_ENDED_ERROR,
        trialEnded: scan.reason === 'trial_ended',
        emailRequired: scan.reason === 'email_required',
        trial: scan.status
      });
      return;
    }
    // Use getApiKey helper - always uses vercelgemini backend
    getApiKey().then(apiKey => {
      // Demo scans analyse the bundled example chart instead of the user's tab
      captureChart(request.imageData, (dataUrl, captureError) => {
        if (captureError) {
          sendResponse({ error: captureError });
          return;
        }

        // Get the selected strategy or default to wyckoff
        const selectedStrategy = request.strategy || 'wyckoff';
        const timeframe = request.timeframe || 'Scalp';

        let timeframeInstruction = "";
        if (timeframe === 'Swing') {
          timeframeInstruction = "\n\nCRITICAL TIMEFRAME: Optimize for 'Swing' trading. Focus on higher timeframe support/resistance and market structure shifts over days/weeks. RISK PARAMETERS: Stop Loss must sit just beyond the nearest significant structure level — keep it tight relative to the move, ideally no more than 1.5-2% from entry. Target Take Profit at a realistic 1:2 to 1:3 R:R based on the next major structure zone. Do not chase extended moves.";
        } else if (timeframe === 'Intraday') {
          timeframeInstruction = "\n\nCRITICAL TIMEFRAME: Optimize for 'Intraday' trading. Focus on session liquidity, daily volume profiles, and capturing moves within a single trading session (15m to 1H charts). RISK PARAMETERS: Stop Loss must be placed just beyond the nearest intraday structure level — no more than 0.5-0.8% from entry. Target a clean 1:2 R:R within the same session. Do not set targets beyond that session's realistic range.";
        } else if (timeframe === 'Scalp') {
          timeframeInstruction = "\n\nCRITICAL TIMEFRAME: Optimize for 'Scalp' trading. Focus on lower timeframes (1m, 3m, 5m), immediate order block reactions, and quick momentum bursts. RISK PARAMETERS: Stop Loss must be very tight — no more than 0.2-0.3% from entry, placed just below/above the nearest micro-structure. Target a quick 1:1.5 to 1:2 R:R. Small, fast, clean — never hold through chop.";
        }

        const strategyPrompt = ELITE_SYSTEM_PROMPT + (strategies[selectedStrategy]?.prompt || strategies['wyckoff'].prompt) + timeframeInstruction;

        fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: strategyPrompt
                  },
                  {
                    inline_data: {
                      mime_type: "image/jpeg",
                      data: dataUrl.split(',')[1]
                    }
                  }
                ]
              }
            ],
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: {
                type: "object",
                properties: {
                  "chart_detected": { "type": "boolean" },
                  "dont_trade": { "type": "boolean" },
                  "reason": { "type": "string" },
                  "Coin Name": { "type": "string" },
                  "Order Type": { "type": "string" },
                  "Entry Point": { "type": "string" },
                  "Stop Loss": { "type": "string" },
                  "Take Profit": { "type": "string" },
                  "Confidence Level": { "type": "integer" },
                  "Explanation": { "type": "string" }
                },
                required: ["chart_detected", "dont_trade", "reason", "Coin Name", "Order Type", "Entry Point", "Stop Loss", "Take Profit", "Confidence Level", "Explanation"]
              }
            }
          })
        })
          .then(response => response.json())
          .then(data => {
            if (data.candidates && data.candidates.length > 0) {
              const analysis = data.candidates[0].content.parts[0].text;
              // Only a scan that produced a real signal costs the user a free scan
              if (scan.isDemo) {
                sendResponse({ analysis: analysis, isDemo: true });
                return;
              }
              noteSuccessfulScan(scan, analysis, false).then(() => {
                getTrialStatus().then(trial => {
                  sendResponse({ analysis: analysis, trial: trial });
                });
              });
            } else {
              const errorMessage = data.error ? data.error.message : 'Unable to analyze the image.';
              // Check if error message contains HTML
              const containsHTML = /<[^>]*>/g.test(errorMessage);
              sendResponse({
                error: errorMessage,
                isHTML: containsHTML
              });
            }
          })
          .catch(error => {
            // Check if error message contains HTML
            const containsHTML = /<[^>]*>/g.test(error.message);
            sendResponse({
              error: error.message,
              isHTML: containsHTML
            });
          });
      });
    }).catch(error => {
      // Handle error from getApiKey (trial expired, etc.)
      console.log('getApiKey error:', error.message);
      sendResponse({ error: error.message });
      return; // Exit early, don't continue
    });
    });
    return true; // Indicates that the response is sent asynchronously
  } else if (request.action === 'getTrialStatus') {
    getTrialStatus().then(status => sendResponse(status));
    return true;
  } else if (request.action === 'saveTrialEmail') {
    const email = (request.email || '').trim();
    if (!email || !email.includes('@')) {
      sendResponse({ success: false, error: 'Please enter a valid email address.' });
      return true;
    }
    // Store locally so the checkout link is pre-filled, and register the auth code
    // with the proxy backend so the lead survives a reinstall.
    chrome.storage.sync.set({ trialEmail: email }, () => {
      chrome.storage.local.set({ email: email }, async () => {
        try {
          const authCode = await getUniqueInstallationId();
          await fetch('https://inventabot-proxy-backend.vercel.app/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ authCode: authCode })
          });
        } catch (e) {
          console.log('Could not register trial email with backend:', e.message);
        }
        const status = await getTrialStatus();
        sendResponse({ success: true, trial: status });
      });
    });
    return true;
  } else if (request.action === 'checkLicense') {
    getUniqueInstallationId().then(extensionId => {
      fetch(`${VERCEL_URL}/api/check-license?extensionId=${extensionId}`)
        .then(response => response.json())
        .then(data => {
          console.log('API Response in onMessage checkLicense:', data);
          if (data.status === 'valid') {
            chrome.storage.local.set({ licenseExpiry: data.expiry });
            chrome.sidePanel.setOptions({ path: 'popup/popup.html', enabled: true });
            sendResponse({ success: true, status: 'valid' });
          } else {
            // No valid license — allow trial access while free scans remain
            getFreeScansUsed().then(used => {
              if (used < FREE_SCAN_LIMIT) {
                chrome.sidePanel.setOptions({ path: 'popup/popup.html', enabled: true });
                sendResponse({ success: true, status: 'trial', freeScansLeft: FREE_SCAN_LIMIT - used });
              } else {
                chrome.sidePanel.setOptions({ path: 'popup/auth.html', enabled: true });
                sendResponse({ success: false, status: data.status });
              }
            });
          }
        })
        .catch(error => {
          console.error('Error checking license:', error);
          chrome.sidePanel.setOptions({ path: 'popup/auth.html', enabled: true });
          sendResponse({ success: false, status: 'error' });
        });
    });
    return true;
  } else if (request.action === 'analyzeMultiStrategy') {
    const { selectedStrategies, timeframe } = request;

    let timeframeInstruction = "";
    if (timeframe === 'Swing') {
      timeframeInstruction = "\n\nCRITICAL TIMEFRAME: Optimize for 'Swing' trading. Focus on higher timeframe support/resistance, market structure shifts over days/weeks, and capture larger price movements. Ignore minor intraday noise.";
    } else if (timeframe === 'Intraday') {
      timeframeInstruction = "\n\nCRITICAL TIMEFRAME: Optimize for 'Intraday' trading. Focus on daily volume profiles, session liquidity, and capturing moves within a single trading session (15m to 1H charts).";
    } else if (timeframe === 'Scalp') {
      timeframeInstruction = "\n\nCRITICAL TIMEFRAME: Optimize for 'Scalp' trading. Focus strictly on lower timeframes (1m, 3m, 5m), immediate order block reactions, quick momentum bursts, and tight stop losses to capture small fast price movements.";
    }

    canScan(request.isDemo).then(scan => {
    if (!scan.allowed) {
      sendResponse({
        error: scan.reason === 'email_required' ? 'Email required to continue.' : TRIAL_ENDED_ERROR,
        trialEnded: scan.reason === 'trial_ended',
        emailRequired: scan.reason === 'email_required',
        trial: scan.status
      });
      return;
    }
    // Multi-Strategy is the free first scan or a licensed feature — never a paid-tier leak
    if (!scan.isDemo && scan.status && !scan.status.multiUnlocked) {
      sendResponse({ error: 'Multi-Strategy is a Pro feature.', multiLocked: true, trial: scan.status });
      return;
    }
    // Use getApiKey helper - always uses vercelgemini backend
    getApiKey().then(apiKey => {
      captureChart(request.imageData, (dataUrl, captureError) => {
        if (captureError) {
          sendResponse({ error: captureError });
          return;
        }

        // Build consolidated prompt with all selected strategies
        const consolidatedPrompt = `${ELITE_SYSTEM_PROMPT}You are an expert trading analyst. ${timeframeInstruction}

IMPORTANT: First, verify that the provided image contains a valid trading chart (any financial market: forex, stocks, crypto, commodities, etc.) with visible price action. Set "chart_detected": true whenever a price chart is visible — even a messy one with no clear setup. Set "chart_detected": false ONLY if the image is not a price chart at all; in that case return 0 confidence for all strategies and explain that a valid trading chart screenshot is required.

Only if a valid trading chart is visible, proceed to analyze it using ALL of the following strategies simultaneously:

${selectedStrategies.map((strategy, i) => `
═══════════════════════════════════════
STRATEGY ${i + 1}: ${strategy.name}
═══════════════════════════════════════
${strategy.prompt}
`).join('\n')}

After analyzing with each strategy individually, you must:

1. For EACH strategy listed above, provide a complete individual analysis with:
   - Coin Name
   - Order Type (MARKET or LIMIT)
   - Entry Point
   - Stop Loss
   - Take Profit
   - Confidence Level (1-5)
   - Explanation (2-3 sentences specific to that strategy's analysis)

2. Count how many strategies suggest LONG vs SHORT positions

3. Provide a FINAL CONSOLIDATED RECOMMENDATION that considers all strategies:
   - dont_trade: true if NO valid high-probability setup exists, OR if strategies are contradicting each other (roughly 50/50 or 60/40 split between LONG and SHORT — too much disagreement to trust). Set dont_trade: false only when there is clear confluence.
   - reason: a concise 1-line explanation of why not to trade (only relevant when dont_trade is true, e.g. "Too much contradiction between strategies — signals are split with no clear directional consensus.")
   - Unified Coin Name
   - Final Order Type
   - Consolidated Entry Point
   - Safe Stop Loss considering all strategies
   - Profitable Take Profit target
   - Overall Confidence Level (1-5)
   - Recommendation (1-2 sentences summarizing the final trading advice)
   - Explanation (2 paragraphs explaining your conclusion, mentioning which strategies agreed/conflicted)

Your response MUST include all individual strategy results AND the final consolidated recommendation.`;

        fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: consolidatedPrompt
                  },
                  {
                    inline_data: {
                      mime_type: "image/jpeg",
                      data: dataUrl.split(',')[1]
                    }
                  }
                ]
              }
            ],
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: {
                type: "object",
                properties: {
                  "chart_detected": { "type": "boolean" },
                  "strategies": {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        "Strategy Name": { "type": "string" },
                        "Coin Name": { "type": "string" },
                        "Order Type": { "type": "string" },
                        "Entry Point": { "type": "string" },
                        "Stop Loss": { "type": "string" },
                        "Take Profit": { "type": "string" },
                        "Confidence Level": { "type": "integer" },
                        "Explanation": { "type": "string" }
                      },
                      required: ["Strategy Name", "Coin Name", "Order Type", "Entry Point", "Stop Loss", "Take Profit", "Confidence Level", "Explanation"]
                    }
                  },
                  "Long Score": { "type": "integer" },
                  "Short Score": { "type": "integer" },
                  "Final Recommendation": {
                    type: "object",
                    properties: {
                      "dont_trade": { "type": "boolean" },
                      "reason": { "type": "string" },
                      "Coin Name": { "type": "string" },
                      "Order Type": { "type": "string" },
                      "Entry Point": { "type": "string" },
                      "Stop Loss": { "type": "string" },
                      "Take Profit": { "type": "string" },
                      "Confidence Level": { "type": "integer" },
                      "Recommendation": { "type": "string" },
                      "Explanation": { "type": "string" }
                    },
                    required: ["dont_trade", "reason", "Coin Name", "Order Type", "Entry Point", "Stop Loss", "Take Profit", "Confidence Level", "Recommendation", "Explanation"]
                  }
                },
                required: ["chart_detected", "strategies", "Long Score", "Short Score", "Final Recommendation"]
              }
            }
          })
        })
          .then(response => response.json())
          .then(data => {
            if (data.candidates && data.candidates.length > 0) {
              const analysis = data.candidates[0].content.parts[0].text;
              if (scan.isDemo) {
                sendResponse({ analysis: analysis, isDemo: true });
                return;
              }
              noteSuccessfulScan(scan, analysis, true).then(() => {
                getTrialStatus().then(trial => {
                  sendResponse({ analysis: analysis, trial: trial });
                });
              });
            } else {
              const errorMessage = data.error ? data.error.message : 'Unable to analyze the image.';
              const containsHTML = /<[^>]*>/g.test(errorMessage);
              sendResponse({
                error: errorMessage,
                isHTML: containsHTML
              });
            }
          })
          .catch(error => {
            const containsHTML = /<[^>]*>/g.test(error.message);
            sendResponse({
              error: error.message,
              isHTML: containsHTML
            });
          });
      });
    }).catch(error => {
      console.log('getApiKey error:', error.message);
      sendResponse({ error: error.message });
    });
    });
    return true;
  }
});
