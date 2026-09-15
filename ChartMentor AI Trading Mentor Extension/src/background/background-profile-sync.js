/**
 * @license
 * Copyright (c) 2024-2025 CRX International LLC. All Rights Reserved.
 *
 * ChartMentor - Extension auth journey and profile sync helpers
 */

async function getExtensionInstallId() {
  const result = await chrome.storage.local.get([EXTENSION_INSTALL_ID_KEY]);
  if (result?.[EXTENSION_INSTALL_ID_KEY]) {
    return result[EXTENSION_INSTALL_ID_KEY];
  }

  const installId = crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  await chrome.storage.local.set({ [EXTENSION_INSTALL_ID_KEY]: installId });
  return installId;
}

function sanitizeSyncedProfileSettings(settings) {
  if (!settings || typeof settings !== "object") return null;

  const sanitized = {};

  if (VALID_REVIEW_MODES.has(settings.reviewMode)) {
    sanitized.reviewMode = settings.reviewMode;
  }

  if (VALID_RESPONSE_LENGTHS.has(settings.responseLength)) {
    sanitized.responseLength = settings.responseLength;
  }

  if (VALID_MENTOR_VOICES.has(settings.mentorVoice)) {
    sanitized.mentorVoice = normalizeMentorVoice(settings.mentorVoice);
  }

  if (typeof settings.mentorVoiceSelected === "boolean") {
    sanitized.mentorVoiceProfileSelected = settings.mentorVoiceSelected;
  }

  if (typeof settings.hasCustomLens === "boolean") {
    sanitized.hasCustomLens = settings.hasCustomLens;
  }

  if (
    typeof settings.mentorVoiceSelectedAt === "string" &&
    settings.mentorVoiceSelectedAt
  ) {
    sanitized.mentorVoiceSelectedAt = settings.mentorVoiceSelectedAt;
  }

  if (
    typeof settings.mentorVoicePromptShownAt === "string" &&
    settings.mentorVoicePromptShownAt
  ) {
    sanitized.mentorVoicePromptShownAt = settings.mentorVoicePromptShownAt;
  }

  if (typeof settings.updatedAt === "string" && settings.updatedAt) {
    sanitized.updatedAt = settings.updatedAt;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : null;
}
