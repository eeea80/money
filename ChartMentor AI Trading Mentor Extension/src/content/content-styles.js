/**
 * @license
 * Copyright (c) 2024-2025 CRX International LLC. All Rights Reserved.
 *
 * ChartMentor - Content Script Styles Injected into TradingView DOM
 */

function injectStyles() {
  const style = document.createElement("style");
  style.textContent = `
    :root {
      --cm-tv-accent: #2962ff;
      --cm-tv-accent-strong: #1f4fd6;
      --cm-tv-accent-glow: rgba(41, 98, 255, 0.24);
      --cm-tv-surface: rgba(255, 255, 255, 0.96);
      --cm-tv-surface-hover: rgba(243, 246, 251, 0.98);
      --cm-tv-border: rgba(41, 98, 255, 0.18);
      --cm-tv-text: #1a1a1a;
      --cm-tv-panel-bg: rgba(248, 250, 252, 0.98);
      --cm-tv-panel-border: rgba(148, 163, 184, 0.24);
      --cm-tv-shadow: 0 10px 28px rgba(15, 23, 42, 0.18);
      --cm-tv-layer-panel: 90;
      --cm-tv-layer-controls: 90;
      --cm-tv-layer-panel-handle: 2;
    }

    html.theme-dark,
    html[data-theme="dark"] {
      --cm-tv-accent: #3b82f6;
      --cm-tv-accent-strong: #2962ff;
      --cm-tv-accent-glow: rgba(59, 130, 246, 0.28);
      --cm-tv-surface: rgba(15, 15, 15, 0.94);
      --cm-tv-surface-hover: rgba(26, 26, 26, 0.98);
      --cm-tv-border: rgba(46, 46, 46, 0.28);
      --cm-tv-text: #d1d4dc;
      --cm-tv-panel-bg: rgba(15, 15, 15, 0.98);
      --cm-tv-panel-border: rgba(46, 46, 46, 0.5);
      --cm-tv-shadow: 0 16px 36px rgba(0, 0, 0, 0.42);
    }

    #chartmentor-toolbar-btn {
      background: var(--cm-tv-accent);
      color: #ffffff;
      border: 1px solid var(--cm-tv-border);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      margin: 0 4px;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s ease;
      box-shadow: 0 8px 18px var(--cm-tv-accent-glow);
      backdrop-filter: blur(14px);
    }

    #chartmentor-toolbar-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 10px 22px var(--cm-tv-accent-glow);
      filter: brightness(1.04);
    }

    #chartmentor-toolbar-btn.is-extension-loading,
    #chartmentor-toolbar-btn:disabled {
      opacity: 0.62;
      filter: grayscale(0.15);
      transform: none;
      box-shadow: none;
    }

    #chartmentor-toolbar-btn svg {
      width: 16px;
      height: 16px;
    }

    #chartmentor-toolbar-btn.is-extension-loading .chartmentor-status-clock,
    #chartmentor-toolbar-btn[aria-busy="true"] .chartmentor-status-clock,
    #chartmentor-quick-analyze.is-extension-loading .chartmentor-status-clock,
    #chartmentor-quick-analyze[aria-busy="true"] .chartmentor-status-clock {
      transform-origin: center;
      animation: chartmentorStatusClock 1.1s linear infinite;
    }

    @keyframes chartmentorStatusClock {
      to {
        transform: rotate(360deg);
      }
    }

    #chartmentor-bottom-toggle {
      background: var(--cm-tv-surface);
      color: var(--cm-tv-text);
      border: 1px solid var(--cm-tv-border);
      border-right: none;
      padding: 8px 16px;
      border-radius: 6px 0 0 0;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s ease;
      backdrop-filter: blur(14px);
      box-shadow: var(--cm-tv-shadow, 0 10px 28px rgba(15, 23, 42, 0.22));
    }

    #chartmentor-panel-container {
      position: fixed;
      top: 0;
      right: 0;
      width: 380px;
      height: 100vh;
      height: 100dvh;
      max-height: 100dvh;
      overflow: hidden;
      z-index: var(--cm-tv-layer-panel);
      background: var(--cm-tv-panel-bg);
      border-left: 1px solid var(--cm-tv-panel-border);
      display: none;
      opacity: 0;
      pointer-events: none;
      transform: translateX(100%);
      transition:
        transform 240ms cubic-bezier(0.19, 1, 0.22, 1),
        opacity 160ms ease-out;
      will-change: transform, opacity;
      box-shadow: none;
    }

    #chartmentor-panel-container.is-opening,
    #chartmentor-panel-container.is-open {
      opacity: 1;
      pointer-events: auto;
      transform: translateX(0);
    }

    #chartmentor-panel-container.is-closing {
      opacity: 1;
      pointer-events: none;
      transform: translateX(100%);
    }

    #chartmentor-panel-container.collapsed {
      opacity: 0;
      pointer-events: none;
      transform: translateX(100%);
    }

    #chartmentor-panel-container.is-capturing-chart {
      opacity: 1 !important;
      pointer-events: none !important;
      transform: translateX(100%) !important;
      transition:
        transform 240ms cubic-bezier(0.19, 1, 0.22, 1),
        opacity 160ms ease-out !important;
    }

    #chartmentor-panel-frame-host {
      position: absolute;
      inset: 0;
      overflow: hidden;
    }

    #chartmentor-resize-handle {
      position: absolute;
      left: 0;
      top: 0;
      width: 6px;
      height: 100%;
      cursor: ew-resize;
      z-index: var(--cm-tv-layer-panel-handle);
      background: transparent;
      transition: background 0.2s ease;
    }

    #chartmentor-resize-handle:hover,
    #chartmentor-panel-container.is-resizing #chartmentor-resize-handle {
      background: var(--cm-tv-accent-glow);
      box-shadow: inset 1px 0 0 var(--cm-tv-accent);
    }

    #chartmentor-panel-container.is-resizing {
      transition: none;
    }

    #chartmentor-panel-container.is-resizing #chartmentor-panel-frame-host {
      pointer-events: none;
    }

    body.chartmentor-resizing {
      cursor: ew-resize !important;
      user-select: none !important;
    }

    body.chartmentor-resizing iframe {
      pointer-events: none !important;
    }

    #chartmentor-panel-container.collapsed:not(.is-closing) {
      border-left: none;
    }

    #chartmentor-panel-container.collapsed:not(.is-closing) #chartmentor-panel-frame-host {
      display: none;
    }

    @media (prefers-reduced-motion: reduce) {
      #chartmentor-panel-container {
        transition: none;
      }

      .chartmentor-status-clock {
        animation: none !important;
      }
    }

    html body.chartmentor-panel-open #chartmentor-bottom-bar,
    html body.chartmentor-panel-transitioning #chartmentor-bottom-bar {
      display: none !important;
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }

    html body.chartmentor-capture-mode #chartmentor-bottom-bar,
    html body.chartmentor-capture-mode #chartmentor-toolbar-btn {
      opacity: 0 !important;
      pointer-events: none !important;
    }

    #chartmentor-bottom-bar {
      position: fixed;
      bottom: 0;
      right: 0;
      display: flex;
      flex-direction: row-reverse;
      align-items: flex-end;
      z-index: var(--cm-tv-layer-controls);
      pointer-events: none;
    }

    #chartmentor-bottom-bar > * {
      pointer-events: auto;
    }

    .chartmentor-bar-btn {
      background: var(--cm-tv-surface);
      color: var(--cm-tv-text);
      border: 1px solid var(--cm-tv-border);
      padding: 8px 16px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      backdrop-filter: blur(14px);
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      gap: 8px;
      box-shadow: var(--cm-tv-shadow, 0 10px 28px rgba(15, 23, 42, 0.22));
    }

    #chartmentor-bottom-toggle {
      border-radius: 8px 0 0 0;
    }

    #chartmentor-quick-analyze {
      background: var(--cm-tv-accent);
      color: #ffffff;
      border-color: rgba(255, 255, 255, 0.08);
      margin-right: 2px;
      border-radius: 6px 6px 0 0;
    }

    .chartmentor-bar-btn:hover {
      background: var(--cm-tv-surface-hover);
      transform: translateY(-1px);
      box-shadow: 0 14px 32px rgba(15, 23, 42, 0.24);
    }

    .chartmentor-bar-btn.is-extension-loading {
      opacity: 0.62;
      pointer-events: none;
      transform: none;
      box-shadow: none;
    }

    #chartmentor-quick-analyze:hover {
      filter: brightness(1.06);
      box-shadow: 0 14px 32px var(--cm-tv-accent-glow);
    }
  `;
  document.head.appendChild(style);
}
