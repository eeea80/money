/**
 * @license
 * Copyright (c) 2024-2025 CRX International LLC. All Rights Reserved.
 *
 * ChartMentor - Content Script DOM Operations
 */

const TOOLBAR_ANALYZE_READY_HTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M12 6v6l4 2"></path>
    </svg>
    Scan
  `;
const TOOLBAR_SCAN_READY_HTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M12 6v6l4 2"></path>
    </svg>
    Scan
  `;
const TOOLBAR_ANALYZE_LOADING_HTML = `
    <svg class="chartmentor-status-clock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"></circle>
      <polyline points="12 6 12 12 16 14"></polyline>
    </svg>
    Preparing...
  `;
const TOOLBAR_ANALYZE_BUSY_HTML = `
    <svg class="chartmentor-status-clock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"></circle>
      <polyline points="12 6 12 12 16 14"></polyline>
    </svg>
    Capturing...
  `;
const QUICK_ANALYZE_READY_HTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M12 6v6l4 2"></path>
    </svg>
    Scan
  `;
const QUICK_SCAN_READY_HTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M12 6v6l4 2"></path>
    </svg>
    Scan
  `;
const QUICK_ANALYZE_LOADING_HTML = `
    <svg class="chartmentor-status-clock" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"></circle>
      <polyline points="12 6 12 12 16 14"></polyline>
    </svg>
    Preparing...
  `;
const QUICK_ANALYZE_BUSY_HTML = `
    <svg class="chartmentor-status-clock" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"></circle>
      <polyline points="12 6 12 12 16 14"></polyline>
    </svg>
    Capturing...
  `;
const READINESS_CHECK_INTERVAL_MS = 300;
let readinessIntervalId = null;
let externalReviewMode = "signal_generator";

// Single source of truth for the toolbar selectors: used by both the
// initial lookup (waitForToolbar) and the SPA-mutation repair observer
// (setupToolbarObserver) so they can never drift apart and silently miss
// a toolbar element TradingView re-renders under one of these matches.
const TOOLBAR_SELECTORS = [
  ".toolbar-S4V6J1lT",
  '[data-name="toolbar"]',
  ".chart-toolbar",
];

function findToolbarElement() {
  for (const selector of TOOLBAR_SELECTORS) {
    const toolbar = document.querySelector(selector);
    if (toolbar) return toolbar;
  }
  return null;
}

let toolbarObserverInstalled = false;

function waitForToolbar() {
  // Install the mutation-observer-based repair/discovery unconditionally
  // and immediately, rather than only after this promise resolves: if
  // the toolbar takes longer than the ~30s polling window below (or is
  // later swapped out by a TradingView SPA navigation), the observer is
  // still in place to find it and inject the button. setupToolbarObserver
  // guards against a duplicate install when its own success path below
  // also calls it.
  setupToolbarObserver();
  return new Promise((resolve) => {
    let attempts = 0;
    const checkToolbar = () => {
      attempts++;
      const toolbar = findToolbarElement();

      if (toolbar && toolbar.isConnected) {
        resolve(toolbar);
      } else if (attempts < 60) {
        setTimeout(checkToolbar, 500);
      }
    };
    checkToolbar();
  });
}

function setupToolbarObserver() {
  if (toolbarObserverInstalled) return;
  toolbarObserverInstalled = true;

  const target = document.documentElement || document.body;
  let debounceTimer = null;

  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const toolbar = findToolbarElement();
      if (toolbar && !document.getElementById("chartmentor-toolbar-btn")) {
        injectAnalyzeButton(toolbar);
      }
    }, 200);
  });
  observer.observe(target, { childList: true, subtree: true });
}

