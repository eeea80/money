/**
 * @license
 * Copyright (c) 2024-2025 CRX International LLC. All Rights Reserved.
 *
 * This code is licensed under a commercial license.
 * See the LICENSE.md file for details.
 *
 * ChartMentor v2.0 - Background Service Worker
 * Handles API calls to Supabase backend
 */

// Import constants
importScripts("../shared/constants.js");

// Store session data for token refresh
let sessionData = null;

// Import capture, auth, and api modules
importScripts(
  "background-capture.js",
  "background-auth.js",
  "background-profile-sync.js",
  "background-api.js",
  "background-checkout.js",
  "background-watchlist-api.js",
  "background-telemetry.js",
  "background-outcome-api.js",
  "background-history.js",
  "background-conversation-api.js",
  "background-mentor-session-api.js",
  "background-analysis-lifecycle.js",
  "background-analysis-handler.js",
);

const sessionRestorePromise = restoreSessionData();

const ANALYTICS_LINKED_USER_KEY = "chartmentor_extension_linked_user_id";
const AUTH_SYNC_SOURCE_ORIGIN_KEY = "chartmentor_auth_source_origin";
const EXTENSION_INSTALL_ID_KEY = "chartmentor_extension_install_id";
const FIRST_INSTALL_SIGNUP_URL =
  "https://chartmentor.io/auth?plan=free&mode=signup&source=extension";
const DEFAULT_API_REQUEST_TIMEOUT_MS = 45000;
const ANALYZE_CHART_TIMEOUT_MS = 150000;
const VALID_REVIEW_MODES = new Set(["signal_generator"]);
const VALID_RESPONSE_LENGTHS = new Set(["short", "standard", "detailed"]);
const VALID_MENTOR_VOICES = new Set([
  "sharp_mentor",
  "protective_bro",
  "strict_coach",
  "calm_pro",
]);

const TRUSTED_AUTH_SYNC_ORIGINS = [
  "https://chartmentor.io",
  "https://chartmentor.lovable.app",
  "https://preview--chartmentor.lovable.app",
];

// Message types that trigger privileged/quota-consuming/data-returning
// operations. Any of these must originate from a genuine TradingView chart
// tab (the content script's scope) - never trust a parent page or a
// compromised tab to relay these without validating sender.tab.url first.
const PRIVILEGED_MESSAGE_TYPES = new Set([
  "getUserProfile",
  "getAnalysisHistory",
  "getMentorConversation",
  "saveMentorConversationMessages",
  "mentorSession",
  "getMentorWatchlist",
  "addMentorWatchlistItem",
  "deleteMentorWatchlistItem",
  "analyzeChart",
  "submitReviewOutcome",
  "submitProductFeedback",
  "trackAnalyticsEvent",
  "startDollarTrialCheckout",
]);

function isTrustedSenderOrigin(sender) {
  const senderUrl = sender?.tab?.url;
  if (typeof senderUrl !== "string") return false;

  try {
    const parsedUrl = new URL(senderUrl);
    return (
      parsedUrl.protocol === "https:" &&
      /(^|\.)tradingview\.com$/i.test(parsedUrl.hostname) &&
      parsedUrl.pathname.includes("/chart/")
    );
  } catch {
    return false;
  }
}

function getTrustedAuthSyncOrigin(sender) {
  const senderUrl = sender?.tab?.url;
  if (typeof senderUrl !== "string") return null;

  try {
    const senderOrigin = new URL(senderUrl).origin;
    return TRUSTED_AUTH_SYNC_ORIGINS.includes(senderOrigin)
      ? senderOrigin
      : null;
  } catch {
    return null;
  }
}

function normalizeMentorVoice(value) {
  if (value === "protective_bro") return "sharp_mentor";
  return VALID_MENTOR_VOICES.has(value) ? value : "sharp_mentor";
}

function getTabContext(tab) {
  if (!tab?.url) return {};

  try {
    const parsedUrl = new URL(tab.url);
    return {
      host: parsedUrl.hostname,
      isTradingView: parsedUrl.hostname.endsWith("tradingview.com"),
    };
  } catch {
    return {};
  }
}

