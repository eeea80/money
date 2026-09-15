/**
 * @license
 * Copyright (c) 2024-2025 CRX International LLC. All Rights Reserved.
 *
 * ChartMentor - Isolated panel frame lifecycle
 */

let panelFrameHost = null;
let panelFrameRoot = null;
let isPanelIframeRepairing = false;
let lastPanelIframeRepairAt = 0;
let panelTabScope = null;
let panelTabScopePromise = null;
// Set once the first iframe has completed its handshake. Any handshake after
// that point means the iframe was torn down and rebuilt mid-session (see
// ensurePanelIframeMounted below) rather than a normal first open, so the
// panel side knows to restore whatever view was showing instead of
// resetting to its default idle state.
let hasPanelIframeBootedBefore = false;

const PANEL_IFRAME_REPAIR_RETRY_MS = 1000;
const PANEL_HANDSHAKE_RETRY_MS = 750;
const PANEL_HANDSHAKE_MAX_RETRIES = 12;

function getPanelTabScope() {
  if (panelTabScope) return Promise.resolve(panelTabScope);
  if (panelTabScopePromise) return panelTabScopePromise;

  panelTabScopePromise = new Promise((resolve) => {
    const finish = (scope) => {
      panelTabScope = /^tab-\d{1,12}$/.test(scope || "") ? scope : null;
      if (!panelTabScope) panelTabScopePromise = null;
      resolve(panelTabScope);
    };
    try {
      chrome.runtime.sendMessage({ type: "getPanelTabScope" }, (response) => {
        if (chrome.runtime.lastError) {
          console.debug(
            "ChartMentor: Panel tab scope unavailable",
            chrome.runtime.lastError.message,
          );
          finish(null);
          return;
        }
        finish(response?.panelTabScope);
      });
    } catch (error) {
      console.debug("ChartMentor: Failed to resolve panel tab scope", error);
      finish(null);
    }
  });
  return panelTabScopePromise;
}

