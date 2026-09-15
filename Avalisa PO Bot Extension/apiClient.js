/**
 * Avalisa PO Bot v2 - API client helpers
 * Shared backend fetch helpers used by content.js flows.
 */

const FETCH_TIMEOUT_MS = 15000;

function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(tid));
}

async function apiPost(path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.jwt) headers['Authorization'] = `Bearer ${state.jwt}`;
  const res = await fetchWithTimeout(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function apiGet(path) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.jwt) headers['Authorization'] = `Bearer ${state.jwt}`;
  const res = await fetchWithTimeout(`${API_BASE}${path}`, { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
