const DEFAULTS = {
  openRouterApiKey: "",
  model: "meta-llama/llama-3.1-70b-instruct:free",
  tradingPair: "EURUSD",
  timeframe: "1m",
  intervalMinutes: 5,
  proxyUrl: "",
  timezone: "auto",
  pairs: [
    "EURUSD",
    "GBPUSD",
    "USDJPY",
    "USDCHF",
    "USDCAD",
    "AUDUSD",
    "NZDUSD",
    "EURJPY",
    "GBPJPY",
    "EURGBP",
  ],
};

const models = [
  "meta-llama/llama-3.1-8b-instruct:free",
  "meta-llama/llama-3.1-70b-instruct:free",
  "gpt-4o-mini",
  "openai/gpt-4o-mini-2024-07-18",
  "anthropic/claude-3.5-sonnet",
];

const els = {
  tf: document.getElementById("tf"),
  timezone: document.getElementById("timezone"),
  interval: document.getElementById("interval"),
  soundEnabled: document.getElementById("soundEnabled"),
  soundChoice: document.getElementById("soundChoice"),
  soundTest: document.getElementById("soundTest"),
  save: document.getElementById("save"),
};

async function load() {
  const { settings } = await chrome.storage.sync.get("settings");
  const s = { ...DEFAULTS, ...(settings || {}) };
  els.tf.value = s.timeframe;
  // fill timezones list if supported
  try {
    const tzs =
      (Intl.supportedValuesOf && Intl.supportedValuesOf("timeZone")) || [];
    if (Array.isArray(tzs) && tzs.length && els.timezone) {
      const current =
        s.timezone === "auto"
          ? Intl.DateTimeFormat().resolvedOptions().timeZone || ""
          : s.timezone;
      // clear all except first (auto)
      while (els.timezone.options.length > 1) els.timezone.remove(1);
      tzs.forEach((tz) => {
        const opt = document.createElement("option");
        opt.value = tz;
        opt.textContent = tz;
        if (tz === current) opt.selected = true;
        els.timezone.appendChild(opt);
      });
    }
  } catch (_) {}
  els.timezone.value = s.timezone || "auto";
  els.interval.value = s.intervalMinutes;
  if (typeof s.soundEnabled === "boolean")
    els.soundEnabled.checked = s.soundEnabled;
  else els.soundEnabled.checked = true;
  els.soundChoice.value = s.soundChoice || "ding";
}

async function save() {
  const settings = {
    timeframe: els.tf.value,
    intervalMinutes: Math.max(1, Number(els.interval.value || 5)),
    timezone: els.timezone.value || "auto",
    soundEnabled: !!els.soundEnabled.checked,
    soundChoice: els.soundChoice.value,
  };
  await chrome.storage.sync.set({ settings });
  alert("Saved");
}

async function testCall() {
  await chrome.runtime.sendMessage({ type: "GENERATE_NOW" }).catch(() => {});
  alert("Signal generation requested");
}

els.save.addEventListener("click", () => void save());
els.soundTest.addEventListener("click", () => {
  const choice = els.soundChoice.value;
  const dingEl = new Audio("../audio/ding.mp3");
  const bimEl = new Audio("../audio/bim.mp3");
  const playBeep = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = choice === "beep2" ? "square" : "sine";
      osc.frequency.setValueAtTime(choice === "beep2" ? 660 : 880, now);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.15, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.21);
    } catch (_) {}
  };
  if (choice === "ding") {
    dingEl.play().catch(playBeep);
  } else if (choice === "bim") {
    bimEl.play().catch(playBeep);
  } else {
    playBeep();
  }
});

void load();