// Handle messages from content script/panel
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      await sessionRestorePromise;
      let result;
      const isAuthSyncMessage =
        request?.type === "syncAuthToken" || request?.type === "clearAuthToken";
      const authSyncOrigin = isAuthSyncMessage
        ? getTrustedAuthSyncOrigin(sender)
        : null;
      if (isAuthSyncMessage && !authSyncOrigin) {
        console.warn(
          "ChartMentor: Rejected auth message from untrusted sender",
          sender?.tab?.url || "(unknown)",
        );
        return;
      }

      if (
        PRIVILEGED_MESSAGE_TYPES.has(request?.type) &&
        !isTrustedSenderOrigin(sender)
      ) {
        console.warn(
          "ChartMentor: Rejected privileged message from untrusted sender",
          request?.type,
          sender?.tab?.url || "(unknown)",
        );
        sendResponse({
          success: false,
          error:
            "Untrusted sender: this action must originate from a TradingView chart tab.",
        });
        return;
      }

      switch (request.type) {
        case "getPanelTabScope": {
          const tabId = sender?.tab?.id;
          result =
            Number.isInteger(tabId) && tabId >= 0
              ? { success: true, panelTabScope: `tab-${tabId}` }
              : { success: false, error: "Panel tab scope unavailable" };
          break;
        }

        case "captureScreenshot":
          try {
            console.log("ChartMentor: Background capturing screenshot...");

            const windowId = await focusSenderTabForCapture(sender);
            if (!windowId) {
              throw new Error(
                "Could not capture the chart - please make sure the TradingView tab is active and try again.",
              );
            }

            const dataUrl = await captureVisibleTabWithRetry(windowId);

            if (!isUsableScreenshotDataUrl(dataUrl)) {
              throw new Error(
                "Screenshot capture failed: data is missing or corrupted.",
              );
            }

            console.log(
              "ChartMentor: Screenshot captured successfully, length:",
              dataUrl.length,
            );
            result = { success: true, dataUrl };
          } catch (error) {
            const log = isCapturePermissionError(error)
              ? console.debug
              : console.error;
            log("ChartMentor: Capture error:", error.message);
            result = {
              success: false,
              error: "Capture error: " + error.message,
            };
          }
          break;

        case "analyzeChart":
          result = await handleAnalyzeChartRequest(request, sender);
          break;

        case "cancelAnalyzeChart": {
          const requestData = request?.data || {};
          const cancelled = cancelActiveAnalysis({
            tabId: sender?.tab?.id,
            requestId: requestData.requestId,
            ownerSubject: requestData.expectedAuthSubject,
          });
          result = { success: true, cancelled };
          break;
        }

        case "syncAuthToken":
          {
            const previousSubject = decodeJwtSubject(
              sessionData?.access_token || null,
            );
            const nextSubject = decodeJwtSubject(request.token);
            if (previousSubject && previousSubject !== nextSubject) {
              abortActiveAnalysesForSubject(previousSubject);
            }
          }
          sessionData = {
            access_token: request.token,
            refresh_token: request.refreshToken,
            expires_at: request.expiresAt,
            source_origin: authSyncOrigin,
          };
          await chrome.storage.local.set({
            chartmentor_auth_token: request.token,
            chartmentor_session: sessionData,
            [AUTH_SYNC_SOURCE_ORIGIN_KEY]: authSyncOrigin,
          });
          console.log(
            "ChartMentor: Auth token synchronized with refresh capability",
          );
          const syncedUserId =
            request.fullSession?.user?.id || decodeJwtSubject(request.token);
          if (syncedUserId) {
            const previous = await chrome.storage.local.get([
              ANALYTICS_LINKED_USER_KEY,
            ]);
            if (
              previous[ANALYTICS_LINKED_USER_KEY] !== syncedUserId
            ) {
              await chrome.storage.local.set({
                [ANALYTICS_LINKED_USER_KEY]: syncedUserId,
              });
              await trackAnalyticsEvent("extension_auth_synced", {
                method: "website_session_sync",
              });
            }
          }
          result = { success: true };
          break;

        case "clearAuthToken": {
          const storedAuthSource = await chrome.storage.local.get([
            AUTH_SYNC_SOURCE_ORIGIN_KEY,
            "chartmentor_session",
            STORAGE_KEYS.AUTH_TOKEN,
          ]);
          const sessionSourceOrigin =
            storedAuthSource[AUTH_SYNC_SOURCE_ORIGIN_KEY] ||
            storedAuthSource.chartmentor_session?.source_origin ||
            null;

          if (!sessionSourceOrigin || sessionSourceOrigin !== authSyncOrigin) {
            console.log(
              "ChartMentor: Ignored auth clear from a different website origin",
              authSyncOrigin,
            );
            result = { success: true, cleared: false };
            break;
          }

          abortActiveAnalysesForSubject(
            decodeJwtSubject(
              storedAuthSource[STORAGE_KEYS.AUTH_TOKEN] ||
                sessionData?.access_token ||
                null,
            ),
          );
          sessionData = null;
          await chrome.storage.local.remove([
            "chartmentor_auth_token",
            "chartmentor_session",
            AUTH_SYNC_SOURCE_ORIGIN_KEY,
          ]);
          console.log("ChartMentor: Auth token cleared");
          result = { success: true, cleared: true };
          break;
        }

        case "syncProfileSettings": {
          const syncedSettings = sanitizeSyncedProfileSettings(
            request.settings,
          );
          if (!syncedSettings) {
            result = { success: false, error: "No valid settings to sync" };
            break;
          }

          const stored = await chrome.storage.local.get(["settings"]);
          const nextSettings = {
            ...(stored.settings || {}),
            ...syncedSettings,
          };

          await chrome.storage.local.set({ settings: nextSettings });
          console.log(
            "ChartMentor: Profile settings synchronized",
            syncedSettings,
          );
          result = { success: true, settings: nextSettings };
          break;
        }
        case "getUserProfile":
          result = await apiRequest("/get-profile", { method: "GET" });
          break;
        case "getMentorWatchlist":
        case "addMentorWatchlistItem":
        case "deleteMentorWatchlistItem":
          result = await handleMentorWatchlistAction(request);
          break;
        case "getAnalysisHistory":
          result = await apiRequest("/analysis-history", { method: "GET" });
          break;
        case "getMentorConversation":
          result = await getMentorConversation(request.data);
          break;
        case "saveMentorConversationMessages":
          result = await saveMentorConversationMessages(request.data);
          break;
        case "mentorSession":
          result = await handleMentorSessionRequest(request.data || {});
          break;
        case "upsertLocalHistoryItem":
          result = await upsertLocalHistoryItem(
            request.data?.expectedAuthSubject,
            request.data?.item,
          );
          break;
        case "trackAnalyticsEvent":
          result = await trackAnalyticsEvent(
            request.eventName,
            request.eventData || {},
          );
          break;
        case "startDollarTrialCheckout":
          result = await startDollarTrialCheckout(request.data || {});
          break;
        case "submitProductFeedback":
          result = await submitProductFeedback(request.data || {});
          break;
        case "submitReviewOutcome":
          result = await submitReviewOutcome(request.data || {});
          break;

        default:
          result = { success: false, error: "Unknown message type" };
      }

      sendResponse(result);
    } catch (error) {
      console.error("Background script error:", error);
      sendResponse({ success: false, error: error.message });
    }
  })();

  return true;
});

