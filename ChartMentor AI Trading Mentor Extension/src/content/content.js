/**
 * @license
 * Copyright (c) 2024-2025 CRX International LLC. All Rights Reserved.
 *
 * This code is licensed under a commercial license.
 * See the LICENSE.md file for details.
 *
 * ChartMentor v2.0 - Content Script
 * Main entry point for content scripts
 */

if (window.chartmentorInjected) {
  console.log("ChartMentor: Already injected, skipping...");
} else {
  window.chartmentorInjected = true;
  console.log("ChartMentor v2.0: Content script starting...");

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}

function init() {
  console.log("ChartMentor: Initializing...");
  injectStyles();

  waitForToolbar().then((toolbar) => {
    injectAnalyzeButton(toolbar);
    setupToolbarObserver();
  });

  injectBottomToggle();
  setupExternalReviewModeSync();
  startReadinessMonitor();

  window.addEventListener("chartmentor:symbolChanged", (event) => {
    try {
      const controller = window.ChartMentorPanelController;
      if (controller?.sendToPanel) {
        controller.sendToPanel({
          type: "symbolChanged",
          data: event.detail,
        });
      }
    } catch (e) {}
  });

  startChartChangeObserver();

  try {
    if (chrome.runtime && chrome.runtime.id) {
      chrome.runtime.onMessage.addListener(handleBackgroundMessage);
    }
  } catch (e) {
    console.log(
      "ChartMentor: Failed to setup message listener (context invalidated)",
    );
  }

  setTimeout(() => {
    if (window.ChartMentorPanelController) {
      window.ChartMentorPanelController.createPanel();
      setTimeout(() => {
        window.ChartMentorPanelController.syncTheme();
      }, 100);
    }
  }, 150);
}

async function captureScreenshotForAnalysis() {
  if (window.ChartMentorPanelController?.captureTradingViewScreenshot) {
    try {
      return normalizeScreenshotCaptureResult(
        await window.ChartMentorPanelController.captureTradingViewScreenshot(),
      );
    } catch (error) {
      console.warn(
        "ChartMentor: Direct page capture failed, falling back to background capture",
        error,
      );
    }
  }

  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "captureScreenshot" },
      async (response) => {
        const capturedPayload = response?.success
          ? normalizeScreenshotCaptureResult({
              dataUrl: response.dataUrl,
              captureMetadata: {
                captureMethod: "visible_tab_background",
                screenshotScope: "tradingview_viewport",
                compressed: false,
              },
            })
          : null;

        if (
          capturedPayload?.dataUrl &&
          window.ChartMentorPanelController?.compressScreenshot
        ) {
          try {
            capturedPayload.dataUrl =
              await window.ChartMentorPanelController.compressScreenshot(
                capturedPayload.dataUrl,
              );
            capturedPayload.captureMetadata = {
              ...(capturedPayload.captureMetadata || {}),
              compressed: true,
            };
          } catch (compressError) {
            console.error(
              "ChartMentor: Background screenshot compression failed",
              compressError,
            );
          }
        }

        resolve(capturedPayload);
      },
    );
  });
}

function normalizeScreenshotCaptureResult(result) {
  if (typeof result === "string") {
    return {
      dataUrl: result,
      captureMetadata: null,
    };
  }

  if (result && typeof result === "object") {
    const dataUrl =
      typeof result.dataUrl === "string"
        ? result.dataUrl
        : typeof result.screenshot === "string"
          ? result.screenshot
          : null;

    return {
      dataUrl,
      captureMetadata: result.captureMetadata || result.metadata || null,
    };
  }

  return null;
}

async function openPanelForAnalysis(controller) {
  if (controller?.ensurePanelOpen) {
    controller.ensurePanelOpen();
    return;
  }

  const panelState = await ChartMentorStorage.getPanelState();
  if (!panelState.open) {
    controller.openPanel();
  } else if (panelState.collapsed) {
    controller.toggleCollapse();
  }
}

async function triggerAnalysisFromExternalControl(control, busyHtml) {
  if (control?.dataset.chartmentorBusy === "true") return;
  if (!isExtensionReadyForAnalysis()) {
    updateExternalAnalyzeControls();
    return;
  }

  const originalHtml = control.innerHTML;
  setAnalyzeControlBusy(control, true, busyHtml, originalHtml);

  try {
    const controller = window.ChartMentorPanelController;
    if (!controller) {
      throw new Error("Panel controller not ready");
    }

    const panelWasVisible = Boolean(controller.isPanelVisible?.());
    const hasAuthToken = Boolean(await ChartMentorStorage.getAuthToken());
    const screenshotPayload =
      panelWasVisible || !hasAuthToken
        ? null
        : await captureScreenshotForAnalysis();

    await openPanelForAnalysis(controller);
    controller.sendToPanel({
      type: "triggerAnalysis",
      data: {
        screenshot: screenshotPayload || null,
      },
    });
  } catch (e) {
    console.log("ChartMentor: Extension context invalidated, showing toast...");
    showContextInvalidationToast();
  } finally {
    setAnalyzeControlBusy(control, false, busyHtml, originalHtml);
  }
}

function handleBackgroundMessage(request, sender, sendResponse) {
  switch (request.type) {
    case "togglePanel":
      if (window.ChartMentorPanelController) {
        window.ChartMentorPanelController.togglePanel();
      }
      sendResponse({ success: true });
      break;

    case "getSymbolAndTimeframe":
      const info = getChartContextWithConfidence();
      sendResponse({ success: true, data: info });
      break;

    default:
      sendResponse({ success: false, error: "Unknown message type" });
  }

  return true;
}