function showContextInvalidationToast() {
  if (document.getElementById("chartmentor-invalidation-toast")) return;

  const toast = document.createElement("div");
  toast.id = "chartmentor-invalidation-toast";
  toast.textContent =
    "ChartMentor needs a quick refresh to update. Please reload the page.";
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #1E3A8A;
    color: white;
    padding: 12px 16px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    z-index: 1000000;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    border-left: 4px solid #06B6D4;
    max-width: 300px;
    cursor: pointer;
  `;
  toast.onclick = () => window.location.reload();
  document.body.appendChild(toast);
}

function normalizeExternalReviewMode(mode) {
  return "signal_generator";
}

function getExternalReviewModeReadyHtml(control) {
  if (control?.id === "chartmentor-quick-analyze") {
    return QUICK_SCAN_READY_HTML;
  }
  return TOOLBAR_SCAN_READY_HTML;
}

function getExternalAnalyzeTitle() {
  return "Review a trade plan with ChartMentor";
}

async function refreshExternalReviewModeFromStorage() {
  try {
    const result = await chrome.storage.local.get(["settings"]);
    externalReviewMode = normalizeExternalReviewMode(
      result.settings?.reviewMode,
    );
    updateExternalAnalyzeControls();
  } catch (error) {
    console.warn("ChartMentor: Failed to sync external review mode", error);
  }
}

function setupExternalReviewModeSync() {
  refreshExternalReviewModeFromStorage();
  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes.settings) return;
      externalReviewMode = normalizeExternalReviewMode(
        changes.settings.newValue?.reviewMode,
      );
      updateExternalAnalyzeControls();
    });
  } catch (error) {
    console.warn(
      "ChartMentor: Failed to listen for review mode changes",
      error,
    );
  }
}

function getExtensionReadinessState() {
  const readiness = window.ChartMentorPanelController?.getReadinessState?.();
  return (
    readiness || {
      ready: false,
      reason: "extension_loading",
      label: "Preparing...",
    }
  );
}

function isExtensionReadyForAnalysis() {
  return getExtensionReadinessState().ready === true;
}

function setExternalAnalyzeControlReady(control, readiness) {
  if (!control || control.dataset.chartmentorBusy === "true") return;

  const isReady = readiness.ready === true;
  control.classList.toggle("is-extension-loading", !isReady);
  control.setAttribute("aria-disabled", String(!isReady));
  control.title = isReady
    ? getExternalAnalyzeTitle()
    : readiness.label || "Preparing ChartMentor...";
  control.innerHTML = isReady
    ? getExternalReviewModeReadyHtml(control)
    : control.dataset.chartmentorLoadingHtml || "Preparing...";

  if ("disabled" in control) {
    control.disabled = !isReady;
  }
}

function isControlEnabledForAnalysis(control) {
  if (!control) return false;
  if (control.dataset.chartmentorBusy === "true") return false;
  if (control.classList.contains("is-extension-loading")) return false;
  if ("disabled" in control && control.disabled) return false;
  return control.getAttribute("aria-disabled") !== "true";
}

function updateExternalAnalyzeControls() {
  const readiness = getExtensionReadinessState();
  const controls = [
    document.getElementById("chartmentor-toolbar-btn"),
    document.getElementById("chartmentor-quick-analyze"),
  ];

  controls.forEach((control) =>
    setExternalAnalyzeControlReady(control, readiness),
  );

  // Keep the specific blocking reason instead of flattening it to a generic
  // label: the panel derives its own wording from the reason, and a stuck
  // toolbar is otherwise impossible to tell apart from a stuck iframe.
  const readinessForPanel =
    readiness.ready === true && controls.some(isControlEnabledForAnalysis)
      ? readiness
      : {
          ready: false,
          reason:
            readiness.reason === "ready"
              ? "controls_loading"
              : readiness.reason,
          label:
            readiness.reason === "ready"
              ? "Waiting for the TradingView toolbar..."
              : readiness.label || "Preparing...",
        };

  window.ChartMentorPanelController?.sendToPanel?.({
    type: "extensionReadiness",
    data: readinessForPanel,
  });
}

function startReadinessMonitor() {
  if (readinessIntervalId) return;

  updateExternalAnalyzeControls();
  readinessIntervalId = setInterval(
    updateExternalAnalyzeControls,
    READINESS_CHECK_INTERVAL_MS,
  );
}

function setAnalyzeControlBusy(control, busy, busyHtml, originalHtml) {
  if (!control) return;

  if (busy) {
    control.dataset.chartmentorBusy = "true";
    control.setAttribute("aria-busy", "true");
    if ("disabled" in control) {
      control.disabled = true;
    }
    control.style.opacity = "0.72";
    control.innerHTML = busyHtml;
    return;
  }

  delete control.dataset.chartmentorBusy;
  control.removeAttribute("aria-busy");
  if ("disabled" in control) {
    control.disabled = false;
  }
  control.style.opacity = "1";
  control.innerHTML = originalHtml;
  updateExternalAnalyzeControls();
}

function injectAnalyzeButton(toolbar) {
  if (document.getElementById("chartmentor-toolbar-btn")) return;

  const btn = document.createElement("button");
  btn.id = "chartmentor-toolbar-btn";
  btn.dataset.chartmentorReadyHtml = TOOLBAR_ANALYZE_READY_HTML;
  btn.dataset.chartmentorLoadingHtml = TOOLBAR_ANALYZE_LOADING_HTML;
  btn.innerHTML = TOOLBAR_ANALYZE_LOADING_HTML;

  btn.addEventListener("click", async () => {
    console.log("ChartMentor: Analyze button clicked");
    await triggerAnalysisFromExternalControl(btn, TOOLBAR_ANALYZE_BUSY_HTML);
  });

  const targetElement = toolbar.querySelector(".button") || toolbar.firstChild;
  if (targetElement) {
    toolbar.insertBefore(btn, targetElement.nextSibling);
  } else {
    toolbar.appendChild(btn);
  }

  updateExternalAnalyzeControls();
  console.log("ChartMentor: Analyze button injected");
}

function injectBottomToggle() {
  if (document.getElementById("chartmentor-bottom-bar")) return;

  const bar = document.createElement("div");
  bar.id = "chartmentor-bottom-bar";

  const toggle = document.createElement("div");
  toggle.id = "chartmentor-bottom-toggle";
  toggle.className = "chartmentor-bar-btn collapsed";
  toggle.innerHTML = "Show ChartMentor";

  toggle.addEventListener("click", () => {
    if (window.ChartMentorPanelController) {
      window.ChartMentorPanelController.togglePanel();
    }
  });

  const quickBtn = document.createElement("div");
  quickBtn.id = "chartmentor-quick-analyze";
  quickBtn.className = "chartmentor-bar-btn";
  quickBtn.dataset.chartmentorReadyHtml = QUICK_ANALYZE_READY_HTML;
  quickBtn.dataset.chartmentorLoadingHtml = QUICK_ANALYZE_LOADING_HTML;
  quickBtn.innerHTML = QUICK_ANALYZE_LOADING_HTML;

  quickBtn.addEventListener("click", async () => {
    console.log("ChartMentor: Quick Analyze clicked");
    await triggerAnalysisFromExternalControl(quickBtn, QUICK_ANALYZE_BUSY_HTML);
  });

  bar.appendChild(toggle);
  bar.appendChild(quickBtn);
  document.body.appendChild(bar);
  updateExternalAnalyzeControls();

  const stateInterval = setInterval(async () => {
    try {
      if (
        typeof chrome === "undefined" ||
        !chrome.runtime ||
        !chrome.runtime.id
      ) {
        clearInterval(stateInterval);
        return;
      }

      const state = await ChartMentorStorage.getPanelState();
      const toggleBtn = document.getElementById("chartmentor-bottom-toggle");
      if (!toggleBtn) return;

      if (state.open && !state.collapsed) {
        toggleBtn.classList.remove("collapsed");
        toggleBtn.innerHTML = "Hide ChartMentor";
      } else {
        toggleBtn.classList.add("collapsed");
        toggleBtn.innerHTML = "Show ChartMentor";
      }
    } catch (e) {
      clearInterval(stateInterval);
    }
  }, 1000);
  console.log("ChartMentor: Bottom toggle injected");

  window.addEventListener("pagehide", () => clearInterval(stateInterval), {
    once: true,
  });
}
