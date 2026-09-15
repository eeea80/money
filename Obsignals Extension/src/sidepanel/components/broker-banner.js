import { t } from "../../i18n/index.js";
import { BROKER_BANNER } from "../../core/brokers.js";

/**
 * Sponsored broker banner, ported from Obtraders' BullexBanner.
 *
 * Same gradient, same layout, same call to action — only the broker and the
 * destination change. The artwork is a still PNG rather than the Lottie the
 * web app uses: the dotLottie runtime ships an 8.4 MB WASM bundle, which is
 * not a reasonable trade for a decorative emoji inside an extension. A CSS
 * float keeps it alive instead.
 */

export function createBrokerBanner(root) {
  const link = document.createElement("a");
  link.className = "banner";
  link.href = BROKER_BANNER.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("aria-label", `${BROKER_BANNER.broker} — ${t("banner.cta")}`);

  const content = document.createElement("div");
  content.className = "banner__content";

  // The brand lockup replaces the headline. Rendered through a mask so the
  // whole lockup goes white: the symbol ships in brand red, which disappears
  // against a red banner.
  const logo = document.createElement("span");
  logo.className = "banner__logo";
  logo.setAttribute("role", "img");
  logo.setAttribute("aria-label", BROKER_BANNER.broker);

  const subtitle = document.createElement("p");
  subtitle.className = "banner__subtitle";
  subtitle.dataset.i18n = "banner.subtitle";

  const cta = document.createElement("span");
  cta.className = "banner__cta";

  const ctaText = document.createElement("span");
  ctaText.dataset.i18n = "banner.cta";
  cta.append(ctaText, arrow());

  content.append(logo, subtitle, cta);

  // Oversized, tilted symbol bleeding off the right edge — the artwork is the
  // brand itself instead of a stock mascot.
  const art = document.createElement("div");
  art.className = "banner__art";
  art.setAttribute("aria-hidden", "true");

  link.append(content, art);
  root.append(link);

  return link;
}

function arrow() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "13");
  svg.setAttribute("height", "13");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M5 12h14m-6-6 6 6-6 6");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2.5");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");

  svg.append(path);
  return svg;
}
