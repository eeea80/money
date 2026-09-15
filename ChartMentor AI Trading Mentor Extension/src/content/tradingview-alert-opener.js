(() => {
  const DIALOG_SELECTORS = [
    '[data-dialog-name="alert-dialog"]',
    '[data-name="alert-dialog"]',
    '[data-name="alert-dialog-container"]',
    '[data-name="alerts-create-edit-dialog"]',
    '[role="dialog"]',
  ];
  const ALERT_BUTTON_SELECTORS = [
    '[data-name="open-alert-dialog"]',
    '[data-name="add-alert"]',
    '[data-name="create-alert"]',
    'button[aria-label="Create alert"]',
    'button[aria-label="Create Alert"]',
    'button[aria-label="Alert"]',
    'button[title="Alert"]',
    '[data-name="alert-button"]',
  ];

  function isVisible(element) {
    if (!element || element.getClientRects().length === 0) return false;
    const style = window.getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) !== 0
    );
  }

  function isVisibleAlertDialog() {
    return Array.from(
      document.querySelectorAll(DIALOG_SELECTORS.join(",")),
    ).some((element) => {
      if (!isVisible(element)) return false;
      const text = `${element.innerText || ""} ${element.getAttribute("aria-label") || ""}`;
      return (
        /create\s+alert|alert\s+settings|condition/i.test(text) ||
        element.matches(DIALOG_SELECTORS.slice(0, 4).join(","))
      );
    });
  }

  function waitForAlertDialog(timeoutMs = 2400) {
    return new Promise((resolve) => {
      const deadline = Date.now() + timeoutMs;
      const check = () => {
        if (isVisibleAlertDialog()) {
          resolve(true);
          return;
        }
        if (Date.now() >= deadline) {
          resolve(false);
          return;
        }
        window.setTimeout(check, 60);
      };
      check();
    });
  }

  function findAlertButton() {
    for (const selector of ALERT_BUTTON_SELECTORS) {
      try {
        const button = document.querySelector(selector);
        if (button && typeof button.click === "function" && isVisible(button)) {
          return button;
        }
      } catch (error) {
        console.warn(
          "ChartMentor: Error querying alert selector",
          selector,
          error,
        );
      }
    }

    return Array.from(
      document.querySelectorAll('button, [role="button"]'),
    ).find((button) => {
      if (!isVisible(button)) return false;
      const label =
        button.getAttribute("aria-label") ||
        button.getAttribute("title") ||
        button.textContent ||
        "";
      return /^alert$/i.test(label.trim());
    });
  }

  function dispatchKey(target, type, options) {
    target.dispatchEvent(
      new KeyboardEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        ...options,
      }),
    );
  }

  function dispatchCreateAlertShortcut() {
    window.focus();

    const previousActiveElement = document.activeElement;
    if (
      previousActiveElement &&
      previousActiveElement !== document.body &&
      typeof previousActiveElement.blur === "function"
    ) {
      previousActiveElement.blur();
    }

    const target = document.body || document.documentElement || document;
    const canManageTabIndex =
      typeof target.hasAttribute === "function" &&
      typeof target.setAttribute === "function" &&
      typeof target.removeAttribute === "function";
    const hadTabIndex = canManageTabIndex && target.hasAttribute("tabindex");

    if (canManageTabIndex && !hadTabIndex) {
      target.setAttribute("tabindex", "-1");
    }
    if (typeof target.focus === "function") {
      target.focus({ preventScroll: true });
    }

    dispatchKey(target, "keydown", {
      key: "Alt",
      code: "AltLeft",
      keyCode: 18,
      which: 18,
      location: 1,
      altKey: true,
    });
    dispatchKey(target, "keydown", {
      key: "a",
      code: "KeyA",
      keyCode: 65,
      which: 65,
      altKey: true,
    });
    dispatchKey(target, "keyup", {
      key: "a",
      code: "KeyA",
      keyCode: 65,
      which: 65,
      altKey: true,
    });
    dispatchKey(target, "keyup", {
      key: "Alt",
      code: "AltLeft",
      keyCode: 18,
      which: 18,
      location: 1,
      altKey: false,
    });

    if (canManageTabIndex && !hadTabIndex) {
      target.removeAttribute("tabindex");
    }
  }

  async function open() {
    if (isVisibleAlertDialog()) return true;

    const alertButton = findAlertButton();
    if (alertButton) {
      alertButton.click();
    } else {
      console.log(
        "ChartMentor: Alert button selector not found, attempting keyboard fallback (Alt+A)",
      );
      dispatchCreateAlertShortcut();
    }

    return waitForAlertDialog();
  }

  window.ChartMentorTradingViewAlert = {
    dispatchCreateAlertShortcut,
    isVisibleAlertDialog,
    open,
    waitForAlertDialog,
  };
})();
