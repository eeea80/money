/**
 * @license
 * Copyright (c) 2024-2025 CRX International LLC. All Rights Reserved.
 *
 * ChartMentor - Panel Controller Screenshot Capture Operations
 */

function captureCanvasScreenshot() {
  try {
    const chartWrapper =
      document.querySelector(".layout__area--center") ||
      document.querySelector(".chart-gui-wrapper") ||
      document.body;
    const canvases = Array.from(chartWrapper.querySelectorAll("canvas"));
    if (canvases.length === 0) return null;

    let maxWidth = 0;
    let maxHeight = 0;
    canvases.forEach((c) => {
      if (c.width > maxWidth) maxWidth = c.width;
      if (c.height > maxHeight) maxHeight = c.height;
    });

    if (maxWidth === 0 || maxHeight === 0) return null;

    const combinedCanvas = document.createElement("canvas");
    combinedCanvas.width = maxWidth;
    combinedCanvas.height = maxHeight;
    const ctx = combinedCanvas.getContext("2d");

    const isDark = detectTradingViewTheme() === "dark";
    ctx.fillStyle = isDark ? "#0F0F0F" : "#ffffff";
    ctx.fillRect(0, 0, maxWidth, maxHeight);

    const sortedCanvases = canvases
      .map((c) => {
        const style = window.getComputedStyle(c);
        let zIndex = parseInt(style.zIndex, 10);
        if (isNaN(zIndex)) zIndex = 0;
        return { canvas: c, zIndex: zIndex, style: style };
      })
      .sort((a, b) => a.zIndex - b.zIndex);

    sortedCanvases.forEach((item) => {
      const c = item.canvas;
      if (
        item.style.display === "none" ||
        item.style.visibility === "hidden" ||
        item.style.opacity === "0"
      )
        return;
      try {
        ctx.drawImage(c, 0, 0);
      } catch (e) {}
    });

    return combinedCanvas.toDataURL("image/jpeg", 0.9);
  } catch (e) {
    console.error("ChartMentor: Error composing canvas:", e);
    return null;
  }
}

function isUsableScreenshotDataUrl(dataUrl) {
  return (
    typeof dataUrl === "string" &&
    dataUrl.startsWith("data:image/") &&
    dataUrl.includes("base64,") &&
    dataUrl.length > 5000
  );
}

function waitForLayoutSettle() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(resolve, 80);
      });
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getPanelVisibleChartCrop() {
  if (!isPanelVisible()) return null;

  const viewportWidth = Math.max(0, window.innerWidth || 0);
  const viewportHeight = Math.max(0, window.innerHeight || 0);
  if (viewportWidth <= 0 || viewportHeight <= 0) return null;

  const panelWidth = Math.min(
    Math.max(currentPanelWidth || 0, 0),
    Math.max(viewportWidth - 240, 0),
  );
  const chartWidth = viewportWidth - panelWidth;
  if (chartWidth < 240 || chartWidth >= viewportWidth) return null;

  return {
    xCss: 0,
    yCss: 0,
    widthCss: chartWidth,
    heightCss: viewportHeight,
    croppedRightCss: panelWidth,
  };
}

function cropScreenshotToVisibleChart(dataUrl, crop) {
  if (!crop || !isUsableScreenshotDataUrl(dataUrl))
    return Promise.resolve(dataUrl);

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const viewportWidth = Math.max(1, window.innerWidth || img.width);
      const viewportHeight = Math.max(1, window.innerHeight || img.height);
      const scaleX = img.width / viewportWidth;
      const scaleY = img.height / viewportHeight;
      const sourceX = Math.max(0, Math.round(crop.xCss * scaleX));
      const sourceY = Math.max(0, Math.round(crop.yCss * scaleY));
      const sourceWidth = Math.min(
        img.width - sourceX,
        Math.round(crop.widthCss * scaleX),
      );
      const sourceHeight = Math.min(
        img.height - sourceY,
        Math.round(crop.heightCss * scaleY),
      );

      if (sourceWidth < 240 || sourceHeight < 160) {
        resolve(dataUrl);
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width = sourceWidth;
      canvas.height = sourceHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(
        img,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        sourceWidth,
        sourceHeight,
      );
      resolve(
        canvas.toDataURL("image/jpeg", CHARTMENTOR_CONFIG.SCREENSHOT_QUALITY),
      );
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function isCaptureVisibleElement(element) {
  if (!element || !element.isConnected) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width < 80 || rect.height < 80) return false;

  const style = window.getComputedStyle(element);
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    Number(style.opacity || "1") > 0
  );
}

function hasReadyTradingViewChart() {
  const chartRoot =
    document.querySelector(".layout__area--center") ||
    document.querySelector(".chart-gui-wrapper") ||
    document.querySelector('[data-name="chart-container"]');

  if (!chartRoot || !isCaptureVisibleElement(chartRoot)) return false;

  return Array.from(chartRoot.querySelectorAll("canvas")).some((canvas) => {
    if (!isCaptureVisibleElement(canvas)) return false;
    const rect = canvas.getBoundingClientRect();
    const hasRenderableBackingStore =
      canvas.width >= 200 && canvas.height >= 120;
    const hasVisibleChartArea = rect.width >= 160 && rect.height >= 120;

    return (
      hasVisibleChartArea && (hasRenderableBackingStore || rect.width >= 300)
    );
  });
}

