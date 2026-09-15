/**
 * @license
 * Copyright (c) 2024-2025 CRX International LLC. All Rights Reserved.
 *
 * ChartMentor - Panel Controller Utilities & Message Queue
 */

function getExtensionOrigin() {
  try {
    return new URL(chrome.runtime.getURL("")).origin;
  } catch (e) {
    return null;
  }
}

function isTrustedPanelMessage(event) {
  if (!panelIframe || event.source !== panelIframe.contentWindow) return false;

  const extensionOrigin = getExtensionOrigin();
  if (!extensionOrigin || event.origin !== extensionOrigin) return false;

  return Boolean(
    event.data &&
    event.data.source === "chartmentor-panel" &&
    event.data.panelToken &&
    event.data.panelToken === panelMessageToken,
  );
}

function applyPanelWidth() {
  if (!panelContainer) return;
  panelContainer.style.width = `${currentPanelWidth}px`;
}

function prefersReducedPanelMotion() {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

function clearPanelAnimationTimeout() {
  if (!panelAnimationTimeout) return;
  clearTimeout(panelAnimationTimeout);
  panelAnimationTimeout = null;
}

function clearPanelReadyFallbackTimeout() {
  if (!panelReadyFallbackTimeout) return;
  clearTimeout(panelReadyFallbackTimeout);
  panelReadyFallbackTimeout = null;
}

function postMessageToPanel(message) {
  if (!panelIframe || !panelIframe.contentWindow) return false;

  try {
    const targetOrigin = chrome.runtime.getURL("").slice(0, -1);
    panelIframe.contentWindow.postMessage(
      {
        source: "chartmentor-content",
        ...message,
        panelToken: panelMessageToken,
      },
      targetOrigin,
    );
    return true;
  } catch (e) {
    if (e.message && e.message.includes("context invalidated")) {
      console.error("ChartMentor: Context invalidated in sendToPanel");
      if (window.showContextInvalidationToast)
        window.showContextInvalidationToast();
    }
    return false;
  }
}

function markPanelReady() {
  if (isPanelIframeReady) return;
  isPanelIframeReady = true;
  clearPanelReadyFallbackTimeout();

  const messagesToFlush = pendingPanelMessages;
  pendingPanelMessages = [];
  messagesToFlush.forEach((message) => postMessageToPanel(message));
}

function queuePanelMessage(message) {
  if (
    message.type === "triggerAnalysis" ||
    message.type === "extensionReadiness"
  ) {
    pendingPanelMessages = pendingPanelMessages.filter(
      (queuedMessage) => queuedMessage.type !== message.type,
    );
  }

  pendingPanelMessages = pendingPanelMessages.slice(
    -(MAX_PENDING_PANEL_MESSAGES - 1),
  );
  pendingPanelMessages.push(message);
}

function setPanelAnimatingState(state) {
  if (!panelContainer) return;
  panelContainer.classList.remove("is-opening", "is-open", "is-closing");
  if (state) {
    panelContainer.classList.add(state);
  }
}

function setPanelSurfaceVisible(visible) {
  if (!panelContainer) return;
  panelContainer.style.opacity = visible ? "1" : "0";
  panelContainer.style.transform = visible
    ? "translateX(0)"
    : "translateX(100%)";
}

function setCaptureState(nextState) {
  captureState = nextState;
  if (!document.body) return;

  if (nextState === "idle") {
    document.body.classList.remove("chartmentor-capture-mode");
    delete document.body.dataset.chartmentorCaptureState;
    return;
  }

  document.body.classList.add("chartmentor-capture-mode");
  document.body.dataset.chartmentorCaptureState = nextState;
}
