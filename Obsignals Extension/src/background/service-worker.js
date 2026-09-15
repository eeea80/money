import * as badge from "../core/badge.js";
import { notifySignal } from "../core/notifications.js";
import { seed } from "../core/prefs.js";
import { toSignal } from "../core/signal.js";
import { setLocale, t } from "../i18n/index.js";

/**
 * Background service worker.
 *
 * Keeps a connection to the feed so a signal can raise a notification while the
 * panel is closed — which is the whole reason this is an extension and not a
 * website.
 */

const FEED_URL = "https://api.obsignals.com/signals/stream";

/**
 * The worker is stopped after 30 seconds of inactivity, and a stopped worker
 * hears nothing. The alarm is the resurrection: it wakes the worker, which
 * finds its connection gone and opens a new one.
 *
 * A minute is the shortest period Chrome accepts, so this is the floor on how
 * long a gap can last. Signals that arrive inside a gap are not lost — they are
 * in the snapshot sent on reconnect — they just notify late, and `worthNoticing`
 * drops the ones that went stale meanwhile.
 */
const REVIVE_ALARM = "feed-alive";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error("side_panel_behavior_failed", error));

  boot();
});

chrome.runtime.onStartup.addListener(boot);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== REVIVE_ALARM) return;

  /* Recriado a cada disparo, e nao so no `boot()`. `alarms.create` com o mesmo
     nome substitui o existente, entao chamar sempre nao acumula nada — e se o
     alarme se perder fora de `onInstalled`/`onStartup`, nada mais o traria de
     volta e o feed morreria calado, sem erro em lugar nenhum. */
  chrome.alarms.create(REVIVE_ALARM, { periodInMinutes: 1 });
  connect();
});

// Opening the panel means the user has seen what arrived.
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "panel-opened") badge.clear();
});

function boot() {
  chrome.alarms.create(REVIVE_ALARM, { periodInMinutes: 1 });
  connect();
}

// --- feed -------------------------------------------------------------------

let reading = false;

/**
 * Reads the event stream by hand.
 *
 * `EventSource` is not available in a service worker, so this is `fetch` plus
 * the parsing that class would have done: frames separated by a blank line,
 * `event:` naming them and `data:` carrying the payload.
 */
async function connect() {
  if (reading) return;
  reading = true;

  try {
    await loadPreferences();

    const response = await fetch(FEED_URL);
    if (!response.ok) throw new Error(`feed responded ${response.status}`);

    const reader = response.body
      .pipeThrough(new TextDecoderStream())
      .getReader();

    let buffer = "";

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += value;

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        handleFrame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
    }
  } catch (error) {
    console.error("feed_disconnected", error.message);
  } finally {
    // Nothing retries here on purpose — the alarm is the only thing that
    // reconnects, so a worker being stopped and a stream dropping take the
    // same path instead of two.
    reading = false;
  }
}

/** The panel owns these; the worker only reads what it was told. */
async function loadPreferences() {
  const stored = await chrome.storage.local.get(null);
  seed(stored);
  setLocale(stored["obsignals.locale"] ?? chrome.i18n.getUILanguage());

  /* Older builds mirrored every preference here, including the session — which
     carries a long-lived refresh token. The mirror is now allowlisted, but the
     copies already written stay until something deletes them, so this does.
     Costs one call on an install that has none, and removes a credential from a
     store that never had a reason to hold it. */
  if ("obsignals.session" in stored) {
    await chrome.storage.local.remove("obsignals.session").catch(() => {});
  }
}

function handleFrame(frame) {
  const lines = frame.split("\n");
  const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
  const data = lines.find((line) => line.startsWith("data:"))?.slice(5).trim();

  // Comment lines (the keep-alive ping) carry neither, and are the reason this
  // returns quietly instead of logging.
  if (!event || !data) return;

  let payload;
  try {
    payload = JSON.parse(data);
  } catch {
    console.error("feed_bad_payload", data);
    return;
  }

  if (event === "signal") announce(toSignal(payload));
  else if (event === "snapshot") payload.forEach((raw) => announce(toSignal(raw)));
}

/**
 * A signal is worth interrupting someone for only while it can still be traded.
 *
 * This is also what keeps a reconnect quiet: the stream replays everything it
 * still holds, and without this the user would get a burst of notifications for
 * trades that closed an hour ago every time the worker restarted.
 */
const STALE_AFTER_MS = 60_000;

function worthNoticing(signal) {
  return Date.now() - signal.entryAt < STALE_AFTER_MS;
}

function announce(signal) {
  if (!worthNoticing(signal)) return;

  notifySignal(signal, {
    direction: t(`direction.${signal.direction.toLowerCase()}`),
    expiry: t(`tabs.${signal.timeframe.toLowerCase()}`),
  });

  badge.increment();
}
