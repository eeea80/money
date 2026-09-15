function isValidAnalysisRequestId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,160}$/.test(value);
}

function isValidPanelTabScope(value) {
  return typeof value === "string" && /^tab-\d{1,12}$/.test(value);
}

function getScanResultStorageKey(ownerSubject, panelTabScope) {
  if (!ownerSubject || !isValidPanelTabScope(panelTabScope)) return null;
  return `scanResultReady:${ownerSubject}:${panelTabScope}`;
}

const activeAnalysisControllers = new Map();

function getActiveAnalysisKey(tabId, requestId) {
  return Number.isInteger(tabId) &&
    tabId >= 0 &&
    isValidAnalysisRequestId(requestId)
    ? `${tabId}:${requestId}`
    : null;
}

function registerActiveAnalysis({ tabId, requestId, ownerSubject }) {
  const key = getActiveAnalysisKey(tabId, requestId);
  if (!key || typeof ownerSubject !== "string" || !ownerSubject) return null;
  const controller = new AbortController();
  activeAnalysisControllers.set(key, {
    tabId,
    ownerSubject,
    controller,
  });
  return { key, controller };
}

function releaseActiveAnalysis(key) {
  if (key) activeAnalysisControllers.delete(key);
}

function abortActiveAnalyses(predicate) {
  for (const [key, activeAnalysis] of activeAnalysisControllers) {
    if (!predicate(activeAnalysis)) continue;
    activeAnalysis.controller.abort();
    activeAnalysisControllers.delete(key);
  }
}

function abortActiveAnalysesForSubject(ownerSubject) {
  if (typeof ownerSubject !== "string" || !ownerSubject) return;
  abortActiveAnalyses(
    (activeAnalysis) => activeAnalysis.ownerSubject === ownerSubject,
  );
}

function cancelActiveAnalysis({ tabId, requestId, ownerSubject }) {
  const key = getActiveAnalysisKey(tabId, requestId);
  const activeAnalysis = key ? activeAnalysisControllers.get(key) : null;
  if (
    !activeAnalysis ||
    typeof ownerSubject !== "string" ||
    !ownerSubject ||
    activeAnalysis.ownerSubject !== ownerSubject
  ) {
    return false;
  }

  activeAnalysis.controller.abort();
  activeAnalysisControllers.delete(key);
  return true;
}

chrome.tabs.onRemoved.addListener((tabId) => {
  abortActiveAnalyses((activeAnalysis) => activeAnalysis.tabId === tabId);
});
