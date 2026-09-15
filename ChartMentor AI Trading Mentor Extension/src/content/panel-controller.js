/**
 * @license
 * Copyright (c) 2024-2025 CRX International LLC. All Rights Reserved.
 *
 * This code is licensed under a commercial license.
 * See the LICENSE.md file for details.
 *
 * ChartMentor v2.0 - Panel Controller
 * Manages panel state, injection, and communication
 */

// Panel state
let panelContainer = null;
let panelIframe = null;
let isPanelOpen = false;
let isPanelCollapsed = true;
let layoutObserver = null;
let themeObserver = null;
let originalStyles = new Map();
let currentPanelWidth = 380;
let isResizing = false;
let panelAnimationTimeout = null;
let isPanelIframeReady = false;
let panelReadyFallbackTimeout = null;
let pendingPanelMessages = [];
let captureState = "idle";
let panelMessageToken = null;

const PANEL_ANIMATION_MS = 240;
const PANEL_READY_DELAY_MS = 0;
const PANEL_READY_FALLBACK_MS = 450;
const MAX_PENDING_PANEL_MESSAGES = 5;
const CHART_READY_TIMEOUT_MS = 6500;
const CHART_READY_POLL_MS = 200;
const CAPTURE_CONTROLS_FADE_MS = 80;
const CAPTURE_PANEL_OUT_MS = PANEL_ANIMATION_MS;
const PANEL_RESPONSE_MESSAGE_TYPES = new Set([
  "screenshotCaptured",
  "screenshotError",
  "apiResponse",
]);

const isPanelVisible = () =>
  Boolean(
    isPanelOpen &&
    !isPanelCollapsed &&
    panelContainer &&
    panelContainer.style.display !== "none",
  );
const isPanelReady = () =>
  Boolean(
    isPanelIframeReady && isPanelIframeMounted() && panelIframe.contentWindow,
  );
const isChartReady = () => hasReadyTradingViewChart();

function getReadinessState() {
  ensurePanelIframeMounted();

  if (!isPanelReady()) {
    return {
      ready: false,
      reason: "panel_loading",
      label: "Starting ChartMentor...",
    };
  }

  if (!isChartReady()) {
    return {
      ready: false,
      reason: "chart_loading",
      label: "Waiting for the chart...",
    };
  }

  return {
    ready: true,
    reason: "ready",
    label: "Ready",
  };
}

function showPanel() {
  if (!panelContainer) return;

  ensurePanelIframeMounted();

  clearPanelAnimationTimeout();
  isPanelCollapsed = false;
  panelContainer.style.display = "block";
  applyPanelWidth();
  setPanelSurfaceVisible(false);
  panelContainer.classList.add("collapsed");
  setPanelAnimatingState(null);
  panelContainer.getBoundingClientRect();
  document.body.classList.remove("chartmentor-panel-transitioning");
  document.body.classList.add("chartmentor-panel-open");
  shiftTradingViewLayout();
  syncTheme();

  const reduceMotion = prefersReducedPanelMotion();
  panelContainer.classList.remove("collapsed");
  setPanelAnimatingState(reduceMotion ? "is-open" : "is-opening");
  setPanelSurfaceVisible(true);
  sendToPanel({ type: "panelVisibilityChanged", data: { visible: true } });

  if (reduceMotion) return;

  panelAnimationTimeout = setTimeout(() => {
    panelAnimationTimeout = null;
    if (!panelContainer || isPanelCollapsed) return;
    setPanelAnimatingState("is-open");
  }, PANEL_ANIMATION_MS);
}

function hidePanel({ keepOpenState = false } = {}) {
  if (!panelContainer) return;

  clearPanelAnimationTimeout();
  isPanelCollapsed = true;
  sendToPanel({ type: "panelVisibilityChanged", data: { visible: false } });

  const reduceMotion = prefersReducedPanelMotion();

  if (reduceMotion) {
    panelContainer.classList.add("collapsed");
    setPanelAnimatingState(null);
    setPanelSurfaceVisible(false);
    document.body.classList.remove("chartmentor-panel-open");
    document.body.classList.remove("chartmentor-panel-transitioning");
    restoreTradingViewLayout();
    if (!keepOpenState) {
      panelContainer.style.display = "none";
    }
    return;
  }

  setPanelAnimatingState("is-closing");
  panelContainer.style.opacity = "1";
  panelContainer.style.transform = "translateX(100%)";
  document.body.classList.remove("chartmentor-panel-open");
  document.body.classList.add("chartmentor-panel-transitioning");
  restoreTradingViewLayout();

  const finishClose = () => {
    if (!panelContainer || !isPanelCollapsed) return;
    panelContainer.classList.add("collapsed");
    setPanelAnimatingState(null);
    setPanelSurfaceVisible(false);
    document.body.classList.remove("chartmentor-panel-transitioning");
    if (!keepOpenState) {
      panelContainer.style.display = "none";
    }
  };

  panelAnimationTimeout = setTimeout(() => {
    panelAnimationTimeout = null;
    finishClose();
  }, PANEL_ANIMATION_MS);
}

