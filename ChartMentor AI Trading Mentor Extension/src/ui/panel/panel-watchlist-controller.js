let mentorWatchlistRefreshPending = false;

async function refreshMentorWatchlistForTab() {
  if (mentorWatchlistRefreshPending || !state.isAuthenticated) {
    renderMentorWatchlist();
    return;
  }
  mentorWatchlistRefreshPending = true;
  await loadMentorWatchlist({
    showLoading: state.mentorWatchlist.length === 0,
  });
  mentorWatchlistRefreshPending = false;
}

function requestMentorWatchlistNavigation(item) {
  const symbol = normalizeWatchlistSymbol(item?.symbol);
  const timeframe = normalizeWatchlistTimeframe(item?.timeframe);
  if (!symbol || !timeframe || !state.panelMessageToken) {
    setMentorWatchlistError("This saved chart cannot be opened safely.");
    return false;
  }

  window.parent.postMessage(
    {
      source: "chartmentor-panel",
      type: "openWatchlistChart",
      panelToken: state.panelMessageToken,
      payload: { symbol, timeframe },
    },
    getParentMessageTargetOrigin(),
  );
  return true;
}

async function handleMentorWatchlistClick(event) {
  const actionButton = event.target.closest("[data-watchlist-action]");
  if (!actionButton) return;
  const action = actionButton.dataset.watchlistAction;
  const itemId = actionButton.dataset.watchlistId;

  if (action === "retry") {
    await refreshMentorWatchlistForTab();
    return;
  }
  if (action === "add-current") {
    const currentChart = getReliableCurrentWatchlistChart();
    if (!currentChart) {
      setMentorWatchlistError(
        "Wait for a reliable TradingView symbol and timeframe before adding.",
      );
      return;
    }
    const noteInput = document.getElementById("watchlist-note-input");
    const created = await createMentorWatchlistItem({
      ...currentChart,
      note: noteInput?.value || "",
    });
    if (created && noteInput) noteInput.value = "";
    return;
  }

  const item = state.mentorWatchlist.find((candidate) => candidate.id === itemId);
  if (!item) {
    setMentorWatchlistError("That watchlist item is no longer available.");
    return;
  }
  if (action === "remove") {
    await deleteMentorWatchlistItemById(item.id);
    return;
  }
  if (action === "open") {
    requestMentorWatchlistNavigation(item);
  }
}

function handleWatchlistBridgeMessage(event) {
  if (
    event.source !== window.parent ||
    event.origin !== getParentMessageTargetOrigin() ||
    event.data?.source !== "chartmentor-content" ||
    event.data?.panelToken !== state.panelMessageToken ||
    event.data?.type !== "watchlistChartOpenResult"
  ) {
    return;
  }
  if (event.data.success !== true) {
    setMentorWatchlistError(
      event.data.error || "TradingView could not open that saved chart.",
    );
  }
}

function initializeMentorWatchlistPanel() {
  const tab = document.getElementById("watchlist-tab");
  if (!tab) return;
  tab.addEventListener("click", handleMentorWatchlistClick);
  document
    .querySelector('[data-tab="watchlist"]')
    ?.addEventListener("click", () => void refreshMentorWatchlistForTab());
  window.addEventListener("message", handleWatchlistBridgeMessage);
  window.addEventListener("message", (event) => {
    if (
      event.source === window.parent &&
      event.origin === getParentMessageTargetOrigin() &&
      event.data?.source === "chartmentor-content" &&
      event.data?.panelToken === state.panelMessageToken &&
      event.data?.type === "symbolChanged"
    ) {
      renderMentorWatchlist();
    }
  });
  renderMentorWatchlist();
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[STORAGE_KEYS.AUTH_TOKEN]) return;
  resetMentorWatchlistState();
});

document.addEventListener("DOMContentLoaded", initializeMentorWatchlistPanel);
