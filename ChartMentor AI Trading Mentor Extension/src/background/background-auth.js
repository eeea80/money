/**
 * @license
 * Copyright (c) 2024-2025 CRX International LLC. All Rights Reserved.
 *
 * ChartMentor - Background Service Worker Auth Helpers
 */

async function clearStoredAuthSession(reason = "authentication failed") {
  abortActiveAnalysesForSubject(
    decodeJwtSubject(sessionData?.access_token || null),
  );
  sessionData = null;
  try {
    await chrome.storage.local.remove([
      "chartmentor_auth_token",
      "chartmentor_session",
      "chartmentor_auth_source_origin",
    ]);
    console.warn(`ChartMentor: Cleared stored auth session (${reason})`);
  } catch (error) {
    console.error("ChartMentor: Failed to clear stored auth session", error);
  }
}

function isInvalidRefreshTokenResponse(data) {
  const errorCodes = [data?.error_code, data?.error, data?.code];
  const hasInvalidErrorCode = errorCodes.some(
    (value) =>
      typeof value === "string" &&
      ["invalid_grant", "invalid_refresh_token"].includes(value.toLowerCase()),
  );
  const message = [
    data?.msg,
    data?.error_description,
    data?.message,
    data?.error,
  ]
    .filter((value) => typeof value === "string")
    .join(" ")
    .toLowerCase();

  return (
    hasInvalidErrorCode ||
    message.includes("invalid refresh token") ||
    message.includes("refresh token not found") ||
    message.includes("refresh token has expired")
  );
}

async function restoreSessionData() {
  const result = await new Promise((resolve) =>
    chrome.storage.local.get(["chartmentor_session"], resolve),
  );
  if (result?.chartmentor_session) {
    sessionData = result.chartmentor_session;
    console.log("ChartMentor: Session data restored");
  }
}

function decodeJwtSubject(token) {
  if (!token || typeof token !== "string") return null;

  try {
    const payload = token.split(".")[1];
    if (!payload) return null;

    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const paddedBase64 = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      "=",
    );
    const decoded = JSON.parse(atob(paddedBase64));
    return typeof decoded.sub === "string" ? decoded.sub : null;
  } catch (error) {
    console.debug("ChartMentor: Unable to decode analytics user id", error);
    return null;
  }
}

function isTokenExpired(expiresAt) {
  if (!expiresAt) return true;
  const now = Math.floor(Date.now() / 1000);
  return now >= expiresAt - 300; // 5 minute buffer
}

let inFlightTokenRefresh = null;

// Concurrent callers (e.g. the 30-min signal-trigger and watch-trigger
// pollers firing on the same alarm tick, or a poll overlapping a manual
// scan) must never issue two simultaneous refresh requests with the same
// refresh_token: Supabase rotates refresh tokens on use, so the loser's
// request would come back invalid_grant and get misread by
// isInvalidRefreshTokenResponse() as a rejected token, wiping the user's
// whole session even though they were never actually logged out. Share
// one in-flight refresh across all concurrent callers instead of letting
// each start its own.
async function refreshAccessToken() {
  if (!sessionData || !sessionData.refresh_token) {
    return null;
  }

  if (inFlightTokenRefresh) return inFlightTokenRefresh;

  inFlightTokenRefresh = performTokenRefresh().finally(() => {
    inFlightTokenRefresh = null;
  });
  return inFlightTokenRefresh;
}

async function performTokenRefresh() {
  // Snapshot which account this refresh is for before the async fetch
  // starts. Mirrors the previousSubject/nextSubject identity comparison
  // background.js's syncAuthToken handler already uses to detect an
  // account change. If a different account gets synced into sessionData
  // while this fetch is in flight, the subject captured here will no
  // longer match sessionData's subject once the fetch resolves, and the
  // result (success or failure) must be discarded instead of applied -
  // otherwise this stale refresh could clear the new account's session
  // or overwrite its credentials with this account's stale tokens.
  const refreshSubject = decodeJwtSubject(sessionData?.access_token || null);
  const sessionChangedDuringRefresh = () =>
    decodeJwtSubject(sessionData?.access_token || null) !== refreshSubject;

  try {
    const response = await fetch(
      `${CHARTMENTOR_CONFIG.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: CHARTMENTOR_CONFIG.SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          refresh_token: sessionData.refresh_token,
        }),
      },
    );

    if (!response.ok) {
      let errorData = null;
      try {
        errorData = await response.json();
      } catch (parseError) {
        errorData = null;
      }

      if (sessionChangedDuringRefresh()) {
        console.warn(
          "ChartMentor: Discarding stale token refresh failure; active session changed while refresh was in flight",
        );
        return null;
      }

      if (isInvalidRefreshTokenResponse(errorData)) {
        await clearStoredAuthSession("refresh token rejected");
      } else {
        console.error("ChartMentor: Token refresh failed", response.status);
      }
      return null;
    }

    const data = await response.json();

    if (sessionChangedDuringRefresh()) {
      console.warn(
        "ChartMentor: Discarding stale token refresh result; active session changed while refresh was in flight",
      );
      return null;
    }

    const sourceOrigin = sessionData.source_origin || null;
    sessionData = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at,
      source_origin: sourceOrigin,
    };

    // Store new token
    await chrome.storage.local.set({
      chartmentor_auth_token: data.access_token,
      chartmentor_session: sessionData,
    });

    console.log("ChartMentor: Token refreshed successfully");
    return data.access_token;
  } catch (error) {
    console.error("ChartMentor: Error refreshing token", error);
    return null;
  }
}

async function refreshAccessTokenWithRetry(maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    const token = await refreshAccessToken();
    if (token) return token;
    if (!sessionData?.refresh_token) return null;
    if (i < maxRetries - 1) {
      const delay = Math.pow(2, i) * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  return null;
}
