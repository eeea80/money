/**
 * @license
 * Copyright (c) 2024-2025 CRX International LLC. All Rights Reserved.
 *
 * This code is licensed under a commercial license.
 * See the LICENSE.md file for details.
 *
 * ChartMentor v2.0 - Storage Utilities
 */

const ChartMentorStorage = {
  /**
   * Get value from Chrome storage
   */
  async get(key) {
    return new Promise((resolve) => {
      try {
        if (
          typeof chrome === "undefined" ||
          !chrome.storage ||
          !chrome.storage.local
        ) {
          resolve(null);
          return;
        }
        chrome.storage.local.get([key], (result) => {
          if (chrome.runtime.lastError) {
            resolve(null);
          } else {
            resolve(result ? result[key] : null);
          }
        });
      } catch (e) {
        if (e.message && e.message.includes("context invalidated")) {
          console.error(
            "ChartMentor: Extension context invalidated. Please refresh the page.",
          );
          if (
            typeof window !== "undefined" &&
            window.showContextInvalidationToast
          ) {
            window.showContextInvalidationToast();
          }
        }
        resolve(null);
      }
    });
  },

  /**
   * Set value in Chrome storage
   */
  async set(key, value) {
    return new Promise((resolve, reject) => {
      try {
        if (
          typeof chrome === "undefined" ||
          !chrome.storage ||
          !chrome.storage.local
        ) {
          resolve();
          return;
        }
        chrome.storage.local.set({ [key]: value }, () => {
          if (chrome.runtime.lastError) {
            console.error(
              "ChartMentor: Storage write failed",
              chrome.runtime.lastError,
            );
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      } catch (e) {
        if (e.message && e.message.includes("context invalidated")) {
          console.error(
            "ChartMentor: Extension context invalidated. Please refresh the page.",
          );
          if (
            typeof window !== "undefined" &&
            window.showContextInvalidationToast
          ) {
            window.showContextInvalidationToast();
          }
        }
        reject(e);
      }
    });
  },

  /**
   * Remove value from Chrome storage
   */
  async remove(key) {
    return new Promise((resolve, reject) => {
      try {
        if (
          typeof chrome === "undefined" ||
          !chrome.storage ||
          !chrome.storage.local
        ) {
          resolve();
          return;
        }
        chrome.storage.local.remove(key, () => {
          if (chrome.runtime.lastError) {
            console.error(
              "ChartMentor: Storage remove failed",
              chrome.runtime.lastError,
            );
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      } catch (e) {
        if (e.message && e.message.includes("context invalidated")) {
          console.error(
            "ChartMentor: Extension context invalidated. Please refresh the page.",
          );
          if (
            typeof window !== "undefined" &&
            window.showContextInvalidationToast
          ) {
            window.showContextInvalidationToast();
          }
        }
        reject(e);
      }
    });
  },

  /**
   * Get panel state (open/closed)
   */
  async getPanelState() {
    const state = await this.get("chartmentor_panel_state");
    return state || { open: false, collapsed: true };
  },

  /**
   * Set panel state
   */
  async setPanelState(state) {
    await this.set("chartmentor_panel_state", state);
  },

  /**
   * Get auth token
   */
  async getAuthToken() {
    return await this.get("chartmentor_auth_token");
  },

  /**
   * Set auth token
   */
  async setAuthToken(token) {
    await this.set("chartmentor_auth_token", token);
  },

  /**
   * Clear auth token (logout)
   */
  async clearAuthToken() {
    await this.remove("chartmentor_auth_token");
  },

  /**
   * Get user settings
   */
  async getUserSettings() {
    const settings = await this.get("chartmentor_user_settings");
    return (
      settings || {
        systemPrompt: "",
        modelId: "openai/gpt-4o",
        theme: "dark",
      }
    );
  },

  /**
   * Set user settings
   */
  async setUserSettings(settings) {
    await this.set("chartmentor_user_settings", settings);
  },

  /**
   * Get last session ID
   */
  async getLastSession() {
    return await this.get("chartmentor_last_session");
  },

  /**
   * Set last session ID
   */
  async setLastSession(sessionId) {
    await this.set("chartmentor_last_session", sessionId);
  },

  /**
   * Get custom panel width
   */
  async getPanelWidth() {
    return await this.get("chartmentor_panel_width");
  },

  /**
   * Set custom panel width
   */
  async setPanelWidth(width) {
    await this.set("chartmentor_panel_width", width);
  },
};

// Make available globally
if (typeof window !== "undefined") {
  window.ChartMentorStorage = ChartMentorStorage;
}

if (typeof self !== "undefined") {
  self.ChartMentorStorage = ChartMentorStorage;
}
