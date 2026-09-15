import { hasStarted, isAbandoned, isOtc, resultAt } from "../../core/signal.js";
import { canSee, isPremium } from "../../core/account.js";
import { formatTime, getTimeZone } from "../../core/timezone.js";
import { createResultPill } from "./result-pill.js";
import { createTrava } from "./trava.js";
import { getLocale, t } from "../../i18n/index.js";

/**
 * The five-column signals table: Time, Asset, Direction, Expiry, Result.
 *
 * Rebuilds the whole body rather than patching rows. Fifteen rows per tab makes
 * that cheaper than the bookkeeping diffing would need, and keeps this file free
 * of it.
 *
 * The one thing it does check is whether anything changed at all: the panel
 * redraws on a timer to advance the martingale stages, and rebuilding identical
 * rows would restart the spinner's animation every few seconds.
 */

const COLUMNS = ["time", "asset", "direction", "expiry", "result"];


export function createSignalsTable(root, { onUpgrade = () => {} } = {}) {
  const table = document.createElement("table");
  table.className = "table";

  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  COLUMNS.forEach((column) => {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.className = `col--${column}`;
    cell.dataset.i18n = `table.${column}`;
    cell.textContent = t(`table.${column}`);
    // Any header with a `<column>Full` entry is an abbreviation: expose the
    // full wording on hover and to assistive tech.
    const full = t(`table.${column}Full`);
    if (full !== `table.${column}Full`) cell.title = full;
    headRow.append(cell);
  });
  head.append(headRow);

  const body = document.createElement("tbody");
  table.append(head, body);

  // Obtraders wraps its tables in a bordered card; same here.
  const card = document.createElement("div");
  card.className = "card";
  card.append(table);

  const empty = document.createElement("div");
  empty.className = "empty";
  const emptyTitle = document.createElement("p");
  emptyTitle.className = "empty__title";
  emptyTitle.dataset.i18n = "empty.title";
  const emptyText = document.createElement("p");
  emptyText.dataset.i18n = "empty.description";
  empty.append(emptyTitle, emptyText);

  /**
   * Shown in place of the empty state when the only thing running is OTC.
   *
   * Not an overlay on blurred rows: teasing the exact entry a free account
   * cannot take is a worse trade than saying plainly what is happening and why.
   * The reason is the offer — the market is shut, these are the hours Premium
   * buys.
   */
  const locked = createTrava({ onUpgrade });

  root.append(card, empty, locked.element);

  let painted = null;

  function render(allSignals) {
    // A signal whose outcome never arrived is dropped rather than shown with a
    // made-up one. Filtering here instead of in the store means every caller —
    // the store, the timer, the language and timezone pickers — gets it without
    // having to remember to ask.
    const live = allSignals.filter((signal) => !isAbandoned(signal));
    const signals = live.filter(canSee);

    /* Nothing to show, but something *is* running — the market is shut and the
       channel has moved to OTC, which is the paid half. That is a different
       thing to say than "no signals yet", and saying the wrong one leaves a
       paying customer's reason to pay invisible. */
    const onlyOtc = signals.length === 0 && live.some(isOtc);

    /* Everything the table draws, in one string. The locale and the zone are in
       it because both change what is on screen without changing the signals,
       and the plan because upgrading unlocks rows that were already here. */
    const wanted = [
      getLocale(),
      getTimeZone(),
      isPremium(),
      onlyOtc,
      ...signals.map((s) => `${s.id}:${resultAt(s)}:${hasStarted(s)}:${s.gale}`),
    ].join("|");

    if (wanted === painted) return;
    painted = wanted;

    const hasSignals = signals.length > 0;
    card.hidden = !hasSignals;
    empty.hidden = hasSignals || onlyOtc;
    locked.element.hidden = !onlyOtc;

    if (onlyOtc) {
      locked.escrever({
        titulo: t("locked.title"),
        texto: t("locked.description"),
        acao: t("settings.upgrade"),
      });
      return;
    }

    if (!hasSignals) {
      emptyTitle.textContent = t("empty.title");
      emptyText.textContent = t("empty.description");
      return;
    }

    // Header labels can change with the locale, so refresh them too.
    headRow.querySelectorAll("th").forEach((cell) => {
      cell.textContent = t(cell.dataset.i18n);
      // O título também é texto traduzido, e mudava de idioma só ao reabrir.
      const full = t(`${cell.dataset.i18n}Full`);
      if (!full.endsWith("Full")) cell.title = full;
    });

    const rows = document.createDocumentFragment();
    signals.forEach((signal) => rows.append(buildRow(signal)));

    body.replaceChildren(rows);
  }

  return { render };
}

function buildRow(signal) {
  const row = document.createElement("tr");
  row.append(
    cell("cell--time", formatTime(signal.entryAt)),
    cell("cell--asset", signal.asset),
    cell(
      "cell--direction",
      t(`direction.${signal.direction.toLowerCase()}`)
    ),
    // Same label source as the tabs, so the panel never shows "M1" in one
    // place and "1M" in another.
    cell("cell--expiry", t(`tabs.${signal.timeframe.toLowerCase()}`)),
    // The martingale stage is never sent — it follows from how long the signal
    // has been running, so it is read here rather than stored.
    resultCell(resultAt(signal), hasStarted(signal), signal.gale)
  );
  return row;
}

function cell(className, text) {
  const element = document.createElement("td");
  element.className = className;
  element.textContent = text;
  return element;
}

/** A pilula em si mora em `result-pill.js`: o checklist mostra a mesma. */
function resultCell(result, started, gale) {
  const element = document.createElement("td");
  element.className = "cell--result";
  element.append(createResultPill(result, { gale, running: started }));
  return element;
}

