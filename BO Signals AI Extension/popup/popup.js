const list = document.getElementById("list");
const statusEl = document.getElementById("status");
const refreshBtn = document.getElementById("refresh");
const chips = document.getElementById("chips");
const ding = document.getElementById("ding");
let audioCtx;
let audioUnlocked = false;

function unlockAudioOnce() {
  if (audioUnlocked) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx?.state === "suspended") {
      void audioCtx.resume();
    }
    audioUnlocked = true;
  } catch (_) {}
}

function playBeep() {
  try {
    if (!audioCtx)
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") {
      // Must be resumed by user gesture; will be no-op until unlocked
      return;
    }
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.15, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.21);
  } catch (_) {}
}
const modal = document.getElementById("modal");
const mTitle = document.getElementById("m-title");
const mContent = document.getElementById("m-content");
const mClose = document.getElementById("m-close");
let currentFilter = "ALL";
let lastHistory = [];
let currentTimeZone = "auto";
let activeSignalTimer = null;
let activeSignalInterval = null;

function toMs(ts) {
  try {
    if (ts == null) return 0;
    if (typeof ts === "number") {
      return ts < 1e12 ? Math.round(ts * 1000) : Math.round(ts);
    }
    if (typeof ts === "string") {
      const num = ts.trim();
      if (/^\d+(\.\d+)?$/.test(num)) {
        const n = parseFloat(num);
        return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
      }
    }
    const t = Date.parse(ts);
    return Number.isFinite(t) ? t : 0;
  } catch (_) {
    return 0;
  }
}

// Side panel open helper
async function openSidePanel() {
  try {
    if (!chrome?.sidePanel) throw new Error("no_sidepanel_api");
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const tabId = tab?.id;
    const path = "popup/index.html";
    try {
      await chrome.sidePanel.setOptions(
        tabId ? { tabId, path, enabled: true } : { path, enabled: true }
      );
    } catch (_) {}
    try {
      if (tabId) await chrome.sidePanel.open({ tabId });
      else await chrome.sidePanel.open({});
    } catch (_) {
      // Some Chrome versions require windowId
      const win = await chrome.windows.getCurrent();
      await chrome.sidePanel.open({ windowId: win.id });
    }
    window.close();
  } catch (_) {
    // Fallback: open our UI in a new tab
    try {
      const url = chrome.runtime.getURL("popup/index.html");
      window.open(url, '_blank');
      window.close();
    } catch (_) {}
  }
}

async function load() {
  const { settings } = await chrome.storage.sync.get("settings");
  currentTimeZone = (settings && settings.timezone) || "auto";
  lastHistory = await send({ type: "GET_HISTORY" }).then((r) => r.data || []);
  await render();
}

