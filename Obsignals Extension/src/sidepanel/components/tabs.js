import { TIMEFRAMES } from "../../core/signal.js";
import { t } from "../../i18n/index.js";

/**
 * iOS-style segmented control for the timeframe tabs.
 *
 * Renders once and then only mutates the selected state and badge counts, so
 * clicking a tab never rebuilds the DOM.
 */

export function createTabs(root, { onSelect }) {
  const buttons = new Map();

  TIMEFRAMES.forEach((timeframe) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tabs__item";
    button.setAttribute("role", "tab");
    button.dataset.timeframe = timeframe;

    const label = document.createElement("span");
    label.textContent = t(`tabs.${timeframe.toLowerCase()}`);

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.dataset.visible = "false";

    button.append(label, badge);
    button.addEventListener("click", () => onSelect(timeframe));

    root.append(button);
    buttons.set(timeframe, { button, label, badge });
  });

  function render({ activeTimeframe, unread }) {
    buttons.forEach(({ button, label, badge }, timeframe) => {
      const isActive = timeframe === activeTimeframe;
      button.setAttribute("aria-selected", String(isActive));
      label.textContent = t(`tabs.${timeframe.toLowerCase()}`);

      const count = unread[timeframe] ?? 0;
      badge.textContent = count > 99 ? "99+" : String(count);
      badge.dataset.visible = String(count > 0);
    });
  }

  return { render };
}