function createPanelMessageToken() {
  try {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  } catch (error) {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function schedulePanelHandshake(iframe, isRecovery, attempt = 0) {
  void getPanelTabScope().then((resolvedPanelTabScope) => {
    if (iframe !== panelIframe || !isPanelIframeMounted()) return;
    postMessageToPanel({
      type: "panelHandshake",
      isRecovery,
      panelTabScope: resolvedPanelTabScope,
    });
    if (isPanelIframeReady || attempt >= PANEL_HANDSHAKE_MAX_RETRIES) return;
    clearPanelReadyFallbackTimeout();
    panelReadyFallbackTimeout = setTimeout(
      () => schedulePanelHandshake(iframe, isRecovery, attempt + 1),
      PANEL_HANDSHAKE_RETRY_MS,
    );
  });
}

function createPanelFrameHost() {
  const host = document.createElement("div");
  host.id = "chartmentor-panel-frame-host";
  panelFrameHost = host;
  panelFrameRoot = host.attachShadow({ mode: "closed" });
  return host;
}

function isPanelIframeMounted() {
  return Boolean(
    panelIframe &&
    panelFrameRoot &&
    panelIframe.parentNode === panelFrameRoot &&
    panelIframe.isConnected,
  );
}

function createPanelIframeElement() {
  const iframe = document.createElement("iframe");
  iframe.id = "chartmentor-panel-iframe";

  try {
    iframe.src = chrome.runtime.getURL("src/ui/panel/panel.html");
  } catch (error) {
    console.error("ChartMentor: Failed to get panel URL (context invalidated)");
    window.showContextInvalidationToast?.();
    return null;
  }

  iframe.addEventListener("load", () => {
    if (iframe !== panelIframe || !isPanelIframeMounted()) return;
    isPanelIframeRepairing = false;
    syncTheme();
    clearPanelReadyFallbackTimeout();
    const isRecovery = hasPanelIframeBootedBefore;
    hasPanelIframeBootedBefore = true;
    schedulePanelHandshake(iframe, isRecovery);
  });
  iframe.style.cssText =
    "display: block; width: 100%; height: 100%; border: 0;";
  return iframe;
}

function mountPanelIframe(iframe) {
  if (!panelFrameRoot || !iframe) return false;
  panelFrameRoot.replaceChildren(iframe);
  return iframe.parentNode === panelFrameRoot;
}

function ensurePanelIframeMounted() {
  if (!panelContainer || !panelFrameRoot) return false;

  // TradingView's own SPA DOM management occasionally detaches
  // panelContainer from document.body (e.g. during a symbol/timeframe
  // switch or other chart re-render) without touching any of our own object
  // references - panelContainer, panelFrameHost, panelFrameRoot and
  // panelIframe are all still the same objects, just disconnected. Simply
  // re-appending the same container restores the connection and preserves
  // the iframe's browsing context (and therefore all in-memory panel/scan
  // state), so this must be tried before ever tearing down and recreating
  // the iframe - that's a fresh JS context and wipes that state.
  if (!document.body.contains(panelContainer)) {
    document.body.appendChild(panelContainer);
  }

  if (isPanelIframeMounted()) return true;

  // Primitive-typed logging so the values are readable in any console reader
  // (an object dump collapses to "Object" in some tooling). Log each field on
  // its own line rather than passing an object.
  console.warn("ChartMentor DEBUG: mount check failed at", Date.now());
  console.warn("ChartMentor DEBUG: hasPanelIframe =", Boolean(panelIframe));
  console.warn(
    "ChartMentor DEBUG: iframeIsConnected =",
    panelIframe ? panelIframe.isConnected : null,
  );
  console.warn(
    "ChartMentor DEBUG: iframeParentIsFrameRoot =",
    panelIframe ? panelIframe.parentNode === panelFrameRoot : null,
  );
  console.warn(
    "ChartMentor DEBUG: iframeParentNodeName =",
    panelIframe?.parentNode ? panelIframe.parentNode.nodeName : null,
  );
  console.warn(
    "ChartMentor DEBUG: containerIsConnected =",
    panelContainer.isConnected,
  );
  console.warn(
    "ChartMentor DEBUG: frameHostIsConnected =",
    panelFrameHost ? panelFrameHost.isConnected : null,
  );
  console.warn(
    "ChartMentor DEBUG: frameHostParentNodeName =",
    panelFrameHost?.parentNode ? panelFrameHost.parentNode.nodeName : null,
  );
  console.warn(
    "ChartMentor DEBUG: bodyContainsContainer =",
    document.body.contains(panelContainer),
  );
  console.warn(
    "ChartMentor DEBUG: containerContainsFrameHost =",
    panelFrameHost ? panelContainer.contains(panelFrameHost) : null,
  );

  const now = Date.now();
  if (
    isPanelIframeRepairing ||
    now - lastPanelIframeRepairAt < PANEL_IFRAME_REPAIR_RETRY_MS
  ) {
    return false;
  }

  isPanelIframeRepairing = true;
  lastPanelIframeRepairAt = now;
  isPanelIframeReady = false;
  clearPanelReadyFallbackTimeout();

  const nextIframe = createPanelIframeElement();
  const previousIframe = panelIframe;
  panelIframe = nextIframe;
  if (!nextIframe || !mountPanelIframe(nextIframe)) {
    panelIframe = previousIframe;
    isPanelIframeRepairing = false;
    return false;
  }

  window.setTimeout(() => {
    if (panelIframe === nextIframe) isPanelIframeRepairing = false;
  }, PANEL_IFRAME_REPAIR_RETRY_MS);
  console.warn(
    "ChartMentor: Panel iframe was recreated inside its isolated host",
  );
  return true;
}

function resetPanelFrameReferences() {
  panelFrameHost = null;
  panelFrameRoot = null;
}

let panelDomWatchdogObservers = [];

// Diagnostic + reactive watchdog: instead of only finding out a link in the
// body -> panelContainer -> panelFrameHost -> (shadow root) -> panelIframe
// chain broke whenever the next READINESS_CHECK_INTERVAL_MS poll happens,
// observe each link directly so (a) a human/agent reading the console can see
// exactly which link breaks and when, and (b) repair can be triggered the
// moment it happens instead of waiting for the next poll tick.
function startPanelDomWatchdog() {
  stopPanelDomWatchdog();
  if (!panelContainer || !panelFrameHost || !panelFrameRoot) return;

  const logRemoval = (linkName, mutation, watchedNode) => {
    if (!Array.from(mutation.removedNodes).includes(watchedNode)) return false;
    console.warn("ChartMentor DEBUG: watchdog saw removal at link =", linkName);
    console.warn("ChartMentor DEBUG: watchdog removal time =", Date.now());
    console.warn(
      "ChartMentor DEBUG: watchdog mutation.target =",
      mutation.target?.nodeName,
      mutation.target?.id || null,
    );
    console.warn(
      "ChartMentor DEBUG: watchdog removedNodes.length =",
      mutation.removedNodes.length,
    );
    console.warn(
      "ChartMentor DEBUG: watchdog addedNodes.length =",
      mutation.addedNodes.length,
    );
    Array.from(mutation.addedNodes).forEach((node, i) => {
      console.warn(
        `ChartMentor DEBUG: watchdog addedNodes[${i}] =`,
        node?.nodeName,
        node?.id || null,
      );
    });
    // MutationObserver callbacks run as a microtask after the mutation, so
    // this trace shows OUR call stack, not the code that caused the removal -
    // still useful to confirm it wasn't triggered synchronously from our own
    // repair path.
    console.trace("ChartMentor DEBUG: watchdog trace");
    return true;
  };

  const bodyObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (logRemoval("body->panelContainer", mutation, panelContainer)) {
        ensurePanelIframeMounted();
      }
    }
  });
  bodyObserver.observe(document.body, { childList: true });
  panelDomWatchdogObservers.push(bodyObserver);

  const containerObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (
        logRemoval("panelContainer->panelFrameHost", mutation, panelFrameHost)
      ) {
        ensurePanelIframeMounted();
      }
    }
  });
  containerObserver.observe(panelContainer, { childList: true });
  panelDomWatchdogObservers.push(containerObserver);

  // Untested hypothesis worth ruling in/out: the closed shadow root itself
  // loses the iframe while panelContainer/panelFrameHost stay fully attached.
  // Nothing else in this codebase currently watches inside the shadow root.
  const shadowObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (logRemoval("shadowRoot->panelIframe", mutation, panelIframe)) {
        ensurePanelIframeMounted();
      }
    }
  });
  shadowObserver.observe(panelFrameRoot, { childList: true });
  panelDomWatchdogObservers.push(shadowObserver);
}

function stopPanelDomWatchdog() {
  panelDomWatchdogObservers.forEach((observer) => observer.disconnect());
  panelDomWatchdogObservers = [];
}
