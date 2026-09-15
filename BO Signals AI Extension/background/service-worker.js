// Persisted history in chrome.storage; source of truth is Supabase
let lastError = null;
let lastFetchAt = null;
let lastConfigOk = false;
let lastFetchOk = false;
async function getHistory() {
  const { history } = await chrome.storage.local.get("history");
  return Array.isArray(history) ? history : [];
}

async function setHistory(arr) {
  await chrome.storage.local.set({ history: arr });
}

async function notifyHistoryUpdated() {
  try {
    chrome.runtime.sendMessage({ type: "HISTORY_UPDATED" });
  } catch (_) {}
}

// Load remote config (Supabase URL/key, etc.)
let cachedConfig = null;
async function loadConfig() {
  if (cachedConfig) return cachedConfig;
  const url = "https://ai-tradebot.com/gptanalys/config.php";
  const resp = await fetch(url);
  if (!resp.ok) {
    lastConfigOk = false;
    lastError = `Config load failed: ${resp.status}`;
    throw new Error(`Config load failed: ${resp.status}`);
  }
  cachedConfig = await resp.json();
  lastConfigOk = true;
  return cachedConfig;
}

function getProjectRefFromSupabaseUrl(supabaseUrl) {
  try {
    const u = new URL(supabaseUrl);
    const host = u.hostname; // e.g. fdovdqrrpnwfexccmlrj.supabase.co
    return host.split(".")[0];
  } catch (_) {
    return "";
  }
}

async function fetchSignalsFromSupabase(limit = 50) {
  const cfg = await loadConfig();
  const supabaseUrl = cfg.supabaseUrl;
  const anonKey = cfg.supabaseAnonKey;
  const url = new URL(`${supabaseUrl}/rest/v1/signals`);
  url.searchParams.set("select", "pair,tf,ts,signal");
  url.searchParams.set("order", "ts.desc");
  url.searchParams.set("limit", String(limit));
  const resp = await fetch(url.toString(), {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
  });
  lastFetchAt = Date.now();
  if (!resp.ok) {
    lastFetchOk = false;
    lastError = `Supabase fetch failed: ${resp.status}`;
    throw new Error(`Supabase fetch failed: ${resp.status}`);
  }
  const rows = await resp.json();
  // Normalize shape if needed
  lastFetchOk = true;
  return Array.isArray(rows) ? rows : [];
}

async function refreshHistory() {
  const remote = await fetchSignalsFromSupabase(100).catch((e) => {
    if (!lastError) lastError = String((e && e.message) || e);
    return null;
  });
  if (remote && remote.length) {
    await setHistory(remote);
    await notifyHistoryUpdated();
    return remote;
  }
  // Fallback: keep existing
  const local = await getHistory();
  return local;
}

