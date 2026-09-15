/**
 * @license
 * Copyright (c) 2024-2025 CRX International LLC. All Rights Reserved.
 *
 * ChartMentor - Verified TradingView Alert Price Autofill
 */

(() => {
  const DIALOG_SELECTORS = [
    '[data-dialog-name="alert-dialog"]',
    '[data-name="alert-dialog"]',
    '[data-name="alert-dialog-container"]',
    '[role="dialog"]',
  ];
  const EXCLUDED_INPUT_TYPES = new Set([
    "button",
    "checkbox",
    "date",
    "datetime-local",
    "email",
    "file",
    "hidden",
    "month",
    "radio",
    "range",
    "search",
    "submit",
    "time",
    "week",
  ]);

  function normalizeLevel(value) {
    const normalized = String(value ?? "")
      .trim()
      .replace(/\s+/g, "")
      .replace(/,/g, "");
    if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return "";
    return normalized;
  }

  function isVisible(element) {
    if (!element || element.getClientRects().length === 0) return false;
    const style = window.getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) !== 0
    );
  }

  function findVisibleAlertDialog() {
    return Array.from(
      document.querySelectorAll(DIALOG_SELECTORS.join(",")),
    ).find((element) => {
      if (!isVisible(element)) return false;
      const text = `${element.innerText || ""} ${element.getAttribute("aria-label") || ""}`;
      return (
        /alert|condition/i.test(text) ||
        element.matches(
          '[data-dialog-name="alert-dialog"], [data-name="alert-dialog"], [data-name="alert-dialog-container"]',
        )
      );
    });
  }

  function getInputDescriptor(input) {
    const parentText =
      input.closest?.('label, [class*="field"], [class*="control"]')
        ?.textContent || "";
    return [
      input.getAttribute("aria-label"),
      input.getAttribute("placeholder"),
      input.getAttribute("name"),
      input.getAttribute("data-name"),
      input.getAttribute("data-role"),
      parentText,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function scorePriceInput(input) {
    if (!isVisible(input) || input.disabled || input.readOnly) return -1;
    const type = String(input.type || "text").toLowerCase();
    if (EXCLUDED_INPUT_TYPES.has(type)) return -1;

    const descriptor = getInputDescriptor(input);
    if (/message|alert name|expiration|date|time|email/.test(descriptor)) {
      return -1;
    }

    let score = 0;
    if (/\b(value|price|level)\b/.test(descriptor)) score += 80;
    if (type === "number") score += 35;
    if (/decimal|numeric/.test(String(input.inputMode || ""))) score += 25;
    return score;
  }

  function findPriceInput(dialog) {
    const ranked = Array.from(dialog.querySelectorAll("input"))
      .map((input) => ({ input, score: scorePriceInput(input) }))
      .filter((candidate) => candidate.score >= 60)
      .sort((left, right) => right.score - left.score);

    if (!ranked.length) return null;
    if (ranked[1] && ranked[1].score === ranked[0].score) return null;
    return ranked[0].input;
  }

  function setInputValue(input, value) {
    const prototype = window.HTMLInputElement?.prototype;
    const setter = prototype
      ? Object.getOwnPropertyDescriptor(prototype, "value")?.set
      : null;
    if (setter) setter.call(input, value);
    else input.value = value;

    input.dispatchEvent(
      typeof InputEvent === "function"
        ? new InputEvent("input", {
            bubbles: true,
            composed: true,
            inputType: "insertText",
            data: value,
          })
        : new Event("input", { bubbles: true, composed: true }),
    );
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function fillVisibleDialog(level) {
    const normalizedLevel = normalizeLevel(level);
    if (!normalizedLevel) return { filled: false, reason: "invalid_level" };

    const dialog = findVisibleAlertDialog();
    if (!dialog) return { filled: false, reason: "dialog_not_found" };

    const input = findPriceInput(dialog);
    if (!input) return { filled: false, reason: "price_input_not_found" };

    try {
      input.focus();
      setInputValue(input, normalizedLevel);
      await new Promise((resolve) => window.setTimeout(resolve, 80));
      const filled = normalizeLevel(input.value) === normalizedLevel;
      return {
        filled,
        reason: filled ? "filled" : "value_not_retained",
      };
    } catch (error) {
      console.warn(
        "ChartMentor: TradingView alert price autofill failed",
        error,
      );
      return { filled: false, reason: "fill_failed" };
    }
  }

  window.ChartMentorAlertAutofill = {
    fillVisibleDialog,
  };
})();