// Handle extension icon click
chrome.action.onClicked.addListener(async (tab) => {
  const isTradingViewChart = (() => {
    try {
      const url = new URL(tab.url || "");
      return (
        url.hostname.endsWith("tradingview.com") &&
        url.pathname.startsWith("/chart")
      );
    } catch (error) {
      return false;
    }
  })();

  const analyticsPayload = {
    destination: isTradingViewChart ? "tradingview_panel" : "account_page",
    ...getTabContext(tab),
  };

  if (isTradingViewChart) {
    chrome.tabs.sendMessage(tab.id, { type: "togglePanel" }, () => {
      if (chrome.runtime.lastError) {
        console.debug(
          "ChartMentor: Panel toggle message not delivered",
          chrome.runtime.lastError.message,
        );
      }
    });
  } else {
    chrome.tabs.create({ url: "https://chartmentor.io/account" });
  }

  trackAnalyticsEvent("extension_opened", analyticsPayload).catch((error) => {
    console.debug("ChartMentor: extension_opened analytics failed", error);
  });
});

// Handle extension install/update
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.storage.local
      .remove([
        STORAGE_KEYS.FIRST_RUN_PENDING,
      ])
      .catch((error) => {
        console.debug("ChartMentor: Failed to clear first-run state", error);
      });
    chrome.tabs.create({ url: FIRST_INSTALL_SIGNUP_URL });
  } else if (details.reason === "update") {
    chrome.storage.local
      .remove([STORAGE_KEYS.FIRST_RUN_PENDING])
      .catch((error) => {
        console.debug("ChartMentor: Failed to clear first-run state", error);
      });
  }
});

console.log("ChartMentor v2.0 Background Service Worker started");
