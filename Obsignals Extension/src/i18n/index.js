import en from "./locales/en.js";
import pt from "./locales/pt.js";
import es from "./locales/es.js";
import fr from "./locales/fr.js";
import de from "./locales/de.js";
import it from "./locales/it.js";
import hi from "./locales/hi.js";
import ar from "./locales/ar.js";
import { get as readPref, set as writePref } from "../core/prefs.js";

/**
 * Translation lookup.
 *
 * English is the source of truth: every other locale is a partial overlay and
 * any missing key falls back to `en`, so a half-translated locale degrades to
 * English instead of rendering an empty cell.
 */

const LOCALES = { en, pt, es, fr, de, it, hi, ar };
const FALLBACK = "en";
const STORAGE_KEY = "obsignals.locale";

/** Shown in the language picker, each in its own language. */
export const LOCALE_NAMES = {
  en: "English",
  pt: "Português",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  it: "Italiano",
  hi: "हिन्दी",
  ar: "العربية",
};

/** Languages written right to left. */
const RTL = new Set(["ar"]);

let active = FALLBACK;

/** Resolves "pt-BR" -> "pt". Unknown languages fall back to English. */
function normalize(language) {
  const base = String(language || "").toLowerCase().split("-")[0];
  return base in LOCALES ? base : FALLBACK;
}

/** Walks a dotted path ("table.asset") through a locale object. */
function resolve(dictionary, path) {
  return path
    .split(".")
    .reduce((node, key) => (node == null ? undefined : node[key]), dictionary);
}

/**
 * @param {string} language
 * @param {{persist?: boolean}} [options] Persist an explicit user choice; an
 *   automatic detection at startup should not overwrite it.
 */
export function setLocale(language, { persist = false } = {}) {
  active = normalize(language);
  if (persist) writePref(STORAGE_KEY, active);

  // Single choke point for direction: both startup and the picker come through
  // here, so no caller has to remember to flip the layout for Arabic.
  if (typeof document !== "undefined") {
    document.documentElement.lang = active;
    document.documentElement.dir = RTL.has(active) ? "rtl" : "ltr";
  }

  return active;
}

/** The saved choice, or null when the app should follow the browser. */
export function savedLocale() {
  return readPref(STORAGE_KEY);
}

export function getLocale() {
  return active;
}

/**
 * @param {string} path  dotted, e.g. "settings.title"
 * @param {Record<string, string>} [values]  filled into `{name}` placeholders
 */
export function t(path, values) {
  const value = resolve(LOCALES[active], path) ?? resolve(LOCALES[FALLBACK], path);
  // Surfacing the key beats rendering "undefined" when a string is missing.
  if (value == null) return path;
  if (!values) return value;

  /* Placeholders exist for sentences that wrap a value the user has to see —
     their own address, the phrase they must type. Splitting those in two would
     put the word order in the code instead of in the translation. */
  return value.replace(/\{(\w+)\}/g, (whole, name) =>
    name in values ? values[name] : whole
  );
}

/**
 * Applies translations to the document.
 *
 *   data-i18n="key"        -> element text
 *   data-i18n-label="key"  -> aria-label, for controls whose visible content
 *                             is an icon or a single character
 *
 * Called on load and again whenever the locale changes.
 */
export function translateDocument(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });

  root.querySelectorAll("[data-i18n-label]").forEach((element) => {
    element.setAttribute("aria-label", t(element.dataset.i18nLabel));
  });

  root.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    element.setAttribute("placeholder", t(element.dataset.i18nPlaceholder));
  });
}