function getPanelReadyDelay() {
  return prefersReducedPanelMotion() ? 0 : PANEL_READY_DELAY_MS;
}

function ensurePanelOpen() {
  if (!panelContainer) {
    createPanel();
  }

  if (isPanelOpen && !isPanelCollapsed) return;

  isPanelOpen = true;
  showPanel();
  savePanelState();
  console.log("ChartMentor: Panel opened for analysis");
}

function createPanel() {
  if (panelContainer) return;

  isPanelIframeReady = false;
  panelMessageToken = createPanelMessageToken();
  pendingPanelMessages = [];
  clearPanelReadyFallbackTimeout();

  panelContainer = document.createElement("div");
  panelContainer.id = "chartmentor-panel-container";
  panelContainer.className = "chartmentor-panel collapsed";

  const frameHost = createPanelFrameHost();
  panelIframe = createPanelIframeElement();
  if (!panelIframe || !mountPanelIframe(panelIframe)) {
    resetPanelFrameReferences();
    panelContainer = null;
    return;
  }

  panelContainer.appendChild(frameHost);

  const resizeHandle = document.createElement("div");
  resizeHandle.id = "chartmentor-resize-handle";
  panelContainer.appendChild(resizeHandle);

  initResizing(resizeHandle);
  document.body.appendChild(panelContainer);
  startPanelDomWatchdog();
  loadPanelState();

  console.log("ChartMentor: Panel created");
}

function togglePanel() {
  if (!panelContainer) {
    createPanel();
  }

  isPanelOpen = !isPanelOpen;

  if (isPanelOpen) {
    showPanel();
    console.log("ChartMentor: Panel opened, layout shifted via JS");
  } else {
    hidePanel();
    console.log("ChartMentor: Panel closed, layout restored");
  }

  savePanelState();
}

function toggleCollapse() {
  if (!isPanelOpen) {
    togglePanel();
    return;
  }

  isPanelCollapsed = !isPanelCollapsed;

  if (isPanelCollapsed) {
    hidePanel({ keepOpenState: true });
  } else {
    showPanel();
  }

  savePanelState();
}

function updateToggleButton() {
  const toggleBtn = document.getElementById("chartmentor-panel-toggle");
  if (!toggleBtn) return;

  if (isPanelCollapsed) {
    toggleBtn.textContent = "<";
    toggleBtn.title = "Expand panel";
  } else {
    toggleBtn.textContent = ">";
    toggleBtn.title = "Collapse panel";
  }
}

async function savePanelState() {
  await ChartMentorStorage.setPanelState({
    open: isPanelOpen,
    collapsed: isPanelCollapsed,
    width: currentPanelWidth,
  });
}

async function loadPanelState() {
  const state = await ChartMentorStorage.getPanelState();
  isPanelOpen = state.open;
  isPanelCollapsed = state.collapsed;

  const savedWidth = await ChartMentorStorage.getPanelWidth();
  if (savedWidth) {
    currentPanelWidth = Math.min(
      Math.max(savedWidth, CHARTMENTOR_CONFIG.MIN_PANEL_WIDTH),
      CHARTMENTOR_CONFIG.MAX_PANEL_WIDTH,
    );
  }

  applyPanelWidth();

  if (isPanelOpen && panelContainer) {
    panelContainer.style.display = "block";
    if (!isPanelCollapsed) {
      showPanel();
    } else {
      hidePanel({ keepOpenState: true });
    }
  }
}

function openPanel() {
  if (isPanelOpen) return;
  togglePanel();
}

