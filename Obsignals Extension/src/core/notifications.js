import { get as readPref, set as writePref } from "./prefs.js";
import { formatTime } from "./timezone.js";

/**
 * Desktop notifications for incoming signals.
 *
 * This is the reason the extension beats an open browser tab: entries are
 * time-sensitive, and a user on another tab would simply miss them. Fired from
 * the service worker, a notification shows even while the panel is closed.
 *
 * Nothing here runs until a real signal source exists — today the mock only
 * feeds the open panel.
 */

const STORAGE_KEY = "obsignals.notifications";
const ICON = "icons/icon128.png";

/** Opt-out, not opt-in: a signals extension that stays silent is pointless. */
export function isEnabled() {
  return readPref(STORAGE_KEY) !== "off";
}

export function setEnabled(enabled) {
  writePref(STORAGE_KEY, enabled ? "on" : "off");
}

/**
 * @param {import("./signal.js").Signal} signal
 * @param {{direction: string, expiry: string}} labels Already translated.
 */
export function notifySignal(signal, labels) {
  if (!isEnabled()) return;
  if (typeof chrome === "undefined" || !chrome.notifications) return;

  chrome.notifications.create(`signal-${signal.id}`, {
    type: "basic",
    iconUrl: ICON,
    title: `${signal.asset}  ${labels.direction}`,
    message: `${formatTime(signal.entryAt)} · ${labels.expiry}`,
    priority: 2,
    silent: false,
  });
}