async function render() {
  list.innerHTML = "";
  if (statusEl) statusEl.classList.add("hidden");
  if (activeSignalTimer) {
    clearTimeout(activeSignalTimer);
    activeSignalTimer = null;
  }
  if (activeSignalInterval) {
    clearInterval(activeSignalInterval);
    activeSignalInterval = null;
  }
  const { lastNotifiedTs, liveUntilMs } = await chrome.storage.local.get([
    "lastNotifiedTs",
    "liveUntilMs",
  ]);
  const history = filterHistory(lastHistory, currentFilter);
  if (!history.length) {
    // Render status diagnostics when no data
    void renderStatus();
    // Demo cards when no history yet
    const demo = [
      {
        ts: Date.now(),
        pair: "BTCUSDT",
        tf: "1m",
        signal: {
          action: "BUY_CALL",
          confidence: 0.82,
          reasoning: "Отскок от поддержки",
          expiry_minutes: 1,
        },
      },
      {
        ts: Date.now(),
        pair: "ETHUSDT",
        tf: "1m",
        signal: {
          action: "BUY_PUT",
          confidence: 0.76,
          reasoning: "Локальная перекупленность",
          expiry_minutes: 3,
        },
      },
      {
        ts: Date.now(),
        pair: "SOLUSDT",
        tf: "1m",
        signal: {
          action: "WAIT",
          confidence: 0.5,
          reasoning: "Нет сигнала",
          expiry_minutes: 1,
        },
      },
    ];
    demo.forEach((entry) => {
      const li = document.createElement("li");
      li.className = "item";
      const action = (entry.signal?.action || "WAIT").toUpperCase();
      const cls =
        action === "BUY_CALL" ? "call" : action === "BUY_PUT" ? "put" : "";
      li.innerHTML = `
        <div class="row between">
          <div>
            <div class="pair">${formatTime(entry.ts)} • ${entry.pair} • ${
        entry.tf
      }</div>
            <div class="action ${cls}">${action} · ${Math.round(
        (entry.signal?.confidence || 0) * 100
      )}%<span class="badge">${entry.signal?.expiry_minutes || 1}m</span></div>
          </div>
          <div class="reason">${entry.signal?.reasoning || ""}</div>
        </div>
      `;
      li.addEventListener("click", (e) => openModal(entry, e));
      list.appendChild(li);
    });
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent =
      "Это тестовые плашки. Нажмите Обновить для реальных сигналов.";
    list.appendChild(li);
    return;
  }
  history.slice(0, 20).forEach((entry, idx) => {
    const li = document.createElement("li");
    let liClass = "item" + (idx === 0 ? " new" : "");
    const actRaw = (entry.signal?.action || "WAIT").toUpperCase();
    const display = actRaw.replace(/^BUY_/, "");
    const cls =
      actRaw === "BUY_CALL" ? "call" : actRaw === "BUY_PUT" ? "put" : "";
    // mark top signal as active for 15s after last notification
    let liveBadge = "";
    if (
      idx === 0 &&
      Math.abs(toMs(entry.ts) - Number(lastNotifiedTs || 0)) <= 1000
    ) {
      let remaining = 0;
      if (Number(liveUntilMs)) {
        remaining = Math.max(0, Number(liveUntilMs) - Date.now());
      } else {
        remaining = 15000 - (Date.now() - Number(lastNotifiedTs || 0));
      }
      if (remaining > 0) {
        liClass += " active";
        const secs = Math.ceil(remaining / 1000);
        liveBadge =
          '<span class="badge">LIVE</span> <span class="badge live-timer">' +
          secs +
          "s</span>";
        activeSignalTimer = setTimeout(() => {
          // re-render to drop the LIVE state
          void render();
        }, remaining + 50);
        li.dataset.liveRemaining = String(remaining);
        li.dataset.liveUntil = String(Date.now() + remaining);
      }
    }
    li.className = liClass;
    const isActionable = actRaw === "BUY_CALL" || actRaw === "BUY_PUT";
    const tradeBtn = isActionable ? '<button class="trade-quick-btn" data-action="trade" title="Open trading platform">Trade</button>' : '';
    li.innerHTML = `
			<div class="row between">
				<div>
					<div class="pair">${formatTime(entry.ts)} • ${entry.pair} • ${
      entry.tf
    } ${liveBadge}</div>
					<div class="action ${cls}">${display} · ${Math.round(
      (entry.signal?.confidence || 0) * 100
    )}%<span class="badge">${entry.signal?.expiry_minutes || 1}m</span></div>
				</div>
				<div class="reason">${entry.signal?.reasoning || ""}</div>
			</div>
			${tradeBtn}
		`;
    if (liClass.includes(" active")) {
      const bar = document.createElement("div");
      bar.className = "live-progress";
      const dur = Number(li.dataset.liveRemaining || 15000);
      bar.style.animationDuration = `${dur}ms`;
      li.appendChild(bar);
      const timerEl = li.querySelector(".live-timer");
      const until = Number(li.dataset.liveUntil || 0);
      if (timerEl && until > 0) {
        const updateTimer = () => {
          const left = Math.max(0, until - Date.now());
          const secs = Math.ceil(left / 1000);
          timerEl.textContent = `${secs}s`;
          if (left <= 0) {
            clearInterval(activeSignalInterval);
            activeSignalInterval = null;
          }
        };
        updateTimer();
        activeSignalInterval = setInterval(updateTimer, 250);
      }
    }
    li.addEventListener("click", (e) => {
      // Don't open modal if clicking the trade button
      if (e.target?.classList?.contains("trade-quick-btn")) {
        e.stopPropagation();
        openModal(entry);
        return;
      }
      openModal(entry);
    });
    list.appendChild(li);
  });
  // sound only for a NEW actionable update (respect settings)
  try {
    if (history.length) {
      const top = history[0];
      const act = (top?.signal?.action || "").toUpperCase();
      const actionable =
        act === "BUY_CALL" ||
        act === "BUY_PUT" ||
        act === "CALL" ||
        act === "PUT";
      const { lastNotifiedTs } = await chrome.storage.local.get(
        "lastNotifiedTs"
      );
      const isNew = toMs(top?.ts) > Number(lastNotifiedTs || 0);
      if (actionable && isNew) {
        const { settings } = await chrome.storage.sync.get("settings");
        if (settings?.soundEnabled !== false) {
          const choice = settings?.soundChoice || "beep1";
          if (choice === "ding" && ding && typeof ding.play === "function") {
            await ding.play().catch(() => {});
          } else if (choice === "bim") {
            try { await new Audio("../audio/bim.mp3").play(); } catch (_) { playBeep(); }
          } else {
            playBeep();
          }
        }
        await chrome.storage.local.set({
          lastNotifiedTs: toMs(top?.ts) || Date.now(),
          liveUntilMs: Date.now() + 15000,
        });
        // Trigger re-render so LIVE badge/progress appear immediately for this signal
        setTimeout(() => {
          void render();
        }, 0);
      }
    }
  } catch (_) {}
}

