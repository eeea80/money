/**
 * OCT relayer REST client — `oneclick-01-keeper.leverup.xyz`.
 *
 * Three endpoints:
 *   POST /v1/trading/send-open-position?blockchain=MONAD
 *   POST /v1/trading/send-close-position?blockchain=MONAD
 *   GET  /v1/trading/{input_hash}/status
 *
 * The relayer takes a pre-signed EIP-712 payload and submits it on-chain on
 * the user's behalf, paying gas + Pyth oracle fee. We just wait on status.
 */

export interface OpenPositionRequest {
  openData: {
    pairBase: string
    isLong: boolean
    tokenIn: string
    lvToken: string
    /** wei as decimal string */
    amountIn: string
    qty: string
    price: string
    stopLoss: string
    takeProfit: string
    broker: string
  }
  trader: string
  salt: string
  /** Unix seconds (integer) */
  deadline: number
  signature: `0x${string}`
  /** Hex strings from Pyth Hermes binary.data[] */
  pythUpdateData: `0x${string}`[]
}

export interface ClosePositionRequest {
  positionHash: `0x${string}`
  deadline: number
  signature: `0x${string}`
}

/** Response from open/close: opaque hash to poll status with. */
export interface RelayerSubmitResponse {
  inputHash: `0x${string}`
}

export interface RelayerStatusResponse {
  executed: boolean
  success: boolean
  txnHash?: `0x${string}` | null
  reason?: string | null
}

export class RelayerClient {
  constructor(private readonly baseUrl: string) {}

  async sendOpenPosition(req: OpenPositionRequest): Promise<RelayerSubmitResponse> {
    return this.post('/v1/trading/send-open-position?blockchain=MONAD', req)
  }

  async sendClosePosition(req: ClosePositionRequest): Promise<RelayerSubmitResponse> {
    return this.post('/v1/trading/send-close-position?blockchain=MONAD', req)
  }

  async getStatus(inputHash: `0x${string}`): Promise<RelayerStatusResponse> {
    const res = await fetch(`${this.baseUrl}/v1/trading/${inputHash}/status`)
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Relayer status failed (${res.status}): ${body.slice(0, 200)}`)
    }
    return (await res.json()) as RelayerStatusResponse
  }

  /**
   * Poll status until executed=true or timeout. Returns the final status.
   * Default: poll every 1.5s for up to 30s — enough for normal Monad blocks
   * (1s) plus relayer queue + propagation slack.
   */
  async pollUntilExecuted(
    inputHash: `0x${string}`,
    opts?: { intervalMs?: number; timeoutMs?: number },
  ): Promise<RelayerStatusResponse> {
    const interval = opts?.intervalMs ?? 1500
    const timeout = opts?.timeoutMs ?? 30000
    const deadline = Date.now() + timeout

    while (Date.now() < deadline) {
      const status = await this.getStatus(inputHash)
      if (status.executed) return status
      await new Promise(r => setTimeout(r, interval))
    }
    return { executed: false, success: false, reason: 'poll timeout' }
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Relayer ${path} failed (${res.status}): ${text.slice(0, 300)}`)
    }
    return (await res.json()) as T
  }
}
