/**
 * UTA Snapshot types.
 *
 * Captures the full state of a UnifiedTradingAccount at a point in time,
 * independently of trading operations (TradingGit commits).
 *
 * All financial values are stored as strings to avoid floating-point precision loss.
 */

// ==================== Snapshot ====================

export type SnapshotTrigger = 'scheduled' | 'post-push' | 'post-reject' | 'manual'

export interface UTASnapshot {
  accountId: string
  timestamp: string
  trigger: SnapshotTrigger

  account: {
    baseCurrency: string
    netLiquidation: string
    totalCashValue: string
    unrealizedPnL: string
    realizedPnL: string
    buyingPower?: string
    initMarginReq?: string
    maintMarginReq?: string
  }

  positions: Array<{
    aliceId: string
    currency: string
    side: 'long' | 'short'
    quantity: string
    avgCost: string
    marketPrice: string
    marketValue: string
    unrealizedPnL: string
    realizedPnL: string
    /** Contract metadata captured from the broker. Persisted so the UI can
     *  re-render OPT/FUT/FOP positions (multiplier badge, strike, right,
     *  expiry tag) without rehydrating the broker's contract registry —
     *  the broker session that wrote the snapshot may not be running when
     *  the snapshot is read back. */
    secType?: string
    multiplier?: string
    strike?: number
    right?: string
    expiry?: string
  }>

  openOrders: Array<{
    orderId: string
    aliceId: string
    action: string
    orderType: string
    totalQuantity: string
    limitPrice?: string
    status: string
    avgFillPrice?: string
  }>

  health: 'healthy' | 'degraded' | 'offline' | 'disabled'
  headCommit: string | null
  pendingCommits: string[]
}

// ==================== Storage ====================

export interface SnapshotChunkEntry {
  file: string
  count: number
  startTime: string
  endTime: string
}

export interface SnapshotIndex {
  version: 1
  chunks: SnapshotChunkEntry[]
}
