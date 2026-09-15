/**
 * Signal shape shared by every layer of the extension.
 *
 * This is the single contract between the data source and the UI: whatever
 * feeds signals (mock today, the Obsignals API tomorrow) must produce this
 * object, and the table only ever reads from it. Changing the transport should
 * never require touching a component.
 *
 * @typedef {object} Signal
 * @property {string}    id         Stable unique id — used for dedupe.
 * @property {string}    asset      Instrument, e.g. "EURUSD-OTC".
 * @property {Direction} direction
 * @property {Timeframe} timeframe  Which tab the signal belongs to.
 * @property {number}    entryAt    Entry time, epoch milliseconds.
 * @property {Result}    result
 * @property {number|null} gale     Which martingale a win landed on: 0, 1 or 2.
 */

/** @typedef {"CALL" | "PUT"} Direction */
/** @typedef {"WIN" | "LOSS" | "DRAW" | "PENDING"} Result */
/** @typedef {"M1" | "M5"} Timeframe */

export const TIMEFRAMES = /** @type {const} */ (["M1", "M5"]);

export const DIRECTION = /** @type {const} */ ({ CALL: "CALL", PUT: "PUT" });

/**
 * Result states, in the order a signal walks through them.
 *
 * A signal is not win-or-lose from the start: it opens PENDING, and a loss
 * sends it to the first martingale, then the second. Only after GALE2 does the
 * outcome settle into WIN or LOSS.
 *
 *   PENDING → (loss) → GALE1 → (loss) → GALE2 → WIN | LOSS
 *      └──────────────── (win at any stage) ─────────┘
 */
export const RESULT = /** @type {const} */ ({
  PENDING: "PENDING",
  GALE1: "GALE1",
  GALE2: "GALE2",
  WIN: "WIN",
  LOSS: "LOSS",
  DRAW: "DRAW",
});

/**
 * How long one trade of a timeframe lasts. "M5" is five minutes — reading it
 * off the name means a new timeframe needs no table kept in sync.
 */
function durationMs(timeframe) {
  return Number(timeframe.slice(1)) * 60_000;
}

/**
 * How long to wait past a trade's close before calling it a martingale.
 *
 * A trade that closes at 17:20 is decided *at* 17:20 and announced seconds
 * later. Promoting at the boundary itself paints a stage that never happened:
 * the row flicks to "Gale 1" and then back to WIN when the message lands. The
 * grace is what makes an on-time result look on time.
 *
 * Short on purpose: it has to fit inside an M1, where the whole sequence is
 * three minutes long, and every second here is a second a real martingale
 * shows up late.
 */
const SETTLE_GRACE_MS = 15_000;

/**
 * Which stage a signal is in right now.
 *
 * The channel never announces the martingales — it stays silent and posts the
 * outcome once, after the whole sequence has played out. Silence *is* the
 * message: an M1 entered at 00:00 with nothing said by 00:01 is on the first
 * martingale, by 00:02 on the second, and the result lands at 00:03.
 *
 * So the stage is read from the clock instead of stored. Nothing to keep in
 * sync, nothing to miss if the panel was closed while it happened, and a
 * settled signal always wins over the clock — a result that arrives early is
 * the truth, not the timer.
 *
 * @param {Signal} signal
 * @param {number} [now] epoch ms
 * @returns {Result}
 */
export function resultAt(signal, now = Date.now()) {
  if (signal.result !== RESULT.PENDING) return signal.result;

  const elapsed = now - signal.entryAt - SETTLE_GRACE_MS;
  const trades = Math.floor(elapsed / durationMs(signal.timeframe));

  if (trades < 1) return RESULT.PENDING;
  if (trades < 2) return RESULT.GALE1;

  // Past the second martingale the outcome is due but has not arrived. Holding
  // at GALE2 says "still running"; anything else would invent a result. It only
  // lasts until `isAbandoned` drops the row.
  return RESULT.GALE2;
}

/**
 * The outcome is due after three trades. This is the fourth.
 *
 * The grace is a whole trade rather than a fixed number of seconds so it scales
 * with the timeframe: a minute of slack on M1, five on M5.
 */
const ABANDON_AFTER_TRADES = 4;

/**
 * Whether a signal should stop being shown.
 *
 * Nothing tells us the outcome went missing — the absence *is* the tell. The
 * only thing that ever clears PENDING is the reply in the channel, so a signal
 * still pending long after its result was due never got one.
 *
 * The extra trade of slack is what separates "missing" from "late": Telegram
 * lag, the poll interval and a panel that was closed all delay the reply
 * without losing it, and dropping a row that was about to settle would be worse
 * than leaving it a moment longer.
 *
 * @param {Signal} signal
 * @param {number} [now] epoch ms
 */
