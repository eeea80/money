/**
 * @license
 * Copyright (c) 2024-2025 CRX International LLC. All Rights Reserved.
 *
 * This code is licensed under a commercial license.
 * See the LICENSE.md file for details.
 *
 * ChartMentor v2.0 - Auth Sync Content Script
 * Synchronizes authentication token from the website to the extension
 */

(function () {
  console.log("ChartMentor: Auth Sync active");

  const PROFILE_SETTINGS_SYNC_EVENT = "chartmentor:profile-settings-sync";
  let syncInterval;
  let isContextInvalidated = false;

  function announceExtensionPresence() {
    try {
      document.documentElement.dataset.chartmentorExtension = "installed";
      window.dispatchEvent(
        new CustomEvent("chartmentor:extension-present", {
          detail: { source: "extension" },
        }),
      );
      localStorage.setItem("cm_extension_present", String(Date.now()));
    } catch (e) {
      console.debug("ChartMentor: Unable to announce extension presence", e);
    }
  }

  announceExtensionPresence();

  function syncProfileSettings(detail) {
    if (isContextInvalidated || !detail || typeof detail !== "object") return;

    const payload = {};

    if (detail.reviewMode === "signal_generator") {
      payload.reviewMode = detail.reviewMode;
    }

    if (
      detail.responseLength === "short" ||
      detail.responseLength === "standard" ||
      detail.responseLength === "detailed"
    ) {
      payload.responseLength = detail.responseLength;
    }

    if (
      detail.mentorVoice === "sharp_mentor" ||
      detail.mentorVoice === "protective_bro" ||
      detail.mentorVoice === "strict_coach" ||
      detail.mentorVoice === "calm_pro"
    ) {
      payload.mentorVoice =
        detail.mentorVoice === "protective_bro"
          ? "sharp_mentor"
          : detail.mentorVoice;
    }

    if (typeof detail.mentorVoiceSelected === "boolean") {
      payload.mentorVoiceSelected = detail.mentorVoiceSelected;
    }

    if (typeof detail.hasCustomLens === "boolean") {
      payload.hasCustomLens = detail.hasCustomLens;
    }

    if (
      !payload.reviewMode &&
      !payload.responseLength &&
      !payload.mentorVoice &&
      typeof payload.mentorVoiceSelected !== "boolean" &&
      typeof payload.hasCustomLens !== "boolean"
    ) {
      return;
    }

    if (typeof detail.updatedAt === "string" && detail.updatedAt) {
      payload.updatedAt = detail.updatedAt;
    }

    try {
      if (chrome.runtime && chrome.runtime.id) {
        chrome.runtime.sendMessage(
          {
            type: "syncProfileSettings",
            settings: payload,
          },
          () => {
            if (chrome.runtime.lastError) {
              handleContextInvalidated();
            }
          },
        );
      } else {
        handleContextInvalidated();
      }
    } catch (e) {
      handleContextInvalidated();
    }
  }

  // Function to check and sync FULL session (including refresh token)
  function syncAuthToken() {
    if (isContextInvalidated) return;

    // Supabase stores the session in localStorage with a key like 'sb-<project-ref>-auth-token'
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("sb-") && key.endsWith("-auth-token")) {
        try {
          const sessionStr = localStorage.getItem(key);
          const session = JSON.parse(sessionStr);

          if (session && session.access_token) {
            // Store the FULL session object for token refresh
            try {
              if (chrome.runtime && chrome.runtime.id) {
                chrome.runtime.sendMessage(
                  {
                    type: "syncAuthToken",
                    token: session.access_token,
                    refreshToken: session.refresh_token,
                    expiresAt: session.expires_at,
                    fullSession: session,
                  },
                  (response) => {
                    if (chrome.runtime.lastError) {
                      handleContextInvalidated();
                    }
                  },
                );
              } else {
                handleContextInvalidated();
              }
            } catch (e) {
              handleContextInvalidated();
            }
            return;
          }
        } catch (e) {
          console.error("ChartMentor: Error parsing session", e);
        }
      }
    }

    // No valid session found - clear stored token
    try {
      if (chrome.runtime && chrome.runtime.id) {
        chrome.runtime.sendMessage(
          {
            type: "clearAuthToken",
          },
          (response) => {
            if (chrome.runtime.lastError) {
              handleContextInvalidated();
            }
          },
        );
      } else {
        handleContextInvalidated();
      }
    } catch (e) {
      handleContextInvalidated();
    }
  }

  function handleContextInvalidated() {
    if (isContextInvalidated) return;
    isContextInvalidated = true;
    console.log(
      "ChartMentor: Extension context invalidated, stopping auth sync.",
    );
    if (syncInterval) clearInterval(syncInterval);
  }

  // Initial sync
  syncAuthToken();

  // Watch for storage changes (if user logs in/out)
  window.addEventListener("storage", (event) => {
    if (
      event.key &&
      event.key.startsWith("sb-") &&
      event.key.endsWith("-auth-token")
    ) {
      syncAuthToken();
    }
  });

  window.addEventListener(PROFILE_SETTINGS_SYNC_EVENT, (event) => {
    syncProfileSettings(event.detail);
  });

  // Also check periodically in case of SPA navigation doesn't trigger storage event
  syncInterval = setInterval(syncAuthToken, 5000);
})();
