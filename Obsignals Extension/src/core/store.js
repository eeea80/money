import { isLive, TIMEFRAMES } from "./signal.js";

/**
 * Application state.
 *
 * Holds the signals per timeframe, which tab is open, and how many signals
 * arrived on the tab the user is *not* looking at (the blue badge). Emits a
 * change event; the UI re-renders from the snapshot and owns no state of its
 * own.
 */

/**
 * How much history a tab keeps.
 *
 * Fifteen is about one screen and a half — enough to see how the session is
 * going, short enough that nobody scrolls through yesterday. Signals age out of
 * usefulness within the hour, so a long list is weight without value.
 */
const MAX_SIGNALS_PER_TIMEFRAME = 15;

/**
 * @param {string} [initialTimeframe]
 * @param {{canSee?: (signal: object) => boolean}} [options] `canSee` decides
 *   what counts towards a tab's badge. Passed in rather than imported so this
 *   file stays about signals and knows nothing about who is reading them.
 */
export function createStore(initialTimeframe = TIMEFRAMES[0], { canSee = () => true } = {}) {
  const listeners = new Set();

  const signals = new Map(TIMEFRAMES.map((tf) => [tf, []]));
  const unread = new Map(TIMEFRAMES.map((tf) => [tf, 0]));
  const seen = new Set();
  let activeTimeframe = initialTimeframe;

  function emit() {
    const snapshot = getState();
    listeners.forEach((listener) => listener(snapshot));
  }

  function getState() {
    return {
      activeTimeframe,
      signals: signals.get(activeTimeframe) ?? [],
      unread: Object.fromEntries(unread),
    };
  }

  /**
   * Adds a signal. Ignores ids already stored so a reconnect that replays
   * recent history does not duplicate rows.
   */
  function addSignal(signal) {
    if (seen.has(signal.id)) return false;
    seen.add(signal.id);

    const bucket = signals.get(signal.timeframe);
    if (!bucket) return false;

    bucket.unshift(signal);
    if (bucket.length > MAX_SIGNALS_PER_TIMEFRAME) bucket.pop();

    /* Only the tab the user is not on accumulates a badge, and only for signals
       still worth acting on. Reopening the panel replays the whole history, and
       counting that would put a "3" on a tab holding three finished trades.

       Nor does it count what this reader cannot open: a badge is a promise that
       something is there, and sending someone to a locked tab to sell them
       something is the kind of nudge that gets an extension uninstalled. */
    if (signal.timeframe !== activeTimeframe && isLive(signal) && canSee(signal)) {
      unread.set(signal.timeframe, unread.get(signal.timeframe) + 1);
    }

    emit();
    return true;
  }

  /** Updates the result of a signal already on screen (WIN/LOSS arrives later). */
  function updateResult(id, result, gale = null) {
    for (const bucket of signals.values()) {
      const signal = bucket.find((item) => item.id === id);
      if (signal) {
        signal.result = result;
        // Em qual martingale a vitória caiu. Só o servidor sabe, porque só ele
        // viu a que horas o anúncio chegou.
        signal.gale = gale;
        emit();
        return true;
      }
    }
    return false;
  }

  function setActiveTimeframe(timeframe) {
    if (!TIMEFRAMES.includes(timeframe) || timeframe === activeTimeframe) return;
    activeTimeframe = timeframe;
    unread.set(timeframe, 0); // opening a tab clears its badge
    emit();
  }

  function subscribe(listener) {
    listeners.add(listener);
    listener(getState());
    return () => listeners.delete(listener);
  }

  return {
    addSignal,
    updateResult,
    setActiveTimeframe,
    subscribe,
    getState,
  };
}
