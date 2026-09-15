/**
 * Where the user's choices live.
 *
 * The panel and the service worker both need them — which language to write a
 * notification in, which zone to print its time in, whether to notify at all —
 * but they run in different worlds: `localStorage` exists in the panel and not
 * in a service worker.
 *
 * So reads and writes go through here. The panel keeps using `localStorage`,
 * synchronously, exactly as before. The worker gets the same values seeded from
 * `chrome.storage`, which is the only storage both contexts share, and every
 * write mirrors into it so the worker sees the change on its next start.
 *
 * Sync on purpose: `chrome.storage` is async, and making it the primary would
 * turn every settings row into a promise for no benefit the user can see.
 */

const memory = new Map();

/** Present in the panel, absent in the service worker. */
const local = typeof localStorage === "undefined" ? null : localStorage;

export function get(key) {
  return local ? local.getItem(key) : memory.get(key) ?? null;
}

export function set(key, value) {
  if (local) local.setItem(key, value);
  else memory.set(key, value);
  mirror({ [key]: value });
}

export function remove(key) {
  if (local) local.removeItem(key);
  else memory.delete(key);
  mirror({ [key]: null });
}

/**
 * Loads values written by the panel. Called once by the service worker; the
 * panel never needs it, since `localStorage` already holds the truth.
 */
export function seed(entries) {
  Object.entries(entries).forEach(([key, value]) => {
    if (value == null) return;
    if (local) local.setItem(key, value);
    else memory.set(key, value);
  });
}

/**
 * The only keys the service worker has any use for.
 *
 * An allowlist and not "everything", because `set()` is also how the session is
 * persisted — and the session holds a long-lived refresh token. Mirroring it
 * would copy a credential into a second store that nothing reads, for no gain:
 * the worker only writes notifications, and the feed it listens to is
 * unauthenticated.
 *
 * Storage a extension writes is readable by anything that later gains script
 * access to it. Fewer copies of a credential is strictly better, and this one
 * was free to remove.
 */
const ESPELHADAS = new Set([
  "obsignals.locale",
  "obsignals.timezone",
  "obsignals.notifications",
]);

/**
 * Best effort by design: mirroring failing must never break the setting the
 * user just changed. The cost of a lost mirror is a notification in the wrong
 * language until the next write, not a broken panel.
 */
function mirror(todas) {
  if (typeof chrome === "undefined" || !chrome.storage) return;

  const entries = Object.fromEntries(
    Object.entries(todas).filter(([key]) => ESPELHADAS.has(key))
  );
  if (!Object.keys(entries).length) return;

  const removals = Object.keys(entries).filter((key) => entries[key] == null);
  const writes = Object.fromEntries(
    Object.entries(entries).filter(([, value]) => value != null)
  );

  if (removals.length) chrome.storage.local.remove(removals).catch(noop);
  if (Object.keys(writes).length) chrome.storage.local.set(writes).catch(noop);
}

function noop() {}
