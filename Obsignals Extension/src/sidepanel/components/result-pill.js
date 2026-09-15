import { RESULT } from "../../core/signal.js";
import { t } from "../../i18n/index.js";

/**
 * The result pill.
 *
 * Lives apart because two tables show it now — the live signals and the
 * checklist — and a win that needed a gale has to read the same in both. Two
 * copies would drift on the first change made to one of them.
 */

const MODIFICADOR = {
  [RESULT.PENDING]: "pending",
  [RESULT.GALE1]: "gale",
  [RESULT.GALE2]: "gale",
  [RESULT.WIN]: "win",
  [RESULT.LOSS]: "loss",
  [RESULT.DRAW]: "pending",
};

/**
 * Undecided means two different things in the two tables, so it is drawn two
 * ways. The live table means "this trade is open, watch it" — a spinner while
 * it runs, a dash before it starts. The checklist means "this never resolved on
 * that date", which is a state, not a moment: it gets the word and the amber.
 *
 * @param {string} resultado  One of `RESULT`.
 * @param {{gale?: number, running?: boolean, waiting?: boolean}} [opcoes]
 */
export function createResultPill(resultado, { gale = 0, running = false, waiting = false } = {}) {
  const pendente = resultado === RESULT.PENDING;

  const pilula = document.createElement("span");
  pilula.className = `pill pill--${
    pendente && waiting ? "wait" : MODIFICADOR[resultado] ?? "pending"
  }`;

  /* A win straight off the entry and a win that needed two martingales are the
     same word on screen and nothing alike to whoever took the trade. The suffix
     is what separates them — absent on a clean win, so the common case stays
     short. "G1" is the notation the whole market uses; it is not translated. */
  const sufixo = resultado === RESULT.WIN && gale ? ` G${gale}` : "";

  if (pendente && waiting) {
    pilula.textContent = t("result.wait");
    return pilula;
  }

  if (pendente && running) {
    /* Turning only once the trade is open. Before that the row is a heads-up,
       and movement there would say "happening now" a minute too early. */
    pilula.classList.add("pill--waiting");
    /* Not the dash: read aloud it is a punctuation mark. */
    pilula.setAttribute("aria-label", t("result.running"));

    const roda = document.createElement("span");
    roda.className = "spinner";
    roda.setAttribute("aria-hidden", "true");
    pilula.append(roda);
  } else {
    pilula.textContent = t(`result.${resultado.toLowerCase()}`) + sufixo;
  }

  return pilula;
}