export function isAbandoned(signal, now = Date.now()) {
  if (signal.result !== RESULT.PENDING) return false;

  const due = ABANDON_AFTER_TRADES * durationMs(signal.timeframe);
  return now - signal.entryAt - SETTLE_GRACE_MS >= due;
}

/**
 * Whether the trade has actually opened.
 *
 * The channel announces about a minute ahead, so a signal spends that minute on
 * screen without having started. Both states are PENDING — nothing has been
 * decided either way — but they are opposite instructions to the reader: one
 * still leaves time to place the trade, the other does not.
 *
 * @param {Signal} signal
 * @param {number} [now] epoch ms
 */
export function hasStarted(signal, now = Date.now()) {
  return now >= signal.entryAt;
}

/**
 * Still worth pointing at.
 *
 * The feed replays everything it holds whenever the panel reconnects, so
 * "arrived just now" and "is news" are not the same thing. A signal that
 * already has a result is history, and one whose result never came is a gap —
 * neither should light up the tab the user is not looking at.
 *
 * @param {Signal} signal
 * @param {number} [now] epoch ms
 */
export function isLive(signal, now = Date.now()) {
  return signal.result === RESULT.PENDING && !isAbandoned(signal, now);
}

/**
 * Whether the signal is on an OTC pair.
 *
 * OTC is what the brokers run when the real market is shut — weekends and out
 * of hours — so it is not a category of signal so much as a category of clock.
 * Read off the name because that is where it is stated, by the channel and by
 * every broker: "EURUSD-OTC" is the pair, not a pair with a flag beside it.
 *
 * @param {Signal} signal
 */
export function isOtc(signal) {
  return String(signal.asset).toUpperCase().endsWith("-OTC");
}

/**
 * Normalizes a raw payload into a Signal.
 *
 * Kept deliberately tolerant: the Telegram-fed backend may label the same
 * concept differently ("ACIMA"/"ABAIXO" in the channel messages, "CALL"/"PUT"
 * in the database), and the UI should not be the place that learns those
 * dialects.
 *
 * @param {Record<string, unknown>} raw
 * @returns {Signal}
 */
export function toSignal(raw) {
  return {
    id: String(raw.id),
    asset: String(raw.asset),
    direction: normalizeDirection(raw.direction),
    timeframe: normalizeTimeframe(raw.timeframe),
    entryAt: Number(raw.entryAt),
    result: normalizeResult(raw.result),
    gale: normalizeGale(raw.gale),
  };
}

/**
 * Which martingale a win landed on.
 *
 * Only 0, 1 and 2 exist — the sequence has three velas and no more. Anything
 * else is a source that does not know, and "does not know" is null rather than
 * a guess: a wrong gale on screen is worse than no gale at all, because the
 * reader has no way to tell it is wrong.
 */
function normalizeGale(value) {
  const gale = Number(value);
  return Number.isInteger(gale) && gale >= 0 && gale <= 2 ? gale : null;
}

/**
 * As palavras que as listas de sinais usam para cada lado.
 *
 * Nao e enfeite. O servidor do checklist so entende a palavra "call" e joga
 * todo o resto em PUT, entao uma lista escrita em portugues volta inteira
 * invertida e o placar mente sem reclamar. Traduzir antes de enviar e o que
 * impede isso, e a traducao sai daqui: a mesma verdade nao pode morar em dois
 * arquivos.
 */
const VOCABULARIO = new Map([
  ["CALL", DIRECTION.CALL],
  ["ACIMA", DIRECTION.CALL],
  ["UP", DIRECTION.CALL],
  ["COMPRA", DIRECTION.CALL],
  ["BUY", DIRECTION.CALL],
  ["🟢", DIRECTION.CALL],
  ["PUT", DIRECTION.PUT],
  ["ABAIXO", DIRECTION.PUT],
  ["DOWN", DIRECTION.PUT],
  ["VENDA", DIRECTION.PUT],
  ["SELL", DIRECTION.PUT],
  ["🔴", DIRECTION.PUT],
]);

/** O lado que esta palavra quer dizer, ou `null` se ela nao diz nada. */
export function direcaoDe(palavra) {
  return VOCABULARIO.get(String(palavra ?? "").trim().toUpperCase()) ?? null;
}

/* O feed manda so CALL e PUT — conferido no snapshot ao vivo. O padrao PUT
   atende ao que nunca chega; trocar isso seria mexer no que ja funciona. */
function normalizeDirection(value) {
  return direcaoDe(value) ?? DIRECTION.PUT;
}

function normalizeTimeframe(value) {
  const token = String(value ?? "").toUpperCase();
  return TIMEFRAMES.includes(token) ? token : "M1";
}

function normalizeResult(value) {
  const token = String(value ?? "").toUpperCase();
  return token in RESULT ? RESULT[token] : RESULT.PENDING;
}
