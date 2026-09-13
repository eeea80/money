/**
 * API client for the MockBroker simulator control panel.
 * Mirrors the routes mounted at /api/simulator (see src/webui/routes/simulator.ts).
 */

export interface SimulatorUTAEntry {
  id: string
  label: string
}

export interface SimulatorMarkPrice {
  nativeKey: string
  price: string
}

export interface SimulatorPosition {
  nativeKey: string
  symbol: string
  localSymbol?: string
  secType?: string
  side: 'long' | 'short'
  quantity: string
  avgCost: string
  avgCostSource?: 'broker' | 'wallet'
  /** YYYYMMDD (OPT/FOP) or YYYYMM (FUT). */
  expiry?: string
  strike?: number
  right?: string
  multiplier?: string
}

export interface SimulatorPendingOrder {
  orderId: string
  nativeKey: string
  symbol: string
  action: string
  orderType: string
  totalQuantity: string
  lmtPrice?: string
  auxPrice?: string
}

export interface SimulatorState {
  cash: string
  markPrices: SimulatorMarkPrice[]
  positions: SimulatorPosition[]
  pendingOrders: SimulatorPendingOrder[]
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = (data as { error?: string }).error ?? `HTTP ${res.status}`
    throw new Error(msg)
  }
  return data as T
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export const simulatorApi = {
  listUtas: () => getJson<{ utas: SimulatorUTAEntry[] }>('/api/simulator/utas'),

  state: (utaId: string) => getJson<SimulatorState>(`/api/simulator/uta/${encodeURIComponent(utaId)}/state`),

  setMarkPrice: (utaId: string, nativeKey: string, price: string | number) =>
    postJson<{ filled: string[] }>(`/api/simulator/uta/${encodeURIComponent(utaId)}/mark-price`, { nativeKey, price }),

  tickPrice: (utaId: string, nativeKey: string, deltaPercent: number) =>
    postJson<{ filled: string[] }>(`/api/simulator/uta/${encodeURIComponent(utaId)}/tick-price`, { nativeKey, deltaPercent }),

  fillOrder: (utaId: string, orderId: string, opts: { price?: string; qty?: string } = {}) =>
    postJson<{ ok: true }>(`/api/simulator/uta/${encodeURIComponent(utaId)}/orders/${encodeURIComponent(orderId)}/fill`, opts),

  cancelOrder: (utaId: string, orderId: string) =>
    postJson<{ ok: true }>(`/api/simulator/uta/${encodeURIComponent(utaId)}/orders/${encodeURIComponent(orderId)}/cancel`, {}),

  externalDeposit: (utaId: string, params: SimulatorExternalDepositParams) =>
    postJson<{ ok: true }>(`/api/simulator/uta/${encodeURIComponent(utaId)}/external-deposit`, params),

  externalWithdraw: (utaId: string, nativeKey: string, quantity: string) =>
    postJson<{ ok: true }>(`/api/simulator/uta/${encodeURIComponent(utaId)}/external-withdraw`, { nativeKey, quantity }),

  externalTrade: (utaId: string, params: SimulatorExternalTradeParams) =>
    postJson<{ ok: true }>(`/api/simulator/uta/${encodeURIComponent(utaId)}/external-trade`, params),
}

// ==================== Contract shapes ====================

/**
 * Subset of IBKR Contract fields the simulator accepts. `lastTradeDateOrContractMonth`,
 * `strike`, `right`, `multiplier` enable OPT/FOP/FUT positions; bare CRYPTO/STK
 * just need `symbol` + `secType`.
 */
export interface SimulatorContractInput {
  symbol?: string
  localSymbol?: string
  secType?: string
  exchange?: string
  currency?: string
  /** YYYYMMDD for OPT/FOP, YYYYMM for FUT. */
  lastTradeDateOrContractMonth?: string
  /** Option strike (number). */
  strike?: number
  /** Option right: C / P (or CALL / PUT). */
  right?: 'C' | 'P' | 'CALL' | 'PUT'
  /** Shares per contract: typically "100" for OPT, "1" for stocks/crypto. */
  multiplier?: string
}

export interface SimulatorExternalDepositParams {
  nativeKey: string
  quantity: string
  contract?: SimulatorContractInput
}

export interface SimulatorExternalTradeParams {
  nativeKey: string
  side: 'BUY' | 'SELL'
  quantity: string
  price: string
  contract?: SimulatorContractInput
}
