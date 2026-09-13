/**
 * Longbridge broker config + raw SDK shape adapters.
 *
 * The longbridge SDK exposes Rust-NAPI classes with getter-only fields.
 * For unit-test mocking and broker-internal pass-through we model only
 * the subset we read.
 */

export interface LongbridgeBrokerConfig {
  id?: string
  label?: string
  /** App key from longbridge developer dashboard. */
  appKey: string
  /** App secret. */
  appSecret: string
  /**
   * Long-lived access token. Longbridge requires the user to rotate
   * this manually (~90d) — the SDK does not auto-refresh.
   */
  accessToken: string
  /**
   * Paper trading flag. Longbridge does not (yet) ship a separate
   * sandbox URL set, so for now this only flips the broker label and
   * isPaper marker; live + paper credentials must be generated against
   * the matching environment in the LB dashboard.
   */
  paper: boolean
  /** Override the HTTP / WS endpoints (paper environment, future use). */
  httpUrl?: string
  quoteWsUrl?: string
  tradeWsUrl?: string
}

/** Subset of {@link AccountBalance} we read. */
export interface LongbridgeAccountBalanceLike {
  currency: string
  totalCash: { toString(): string }
  netAssets: { toString(): string }
  buyPower: { toString(): string }
  initMargin: { toString(): string }
  maintenanceMargin: { toString(): string }
}

/** Subset of {@link StockPosition} we read. */
export interface LongbridgeStockPositionLike {
  symbol: string
  symbolName: string
  quantity: { toString(): string }
  costPrice: { toString(): string }
  currency: string
  market: number
}

/** Subset of {@link StockPositionsResponse} we read. */
export interface LongbridgeStockPositionsResponseLike {
  channels: Array<{ accountChannel: string; positions: LongbridgeStockPositionLike[] }>
}

/** Subset of {@link SecurityQuote} we read. */
export interface LongbridgeSecurityQuoteLike {
  symbol: string
  lastDone: { toString(): string }
  open: { toString(): string }
  high: { toString(): string }
  low: { toString(): string }
  volume: number | { toString(): string }
  timestamp: Date
}

/** Subset of {@link SecurityDepth} we read. */
export interface LongbridgeSecurityDepthLike {
  asks: Array<{ price: { toString(): string } | null; volume: number }>
  bids: Array<{ price: { toString(): string } | null; volume: number }>
}

/** Subset of {@link Order} we read. */
export interface LongbridgeOrderLike {
  orderId: string
  symbol: string
  status: number
  side: number
  orderType: number
  quantity: { toString(): string }
  executedQuantity: { toString(): string }
  price: { toString(): string } | null
  executedPrice: { toString(): string } | null
  timeInForce: number
  currency: string
  msg: string
}

/** Subset of {@link SecurityStaticInfo} we read for derivative-type detection. */
export interface LongbridgeStaticInfoLike {
  symbol: string
  /**
   * Numeric DerivativeType enum values from the SDK (Option=0, Warrant=1).
   * Empty array → plain equity / fund.
   */
  stockDerivatives: number[]
  lotSize: number
}

/** Subset of {@link OptionQuote} we read. */
export interface LongbridgeOptionQuoteLike {
  symbol: string
  /** Shares per contract (US equity options usually 100). */
  contractMultiplier: { toString(): string }
}

/** Subset of {@link WarrantQuote} we read. */
export interface LongbridgeWarrantQuoteLike {
  symbol: string
  /** Shares delivered per warrant on conversion (issuer-specific). */
  conversionRatio: { toString(): string }
}

/** Subset of {@link MarketTradingSession} we read. */
export interface LongbridgeMarketSessionLike {
  market: number
  tradeSessions: Array<{
    beginTime: { hour: number; minute: number; second: number }
    endTime: { hour: number; minute: number; second: number }
    tradeSession: number
  }>
}
