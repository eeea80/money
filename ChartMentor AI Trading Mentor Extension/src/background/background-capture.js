/**
 * @license
 * Copyright (c) 2024-2025 CRX International LLC. All Rights Reserved.
 *
 * ChartMentor - Background Service Worker Capture Helpers
 */

const MIN_SCREENSHOT_BASE64_LENGTH = 100;
const MIN_CAPTURE_VISIBLE_TAB_INTERVAL_MS = 700;

let lastCaptureVisibleTabAt = 0;
let captureVisibleTabQueue = Promise.resolve();

function isUsableScreenshotDataUrl(dataUrl) {
  if (
    typeof dataUrl !== "string" ||
    !dataUrl.startsWith("data:image/") ||
    !dataUrl.includes("base64,")
  ) {
    return false;
  }

  const base64Part = dataUrl.split(",")[1] || "";
  return base64Part.length >= MIN_SCREENSHOT_BASE64_LENGTH;
}

function sanitizeCaptureMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const safeMetadata = {};
  const allowedStringFields = [
    "captureMethod",
    "screenshotScope",
    "fallbackReason",
  ];
  const allowedNumberFields = [
    "viewportWidth",
    "viewportHeight",
    "devicePixelRatio",
  ];
  const allowedBooleanFields = ["panelHidden", "compressed"];

  allowedStringFields.forEach((field) => {
    if (typeof metadata[field] === "string" && metadata[field].trim()) {
      safeMetadata[field] = metadata[field].trim().slice(0, 120);
    }
  });

  allowedNumberFields.forEach((field) => {
    if (Number.isFinite(Number(metadata[field]))) {
      safeMetadata[field] = Number(metadata[field]);
    }
  });

  allowedBooleanFields.forEach((field) => {
    if (typeof metadata[field] === "boolean") {
      safeMetadata[field] = metadata[field];
    }
  });

  return Object.keys(safeMetadata).length > 0 ? safeMetadata : null;
}

function isCapturePermissionError(error) {
  const message = String(error?.message || error || "");
  return (
    message.includes("'<all_urls>'") || message.includes("activeTab permission")
  );
}

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureVisibleTabThrottled(windowId) {
  const runCapture = async () => {
    const elapsed = Date.now() - lastCaptureVisibleTabAt;
    if (elapsed < MIN_CAPTURE_VISIBLE_TAB_INTERVAL_MS) {
      await delay(MIN_CAPTURE_VISIBLE_TAB_INTERVAL_MS - elapsed);
    }

    try {
      return await chrome.tabs.captureVisibleTab(windowId ?? null, {
        format: "jpeg",
        quality: 90,
      });
    } finally {
      lastCaptureVisibleTabAt = Date.now();
    }
  };

  const capturePromise = captureVisibleTabQueue.then(runCapture, runCapture);
  captureVisibleTabQueue = capturePromise.catch(() => {});
  return capturePromise;
}

async function captureVisibleTabWithRetry(windowId, attempts = 2) {
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const dataUrl = await captureVisibleTabThrottled(windowId);
      if (isUsableScreenshotDataUrl(dataUrl)) {
        return dataUrl;
      }

      lastError = new Error(
        `Captured data is too small (length: ${dataUrl ? dataUrl.length : 0} bytes)`,
      );
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts - 1) {
      await delay(MIN_CAPTURE_VISIBLE_TAB_INTERVAL_MS);
    }
  }

  throw (
    lastError || new Error("Captured data is too small or empty after retries")
  );
}

async function focusSenderTabForCapture(sender) {
  const tabId = sender?.tab?.id;
  const windowId = sender?.tab?.windowId;
  if (!tabId) return windowId || null;

  try {
    if (windowId) {
      await chrome.windows.update(windowId, { focused: true });
    }
    await chrome.tabs.update(tabId, { active: true });
    await delay(120);
  } catch (error) {
    console.warn(
      "ChartMentor: Failed to focus sender tab before capture:",
      error.message,
    );
  }

  return windowId || null;
}
