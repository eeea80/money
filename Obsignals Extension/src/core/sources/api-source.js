import { toSignal } from "../signal.js";

/**
 * The real feed.
 *
 * Same interface as the mock — `start({onSignal, onResult, onStatus})` and
 * `stop()` — so main.js swaps one for the other and nothing else changes.
 *
 * Server-sent events rather than polling because `EventSource` already does the
 * part that would otherwise be ours to write: it reconnects on its own, backs
 * off, and resumes. A poller would be the same feature, hand-rolled and worse.
 */

const FEED_URL = "https://api.obsignals.com/signals/stream";

export function createApiSource(url = FEED_URL) {
  let stream = null;

  function start({ onSignal, onResult, onStatus }) {
    stream = new EventSource(url);

    stream.addEventListener("open", () => onStatus("online"));

    /*
     * EventSource reports a dropped connection and a server that was never
     * there the same way, and retries either way — so this only reflects the
     * state, it does not try to fix it.
     */
    stream.addEventListener("error", () => onStatus("offline"));

    // Sent on connect: everything still worth showing, oldest first so the
    // store's unshift leaves the newest on top.
    stream.addEventListener("snapshot", (event) => {
      (parse(event) ?? []).forEach((signal) => onSignal(toSignal(signal)));
    });

    stream.addEventListener("signal", (event) => {
      const signal = parse(event);
      if (signal) onSignal(toSignal(signal));
    });

    stream.addEventListener("result", (event) => {
      const outcome = parse(event);
      if (outcome) onResult(outcome.id, outcome.result, outcome.gale);
    });
  }

  function stop() {
    stream?.close();
    stream = null;
  }

  return { start, stop };
}

/**
 * A malformed event is dropped rather than allowed to throw: the listener runs
 * inside the browser's dispatch, so an exception here would kill the handler
 * and leave the panel connected but deaf.
 */
function parse(event) {
  try {
    return JSON.parse(event.data);
  } catch {
    console.error("feed_bad_payload", event.data);
    return null;
  }
}