async function waitForTradingViewChartReady(
  timeoutMs = CHART_READY_TIMEOUT_MS,
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (hasReadyTradingViewChart()) {
      await waitForLayoutSettle();
      return true;
    }
    await sleep(CHART_READY_POLL_MS);
  }

  return false;
}

async function withTradingViewPageVisibleForCapture(callback) {
  const wasPanelVisible = isPanelVisible();
  const reduceMotion = prefersReducedPanelMotion();
  const visibleChartCrop = getPanelVisibleChartCrop();

  setCaptureState("preparing_capture");

  if (!reduceMotion) {
    await sleep(CAPTURE_CONTROLS_FADE_MS);
  }

  setCaptureState("capturing");
  await waitForLayoutSettle();

  try {
    return await callback({
      captureState,
      extensionControlsHidden: true,
      panelHidden: false,
      panelVisibleDuringCapture: wasPanelVisible,
      captureAnimated: false,
      layoutRestoredForCapture: false,
      visibleChartCrop,
      screenshotCroppedToChartArea: Boolean(visibleChartCrop),
    });
  } finally {
    setCaptureState("restoring");
    setCaptureState("idle");
  }
}

function buildCaptureMetadata(method, extras = {}) {
  return {
    captureMethod: method,
    screenshotScope:
      method === "visible_tab"
        ? "tradingview_viewport"
        : "chart_canvas_fallback",
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
    panelHidden: false,
    ...extras,
  };
}

function requestVisibleTabScreenshot() {
  return new Promise((resolve, reject) => {
    try {
      if (!chrome.runtime || !chrome.runtime.id) {
        reject(new Error("Extension not available"));
        return;
      }

      chrome.runtime.sendMessage({ type: "captureScreenshot" }, (response) => {
        if (chrome.runtime.lastError) {
          reject(
            new Error(
              chrome.runtime.lastError.message ||
                "Extension context invalidated",
            ),
          );
          return;
        }

        if (response?.success && isUsableScreenshotDataUrl(response.dataUrl)) {
          resolve(response.dataUrl);
          return;
        }

        reject(new Error(response?.error || "Failed to capture visible tab"));
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function captureTradingViewScreenshot() {
  const chartReady = await waitForTradingViewChartReady();
  if (!chartReady) {
    console.warn(
      "ChartMentor: TradingView chart was not fully ready before capture; attempting visible viewport capture anyway",
    );
  }

  const captureResult = await withTradingViewPageVisibleForCapture(
    async (captureState) => {
      try {
        let visibleTabUrl;
        try {
          visibleTabUrl = await requestVisibleTabScreenshot();
        } catch (firstAttemptError) {
          // A single retry absorbs transient focus/throttle races so a
          // momentary hiccup doesn't drop straight to the chart-only
          // canvas fallback below.
          await sleep(250);
          visibleTabUrl = await requestVisibleTabScreenshot();
        }
        const croppedVisibleTabUrl = await cropScreenshotToVisibleChart(
          visibleTabUrl,
          captureState.visibleChartCrop,
        );
        const compressedVisibleTabUrl =
          await compressScreenshot(croppedVisibleTabUrl);

        return {
          dataUrl: compressedVisibleTabUrl,
          captureMetadata: buildCaptureMetadata("visible_tab", {
            compressed: true,
            ...captureState,
          }),
        };
      } catch (error) {
        console.warn(
          "ChartMentor: Full viewport capture failed, using chart canvas fallback:",
          error.message,
        );

        const canvasUrl = captureCanvasScreenshot();
        if (!isUsableScreenshotDataUrl(canvasUrl)) {
          throw error;
        }

        const compressedCanvasUrl = await compressScreenshot(canvasUrl);
        console.log("ChartMentor: Captured TradingView chart canvas fallback");

        return {
          dataUrl: compressedCanvasUrl,
          captureMetadata: buildCaptureMetadata("chart_canvas_fallback", {
            compressed: true,
            ...captureState,
            fallbackReason: error.message,
          }),
        };
      }
    },
  );

  if (captureResult.captureMetadata?.captureMethod === "visible_tab") {
    console.log(
      "ChartMentor: Successfully captured TradingView viewport with ChartMentor panel kept open",
    );
  }

  return captureResult;
}

async function compressScreenshot(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      let { width, height } = img;
      const maxDim = CHARTMENTOR_CONFIG.SCREENSHOT_MAX_WIDTH;

      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = (height / width) * maxDim;
          width = maxDim;
        } else {
          width = (width / height) * maxDim;
          height = maxDim;
        }
      }

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);

      const compressed = canvas.toDataURL(
        "image/jpeg",
        CHARTMENTOR_CONFIG.SCREENSHOT_QUALITY,
      );
      resolve(compressed);
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}
