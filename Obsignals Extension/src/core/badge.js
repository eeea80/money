/**
 * Unread counter on the toolbar icon.
 *
 * The panel is often closed while the user works on the broker's page, and a
 * notification disappears after a few seconds. The badge is what remains: a
 * number on the icon saying "signals arrived while you were away".
 *
 * Cleared when the panel opens — at that point the user has seen them.
 */

const BACKGROUND = "#0A84FF"; // primary, same blue as the unread tab badge
const MAX_SHOWN = 99;

let unread = 0;

function paint() {
  if (typeof chrome === "undefined" || !chrome.action) return;

  chrome.action.setBadgeBackgroundColor({ color: BACKGROUND });
  chrome.action.setBadgeText({
    text: unread === 0 ? "" : String(Math.min(unread, MAX_SHOWN)),
  });
}

/** One more signal arrived while the panel was closed. */
export function increment() {
  unread += 1;
  paint();
}

/** Panel opened — the user has seen them. */
export function clear() {
  unread = 0;
  paint();
}

export function count() {
  return unread;
}
