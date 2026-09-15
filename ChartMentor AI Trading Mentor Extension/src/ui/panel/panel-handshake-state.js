const PANEL_TAB_SCOPE_WAIT_MS = 8000;
let panelTabScopeWaiters = [];

function normalizeHandshakePanelTabScope(value) {
  return typeof value === "string" && /^tab-\d{1,12}$/.test(value)
    ? value
    : null;
}

function setPanelTabScopeFromHandshake(value) {
  const scope = normalizeHandshakePanelTabScope(value);
  state.panelTabScope = scope;
  if (!scope) return null;

  const waiters = panelTabScopeWaiters;
  panelTabScopeWaiters = [];
  waiters.forEach((resolve) => resolve(scope));
  return scope;
}

function waitForPanelTabScope() {
  if (state.panelTabScope) return Promise.resolve(state.panelTabScope);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (scope) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      panelTabScopeWaiters = panelTabScopeWaiters.filter(
        (waiter) => waiter !== finish,
      );
      resolve(scope);
    };
    const timeout = window.setTimeout(
      () => finish(null),
      PANEL_TAB_SCOPE_WAIT_MS,
    );
    panelTabScopeWaiters.push(finish);
  });
}