function formatTime(ts) {
  try {
    const opts = { hour: "2-digit", minute: "2-digit", second: "2-digit" };
    const when = new Date(toMs(ts));
    if (currentTimeZone && currentTimeZone !== "auto") {
      return new Intl.DateTimeFormat(undefined, {
        ...opts,
        timeZone: currentTimeZone,
      }).format(when);
    }
    return new Intl.DateTimeFormat(undefined, opts).format(when);
  } catch (_) {
    return new Date(toMs(ts)).toLocaleTimeString();
  }
}

async function renderStatus() {
  if (!statusEl) return;
  try {
    const resp = await send({ type: "GET_STATUS" }).catch(() => null);
    const st = resp?.status || {};
    const parts = [];
    if (st.lastError) parts.push(`Ошибка: ${st.lastError}`);
    parts.push(`Конфиг: ${st.lastConfigOk ? "OK" : "Ошибка"}`);
    parts.push(`Запрос к Supabase: ${st.lastFetchOk ? "OK" : "Ошибка"}`);
    if (st.lastFetchAt)
      parts.push(`Обновлено: ${new Date(st.lastFetchAt).toLocaleTimeString()}`);
    parts.push(`Локальная история: ${st.historyCount ?? 0}`);
    statusEl.textContent = parts.join(" • ");
    statusEl.classList.remove("hidden");
  } catch (_) {
    statusEl.textContent = "Статус недоступен";
    statusEl.classList.remove("hidden");
  }
}

function filterHistory(arr, filter) {
  if (filter === "ALL") return arr;
  return arr.filter(
    (e) => (e.signal?.action || "WAIT").toUpperCase() === filter
  );
}

function send(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (resp) => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      return resolve(resp);
    });
  });
}

if (refreshBtn) {
  refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true;
    await send({ type: "GENERATE_NOW" }).catch(() => {});
    await load();
    refreshBtn.disabled = false;
  });
}

// Open in side panel button
document.getElementById("openSidePanel")?.addEventListener("click", () => {
  void openSidePanel();
});


void load();

chips?.addEventListener("click", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  const filter = target.getAttribute("data-filter");
  if (!filter) return;
  currentFilter = filter;
  for (const btn of chips.querySelectorAll(".chip"))
    btn.classList.remove("active");
  target.classList.add("active");
  render();
});

// Auto refresh when background updates history
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "HISTORY_UPDATED") {
    void load();
  }
});

// Unlock audio on first user interaction
window.addEventListener("pointerdown", unlockAudioOnce, { once: true });
window.addEventListener("keydown", unlockAudioOnce, { once: true });

function openModal(entry, event) {
  const action = (entry.signal?.action || "WAIT").toUpperCase();
  mTitle.textContent = `${entry.pair} • ${entry.tf} • ${action}`;
  const summary =
    entry.signal?.summary || entry.signal?.reasoning || "Нет сводки";
  const conf = Math.round((entry.signal?.confidence || 0) * 100);
  const expiry = entry.signal?.expiry_minutes || 1;
  
  // Build content with trading buttons for actionable signals
  const isActionable = action === "BUY_CALL" || action === "BUY_PUT";
  let contentHtml = `<div class="signal-details">Confidence: ${conf}%<br/>Expiration: ${expiry}m<br/><br/>${summary.replace(/\n/g, '<br/>')}</div>`;
  
  if (isActionable) {
    contentHtml += `
      <div class="trade-section">
        <div class="trade-label">Trade this signal:</div>
        <div class="trade-buttons">
          <a href="https://youlink.biz/anNz" target="_blank" rel="noopener noreferrer" class="trade-btn">
            <span>Quotex</span>
          </a>
          <a href="https://poaffiliate.onelink.me/t5P7/igof3a3d" target="_blank" rel="noopener noreferrer" class="trade-btn">
            <span>Pocket Option</span>
          </a>
          <a href="https://affiliate.iqoption.net/redir/?aff=1074&aff_model=revenue&afftrack=aisignals" target="_blank" rel="noopener noreferrer" class="trade-btn">
            <span>IQ Option</span>
          </a>
        </div>
      </div>
    `;
  }
  
  mContent.innerHTML = contentHtml;

  // Position modal near click
  if (event && modal) {
    const modalCard = modal.querySelector(".modal-card");
    if (modalCard) {
      const rect = event.target.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;

      // Set CSS variables for positioning
      modalCard.style.setProperty("--mouse-x", `${x}px`);
      modalCard.style.setProperty("--mouse-y", `${y}px`);
    }
  }

  modal?.classList.remove("hidden");
}

mClose?.addEventListener("click", () => modal?.classList.add("hidden"));
modal?.addEventListener("click", (e) => {
  if (e.target === modal || e.target?.classList?.contains("modal-backdrop")) {
    modal?.classList.add("hidden");
  }
});
