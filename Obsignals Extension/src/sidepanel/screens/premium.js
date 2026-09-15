import { t } from "../../i18n/index.js";
import { startCheckout } from "../../core/auth.js";
import { createIcon } from "../components/icons.js";
import {
  PLANS,
  DEFAULT_PLAN,
  PREMIUM_FEATURES,
  formatPrice,
} from "../../core/plans.js";

/**
 * Premium screen: what the plan includes, the two prices, and checkout.
 *
 * Checkout itself never happens inside the panel — the Subscribe button opens
 * Stripe in a new tab. An extension must not collect card data, and Stripe's
 * hosted page is what keeps the integration out of PCI scope.
 */

export function createPremiumScreen(root, { onClose }) {
  let selected = DEFAULT_PLAN;

  render();

  function render() {
    root.replaceChildren(features(), divider(), planList(), subscribeButton());
  }

  /**
   * Card listing what Premium unlocks.
   *
   * No product name on it — the header above already carries one, and the same
   * words twice make a reader check whether they are looking at two things.
   */
  function features() {
    const card = document.createElement("div");
    card.className = "prem__card";

    const list = document.createElement("ul");
    list.className = "prem__features";

    PREMIUM_FEATURES.forEach((key) => {
      const item = document.createElement("li");
      const icon = createIcon("check", 16);
      icon.classList.add("prem__check");

      const label = document.createElement("span");
      label.textContent = t(`premium.${key}`);

      item.append(icon, label);
      list.append(item);
    });

    card.append(list);
    return card;
  }

  function divider() {
    const wrapper = document.createElement("div");
    wrapper.className = "prem__divider";

    const label = document.createElement("span");
    label.textContent = t("premium.selectPlan");

    wrapper.append(label);
    return wrapper;
  }

  /** Radio group — one plan at a time, keyboard navigable by default. */
  function planList() {
    const card = document.createElement("div");
    card.className = "prem__card prem__plans";

    PLANS.forEach((plan) => {
      const row = document.createElement("label");
      row.className = "plan";

      const input = document.createElement("input");
      input.type = "radio";
      input.name = "plan";
      input.className = "radio";
      input.value = plan.id;
      input.checked = plan.id === selected;
      input.addEventListener("change", () => {
        selected = plan.id;
      });

      const name = document.createElement("div");
      name.className = "plan__name";
      name.append(textNode(t(`premium.${plan.id}`)));

      if (plan.savingPercent) {
        const badge = document.createElement("span");
        badge.className = "plan__badge";
        badge.textContent = `${t("premium.save")} ${plan.savingPercent}%`;
        name.append(badge);
      }

      const price = document.createElement("div");
      price.className = "plan__price";

      const main = document.createElement("span");
      main.className = "plan__amount";
      main.textContent =
        formatPrice(plan.price, plan.currency) +
        (plan.billedAnnually ? t("premium.perMonth") : "");
      price.append(main);

      if (plan.billedAnnually) {
        const note = document.createElement("span");
        note.className = "plan__note";
        note.textContent = `${formatPrice(plan.billedAnnually, plan.currency)} ${t(
          "premium.billedAnnually"
        )}`;
        price.append(note);
      }

      row.append(input, name, price);
      card.append(row);
    });

    return card;
  }

  function subscribeButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "prem__cta";
    button.textContent = t("premium.subscribe");

    button.addEventListener("click", async () => {
      const plan = PLANS.find((item) => item.id === selected);
      if (!plan?.priceId) return;

      button.disabled = true;
      button.textContent = t("auth.working");

      try {
        // The session is created server-side so it carries the account with it.
        // Stripe's own hosted page takes it from here — no card detail ever
        // reaches the panel, which is what keeps this out of PCI scope.
        const url = await startCheckout(plan.priceId);
        window.open(url, "_blank", "noopener,noreferrer");
      } catch {
        button.textContent = t("auth.errorGeneric");
        setTimeout(() => {
          button.textContent = t("premium.subscribe");
          button.disabled = false;
        }, 2500);
        return;
      }

      button.textContent = t("premium.subscribe");
      button.disabled = false;
    });

    return button;
  }

  function textNode(text) {
    const span = document.createElement("span");
    span.textContent = text;
    return span;
  }

  return { render, close: onClose };
}