function initResizing(handle) {
  handle.addEventListener("mousedown", (e) => {
    isResizing = true;
    document.body.classList.add("chartmentor-resizing");
    panelContainer.classList.add("is-resizing");
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!isResizing) return;

    const newWidth = window.innerWidth - e.clientX;
    const clampedWidth = Math.min(
      Math.max(newWidth, CHARTMENTOR_CONFIG.MIN_PANEL_WIDTH),
      CHARTMENTOR_CONFIG.MAX_PANEL_WIDTH,
    );

    currentPanelWidth = clampedWidth;
    applyPanelWidth();
    shiftTradingViewLayout();
  });

  window.addEventListener("mouseup", () => {
    if (!isResizing) return;
    isResizing = false;
    document.body.classList.remove("chartmentor-resizing");
    panelContainer.classList.remove("is-resizing");

    ChartMentorStorage.setPanelWidth(currentPanelWidth);
    savePanelState();
  });
}

function sendToPanel(message) {
  ensurePanelIframeMounted();

  if (!panelIframe || !panelIframe.contentWindow) {
    queuePanelMessage(message);
    return;
  }

  if (!isPanelIframeMounted()) {
    queuePanelMessage(message);
    return;
  }

  if (!isPanelIframeReady && !PANEL_RESPONSE_MESSAGE_TYPES.has(message.type)) {
    queuePanelMessage(message);
    return;
  }

  postMessageToPanel(message);
}
window.addEventListener("message", (event) => {
  if (!isTrustedPanelMessage(event)) return;

  const { type, payload } = event.data;

  switch (type) {
    case "panelReady":
      markPanelReady();
      break;

    case "toggleCollapse":
      toggleCollapse();
      break;

    case "closePanel":
      togglePanel();
      break;
    case "captureScreenshot":
      setTimeout(() => {
        captureTradingViewScreenshot()
          .then((result) => {
            sendToPanel({
              type: "screenshotCaptured",
              requestId: payload?.requestId || null,
              screenshot: result?.dataUrl || result,
              captureMetadata: result?.captureMetadata || null,
            });
          })
          .catch((error) => {
            console.error("ChartMentor: Screenshot capture failed:", error);
            sendToPanel({
              type: "screenshotError",
              requestId: payload?.requestId || null,
              error: error.message,
            });
          });
      }, 50);
      break;
    case "apiRequest":
      try {
        if (chrome.runtime && chrome.runtime.id) {
          chrome.runtime.sendMessage(payload, (response) => {
            if (chrome.runtime.lastError) {
              console.log("ChartMentor: Extension context invalidated");
              sendToPanel({
                type: "apiResponse",
                requestId: payload.requestId,
                response: {
                  success: false,
                  error: "Extension updated. Please refresh the page.",
                },
              });
              return;
            }
            sendToPanel({
              type: "apiResponse",
              requestId: payload.requestId,
              response,
            });
          });
        } else {
          sendToPanel({
            type: "apiResponse",
            requestId: payload.requestId,
            response: { success: false, error: "Extension not available" },
          });
        }
      } catch (e) {
        console.log("ChartMentor: Extension context invalidated in apiRequest");
        sendToPanel({
          type: "apiResponse",
          requestId: payload.requestId,
          response: {
            success: false,
            error: "Extension context invalidated. Please refresh the page.",
          },
        });
      }
      break;

    case "openWatchlistChart":
      window.ChartMentorTradingViewNavigation.handleOpenRequest(payload, sendToPanel);
      break;
    case "openTradingViewAlert": {
      window.ChartMentorTradingViewAlert.open()
        .then(async (opened) => {
          const fillResult =
            opened && window.ChartMentorAlertAutofill
              ? await window.ChartMentorAlertAutofill.fillVisibleDialog(
                  payload?.level,
                )
              : { filled: false };
          sendToPanel({
            type: "alertDialogOpened",
            requestId: payload?.requestId || null,
            success: opened,
            filled: fillResult.filled === true,
          });
        })
        .catch((error) => {
          console.warn("ChartMentor: Alert dialog check failed", error);
          sendToPanel({
            type: "alertDialogOpened",
            requestId: payload?.requestId || null,
            success: false,
            filled: false,
          });
        });
      break;
    }
  }
});

// Make functions available globally
window.ChartMentorPanelController = {
  createPanel,
  togglePanel,
  openPanel,
  ensurePanelOpen,
  isPanelVisible,
  isPanelReady,
  isChartReady,
  getReadinessState,
  toggleCollapse,
  getPanelReadyDelay,
  sendToPanel,
  syncTheme,
  compressScreenshot,
  captureTradingViewScreenshot,
};
