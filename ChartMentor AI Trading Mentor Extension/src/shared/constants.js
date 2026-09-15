/**
 * @license
 * Copyright (c) 2024-2025 CRX International LLC. All Rights Reserved.
 *
 * This code is licensed under a commercial license.
 * See the LICENSE.md file for details.
 *
 * ChartMentor v2.0 - Constants & Configuration
 */

// API Configuration
const CHARTMENTOR_CONFIG = {
  // Supabase Backend API
  IS_STAGING: false,
  SUPABASE_URL: "https://fjepmkoonpzmlddpeufe.supabase.co",
  SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZqZXBta29vbnB6bWxkZHBldWZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5MjU3OTIsImV4cCI6MjA4NjUwMTc5Mn0.Y5V3ssCBz-RQQxUlZJJdZCZAR7DbbCDsOo5aYLr1O3o",
  API_BASE_URL: "https://fjepmkoonpzmlddpeufe.supabase.co/functions/v1",
  PREVIEW_API_BASE_URL: "https://preview--chartmentor.lovable.app/functions/v1",

  // Panel Configuration
  PANEL_WIDTH: 380,
  MIN_PANEL_WIDTH: 300,
  MAX_PANEL_WIDTH: 800,
  PANEL_COLLAPSED_WIDTH: 40,

  // Screenshot Configuration
  SCREENSHOT_MAX_WIDTH: 1600,
  SCREENSHOT_QUALITY: 0.82,
  SCREENSHOT_MAX_SIZE_KB: 500,

  // Rate Limiting: keep these fallbacks aligned with backend tier limits.
  RATE_LIMITS: {
    free: { monthly: 1 },
    starter: { monthly: 2000 },
    pro: { monthly: 2000 },
    elite: { monthly: 2000 },
  },

  // UI Text
  DEFAULT_WELCOME_MESSAGE:
    "Ask what the chart is offering, or scan it for a mentor-grade execution ticket.",

  // Tab IDs
  TABS: {
    CHAT: "chat",
    SIGNALS: "signals",
    HISTORY: "history",
  },
};

// Storage Keys
const STORAGE_KEYS = {
  PANEL_STATE: "chartmentor_panel_state",
  PANEL_COLLAPSED: "chartmentor_panel_collapsed",
  AUTH_TOKEN: "chartmentor_auth_token",
  USER_SETTINGS: "chartmentor_user_settings",
  LAST_SESSION: "chartmentor_last_session",
  USE_PREVIEW_BACKEND: "chartmentor_use_preview_backend",
  PANEL_CUSTOM_WIDTH: "chartmentor_panel_width",
  FIRST_RUN_PENDING: "chartmentor_first_run_pending",
};

// Make available globally
if (typeof window !== "undefined") {
  window.CHARTMENTOR_CONFIG = CHARTMENTOR_CONFIG;
  window.STORAGE_KEYS = STORAGE_KEYS;
}

if (typeof self !== "undefined") {
  self.CHARTMENTOR_CONFIG = CHARTMENTOR_CONFIG;
  self.STORAGE_KEYS = STORAGE_KEYS;
}