async function triggerGeneration() {
  // Prefer Edge Function if available; otherwise just refresh
  try {
    const cfg = await loadConfig();
    const supabaseUrl = cfg.supabaseUrl;
    const anonKey = cfg.supabaseAnonKey;
    const ref = getProjectRefFromSupabaseUrl(supabaseUrl);
    if (ref) {
      const fnUrl = `https://${ref}.functions.supabase.co/generate-signals`;
      await fetch(fnUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${anonKey}`,
        },
        body: JSON.stringify({ reason: "manual_trigger" }),
      }).catch(() => {});
    }
  } catch (_) {}
  // Always refresh after trigger
  return await refreshHistory();
}

// Polling via chrome.alarms
chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.alarms.create("poll-signals", { periodInMinutes: 1 });
  } catch (_) {}
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "poll-signals") {
    void refreshHistory();
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "GET_HISTORY") {
        // Lazy refresh if empty
        let data = await getHistory();
        if (!data.length) data = await refreshHistory();
        sendResponse({ ok: true, data });
      } else if (msg?.type === "GENERATE_NOW") {
        const data = await triggerGeneration();
        sendResponse({ ok: true, data });
      } else if (msg?.type === "GET_STATUS") {
        const history = await getHistory();
        sendResponse({
          ok: true,
          status: {
            lastConfigOk,
            lastFetchOk,
            lastFetchAt,
            lastError,
            historyCount: Array.isArray(history) ? history.length : 0,
          },
        });
      } else if (msg?.type === "CHECK_SCAN_LIMIT") {
        const limit = await checkScanLimit();
        sendResponse({ ok: true, limit });
      } else if (msg?.type === "SCAN_ANALYZE") {
        const { dataUrl } = msg || {};
        if (!dataUrl) return sendResponse({ ok:false, error:"NO_IMAGE" });
        // Check daily limit (10 scans per 24h)
        const limitCheck = await checkScanLimit();
        if (!limitCheck.allowed) {
          return sendResponse({ ok:false, error:"LIMIT_EXCEEDED", remaining: limitCheck.remaining, resetAt: limitCheck.resetAt });
        }
        const apiKey = await getOpenRouterKey();
        if (!apiKey) return sendResponse({ ok:false, error:"NO_API_KEY" });
        // Record usage
        await recordScanUsage();
        const { settings } = await chrome.storage.sync.get("settings");
        // Build OpenRouter Vision prompt
        const payload = {
          model: settings?.model || "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: "You analyze trading chart images. First, identify the trading pair (e.g., BTCUSDT, EURUSD) from the chart labels, title, or visible text. Then predict short-term price direction and optimal timeframe. Output JSON with fields: pair (string, e.g. \"BTCUSDT\"), direction one of [UP, DOWN, SIDE], confidence 0..1, timeframe one of [1m,3m,5m,15m], summary short reasoning."
            },
            {
              role: "user",
              content: [
                { type: "text", text: "Analyze this trading chart. Identify the trading pair from the visible labels/text on the chart. Predict short-term price direction and optimal timeframe to open a binary option trade. Return compact JSON." },
                { type: "image_url", image_url: { url: dataUrl } }
              ]
            }
          ],
          response_format: { type: "json_object" }
        };
        const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
            "HTTP-Referer": "https://bo-signals-ai/",
            "X-Title": "BO Signals AI"
          },
          body: JSON.stringify(payload)
        });
        if (!resp.ok) return sendResponse({ ok:false, error:`OpenRouter ${resp.status}` });
        const json = await resp.json();
        let parsed = null;
        try {
          const txt = json?.choices?.[0]?.message?.content || "{}";
          parsed = typeof txt === 'string' ? JSON.parse(textSafe(txt)) : txt;
        } catch (_) { parsed = null; }
        const data = parsed || { summary: json?.choices?.[0]?.message?.content || "" };
        sendResponse({ ok:true, data });
      } else {
        sendResponse({ ok: false, error: "UNKNOWN_MESSAGE" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String((e && e.message) || e) });
    }
  })();
  return true; // keep the message channel open for async
});

function textSafe(s) {
  try {
    // Some models may wrap JSON in ```json fences; strip them
    if (typeof s !== 'string') return String(s || '');
    return s.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
  } catch (_) {
    return s;
  }
}

async function getOpenRouterKey() {
  // 1) from settings (if kept for dev)
  try {
    const { settings } = await chrome.storage.sync.get("settings");
    if (settings?.openRouterApiKey) return String(settings.openRouterApiKey);
  } catch (_) {}
  // 2) from remote config
  try {
    const cfg = await loadConfig();
    if (cfg?.openRouterApiKey) return String(cfg.openRouterApiKey);
  } catch (_) {}
  // 3) from packaged key.md (temporary dev fallback)
  try {
    const url = chrome.runtime.getURL("key.md");
    const resp = await fetch(url);
    if (resp.ok) {
      const txt = await resp.text();
      // find OpenRouter-like key: sk-...
      const m = txt.match(/\bsk-[a-z0-9-]{20,}\b/gi);
      if (m && m[0]) return m[0];
    }
  } catch (_) {}
  return "";
}

const SCAN_LIMIT = 10;
const SCAN_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

async function checkScanLimit() {
  try {
    const { scanUsages } = await chrome.storage.local.get("scanUsages");
    const now = Date.now();
    const cutoff = now - SCAN_WINDOW_MS;
    const usages = Array.isArray(scanUsages) ? scanUsages.filter(ts => ts > cutoff) : [];
    const remaining = Math.max(0, SCAN_LIMIT - usages.length);
    const resetAt = usages.length > 0 ? Math.min(...usages) + SCAN_WINDOW_MS : now;
    return {
      allowed: usages.length < SCAN_LIMIT,
      remaining,
      resetAt
    };
  } catch (_) {
    return { allowed: true, remaining: SCAN_LIMIT, resetAt: Date.now() };
  }
}

async function recordScanUsage() {
  try {
    const { scanUsages } = await chrome.storage.local.get("scanUsages");
    const now = Date.now();
    const cutoff = now - SCAN_WINDOW_MS;
    const usages = Array.isArray(scanUsages) ? scanUsages.filter(ts => ts > cutoff) : [];
    usages.push(now);
    await chrome.storage.local.set({ scanUsages: usages });
  } catch (_) {}
}
