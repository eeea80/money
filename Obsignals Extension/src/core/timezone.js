/**
 * Time zone handling.
 *
 * Signals are published in Brazil time (UTC−3) and never change that, but the
 * users are spread across the world. Two separate concerns live here:
 *
 *  1. SOURCE — how to read a wall-clock time coming from Telegram ("13:41"),
 *     which is always America/Sao_Paulo, and turn it into an absolute instant.
 *  2. DISPLAY — which zone to render that instant in. Defaults to the one the
 *     browser reports, and the user can override it.
 *
 * Keeping instants (epoch ms) inside and converting only at the edges is what
 * makes the panel correct for someone in Lisbon or Tokyo without any special
 * casing in the UI.
 */

/** The channels publish in Brazil time. This is a property of the source. */
export const SOURCE_TIME_ZONE = "America/Sao_Paulo";

import { get as readPref, remove as removePref, set as writePref } from "./prefs.js";

const STORAGE_KEY = "obsignals.timezone";

/** The zone the browser reports for this machine, e.g. "Europe/Lisbon". */
export function detectTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Display zone: the user's saved choice, or the detected one. */
export function getTimeZone() {
  return readPref(STORAGE_KEY) || detectTimeZone();
}

/** Persists an explicit choice; pass null to go back to automatic. */
export function setTimeZone(zone) {
  if (zone) writePref(STORAGE_KEY, zone);
  else removePref(STORAGE_KEY);
}

/**
 * Zones surfaced first, mirroring Obtraders: the markets these signals serve,
 * then everything else the browser knows.
 */
const PREFERRED = [
  "America/Sao_Paulo",
  "America/Bogota",
  "America/Lima",
  "America/Mexico_City",
  "America/Santiago",
  "America/Argentina/Buenos_Aires",
  "America/Caracas",
  "America/New_York",
  "Europe/Lisbon",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Paris",
  "UTC",
];

/** Every IANA zone the browser knows — no hand-maintained list to go stale. */
export function listTimeZones() {
  const all =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [SOURCE_TIME_ZONE, detectTimeZone()];

  return [...new Set([...PREFERRED, ...all])];
}

/**
 * Options for the picker: `{ value, city, region, offset }`.
 * Preferred zones keep their order at the top; the rest are sorted by offset,
 * so scrolling walks the globe west to east.
 */
export function timeZoneOptions() {
  const build = (zone) => ({
    value: zone,
    city: cityName(zone),
    region: zone.includes("/") ? zone.split("/")[0].replace(/_/g, " ") : "",
    offset: formatOffset(zone),
    gmt: formatGmt(zone),
    minutes: offsetMinutes(zone),
  });

  const preferred = PREFERRED.map(build);
  const rest = listTimeZones()
    .filter((zone) => !PREFERRED.includes(zone))
    .map(build)
    .sort((a, b) => a.minutes - b.minutes || a.city.localeCompare(b.city));

  return { preferred, rest };
}

/** Current UTC offset of a zone, in minutes (Lisbon in summer -> 60). */
export function offsetMinutes(zone, at = new Date()) {
  // Formatting the same instant as if it were UTC and diffing against the real
  // UTC value yields the offset, including daylight saving for that date.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);

  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second")
  );

  return Math.round((asUtc - at.getTime()) / 60000);
}

/**
 * Turns a wall-clock time published in Brazil into an absolute instant.
 *
 * @param {string} time  "HH:mm"
 * @param {Date}   day   Which calendar day it belongs to (defaults to today).
 * @returns {number} epoch milliseconds
 */
export function sourceTimeToEpoch(time, day = new Date()) {
  const [hour, minute] = String(time).split(":").map(Number);

  // Read the intended date in the source zone, so a signal at 23:50 in Brazil
  // is not filed under the wrong day for a user already past midnight.
  const dayInSource = new Intl.DateTimeFormat("en-CA", {
    timeZone: SOURCE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(day);

  const [year, month, date] = dayInSource.split("-").map(Number);
  const naiveUtc = Date.UTC(year, month - 1, date, hour, minute);

  // Subtract the source offset to land on the real instant.
  return naiveUtc - offsetMinutes(SOURCE_TIME_ZONE, new Date(naiveUtc)) * 60000;
}

/** "13:41" in whichever zone is currently selected for display. */
export function formatTime(epochMs, zone = getTimeZone()) {
  return new Intl.DateTimeFormat([], {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(epochMs));
}

/**
 * "14 Nov 2026" — a renewal date, written the way the reader's language does.
 *
 * The locale is passed rather than left to the browser: someone reading the
 * panel in Portuguese should not be told their plan renews on "Nov 14".
 */
/**
 * O dia de uma lista, como "2026-08-22", no fuso que a pessoa escolheu.
 *
 * `adiante` desloca em dias inteiros: 1 e o "amanha" do catalogador. A conta e
 * feita sobre o calendario e nao sobre o relogio — somar 24 horas em epoch
 * erra no dia em que o horario de verao muda, e errar a data de uma lista que
 * vai ser colada num grupo e um erro que todo mundo ve.
 *
 * O checklist pergunta a mesma coisa para preencher o campo de data, entao a
 * resposta mora aqui e nao em cada tela.
 */
export function listDay(adiante = 0, zone = getTimeZone()) {
  const hoje = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  if (!adiante) return hoje;

  /* Meio-dia UTC como ancora: longe o bastante das duas bordas para que somar
     um dia nunca caia de volta no mesmo. */
  const dia = new Date(`${hoje}T12:00:00Z`);
  dia.setUTCDate(dia.getUTCDate() + adiante);
  return dia.toISOString().slice(0, 10);
}

/** O instante do meio-dia UTC de um "YYYY-MM-DD", para imprimir com `formatDate`. */
export function dayToEpoch(iso) {
  return Date.parse(`${iso}T12:00:00Z`);
}

export function formatDate(epochMs, locale, zone = getTimeZone()) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(epochMs));
}

/** "UTC-3", "UTC+1", "UTC" — compact form, used for search matching. */
export function formatOffset(zone = getTimeZone()) {
  const minutes = offsetMinutes(zone);
  if (minutes === 0) return "UTC";

  const sign = minutes > 0 ? "+" : "-";
  const absolute = Math.abs(minutes);
  const hours = Math.floor(absolute / 60);
  const rest = absolute % 60;

  return `UTC${sign}${hours}${rest ? `:${String(rest).padStart(2, "0")}` : ""}`;
}

/** "GMT +01:00" — padded form Obtraders shows in its own picker. */
export function formatGmt(zone = getTimeZone()) {
  const minutes = offsetMinutes(zone);
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const rest = String(absolute % 60).padStart(2, "0");

  return `GMT ${sign}${hours}:${rest}`;
}

/** "São Paulo" out of "America/Sao_Paulo" — exported for the picker. */
export function cityName(zone) {
  return (zone.split("/").at(-1) ?? zone).replace(/_/g, " ");
}
