/**
 * @license
 * Copyright (c) 2024-2025 CRX International LLC. All Rights Reserved.
 *
 * ChartMentor - Panel Controller Theme & Layout Operations
 */

function shiftTradingViewLayout() {
  document.documentElement.style.setProperty(
    "width",
    `calc(100% - ${currentPanelWidth}px)`,
    "important",
  );
  document.documentElement.style.setProperty(
    "overflow-x",
    "hidden",
    "important",
  );

  const layoutRoot = document.querySelector(".layout-with-border-radius");
  if (layoutRoot) {
    if (!originalStyles.has(".layout-with-border-radius")) {
      originalStyles.set(".layout-with-border-radius", {
        width: layoutRoot.style.width,
        left: layoutRoot.style.left,
        right: layoutRoot.style.right,
      });
    }
    layoutRoot.style.setProperty("width", "100%", "important");
    layoutRoot.style.setProperty("left", "0", "important");
    layoutRoot.style.setProperty("right", "0", "important");
  }

  const rightSidebar = document.querySelector(".layout__area--right");
  if (rightSidebar) {
    if (!originalStyles.has(".layout__area--right")) {
      originalStyles.set(".layout__area--right", {
        left: rightSidebar.style.left,
        right: rightSidebar.style.right,
      });
    }
    rightSidebar.style.setProperty("left", "auto", "important");
    rightSidebar.style.setProperty("right", "0", "important");
  }

  triggerResize();
  startLayoutObserver();
}

function restoreTradingViewLayout() {
  stopLayoutObserver();

  document.documentElement.style.removeProperty("width");
  document.documentElement.style.removeProperty("overflow-x");

  if (originalStyles.has(".layout-with-border-radius")) {
    const layoutRoot = document.querySelector(".layout-with-border-radius");
    if (layoutRoot) {
      const styles = originalStyles.get(".layout-with-border-radius");
      layoutRoot.style.width = styles.width;
      layoutRoot.style.left = styles.left;
      layoutRoot.style.right = styles.right;
    }
  }

  if (originalStyles.has(".layout__area--right")) {
    const rightSidebar = document.querySelector(".layout__area--right");
    if (rightSidebar) {
      const styles = originalStyles.get(".layout__area--right");
      rightSidebar.style.left = styles.left;
      rightSidebar.style.right = styles.right;
    }
  }

  originalStyles.clear();
  triggerResize();
}

function triggerResize() {
  window.dispatchEvent(new Event("resize"));
  setTimeout(() => window.dispatchEvent(new Event("resize")), 100);
  setTimeout(() => window.dispatchEvent(new Event("resize")), 500);
}

function startLayoutObserver() {
  stopLayoutObserver();

  layoutObserver = new MutationObserver((mutations) => {
    if (!isPanelOpen) return;

    if (
      document.documentElement.style.width !==
      `calc(100% - ${currentPanelWidth}px)`
    ) {
      document.documentElement.style.setProperty(
        "width",
        `calc(100% - ${currentPanelWidth}px)`,
        "important",
      );
      document.documentElement.style.setProperty(
        "overflow-x",
        "hidden",
        "important",
      );
    }
  });

  layoutObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["style"],
  });
}

function stopLayoutObserver() {
  if (layoutObserver) {
    layoutObserver.disconnect();
    layoutObserver = null;
  }
}

function getExplicitThemeFromElement(element) {
  if (!element) return null;

  const className =
    typeof element.className === "string"
      ? element.className
      : element.className?.baseVal || "";
  const themeAttrs = [
    element.getAttribute?.("data-theme"),
    element.getAttribute?.("data-color-theme"),
    element.getAttribute?.("theme"),
    className,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\b(theme-)?dark\b/.test(themeAttrs)) return "dark";
  if (/\b(theme-)?light\b/.test(themeAttrs)) return "light";
  return null;
}

function parseRgbColor(color) {
  if (!color || color === "transparent") return null;

  const match = color.match(/rgba?\(([^)]+)\)/i);
  if (!match) return null;

  const values = match[1]
    .split(",")
    .map((value) => Number.parseFloat(value.trim()));
  const [red, green, blue, alpha = 1] = values;
  if (![red, green, blue].every(Number.isFinite) || alpha === 0) return null;

  return { red, green, blue };
}

function getColorLuminance({ red, green, blue }) {
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
}

function inferThemeFromBackground() {
  const candidates = [
    document.documentElement,
    document.body,
    document.querySelector(".chart-gui-wrapper"),
    document.querySelector(".layout__area--center"),
    document.querySelector(".chart-container"),
    document.querySelector('[class*="chart-container"]'),
  ].filter(Boolean);

  for (const element of candidates) {
    const backgroundColor = window.getComputedStyle(element).backgroundColor;
    const rgb = parseRgbColor(backgroundColor);
    if (!rgb) continue;

    return getColorLuminance(rgb) < 0.5 ? "dark" : "light";
  }

  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function detectTradingViewTheme() {
  const explicitTheme =
    getExplicitThemeFromElement(document.documentElement) ||
    getExplicitThemeFromElement(document.body) ||
    getExplicitThemeFromElement(
      document.querySelector(
        '.theme-dark, .theme-light, [data-theme="dark"], [data-theme="light"], [data-color-theme="dark"], [data-color-theme="light"]',
      ),
    );

  return explicitTheme || inferThemeFromBackground();
}

function syncTheme() {
  const theme = detectTradingViewTheme();
  sendToPanel({ type: "updateTheme", data: { theme } });

  if (!themeObserver) {
    startThemeObserver();
  }
}

function startThemeObserver() {
  themeObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (
        mutation.type === "attributes" &&
        ["class", "data-theme", "data-color-theme", "theme", "style"].includes(
          mutation.attributeName,
        )
      ) {
        syncTheme();
      }
    });
  });

  const observeOptions = {
    attributes: true,
    attributeFilter: [
      "class",
      "data-theme",
      "data-color-theme",
      "theme",
      "style",
    ],
  };

  themeObserver.observe(document.documentElement, observeOptions);
  if (document.body) {
    themeObserver.observe(document.body, observeOptions);
  }
}
