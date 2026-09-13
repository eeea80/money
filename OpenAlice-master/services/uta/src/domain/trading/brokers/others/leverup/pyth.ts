/**
 * Pyth Hermes API client.
 *
 * Used for two purposes:
 *   1. Fetching `pythUpdateData` payloads to attach to OCT open-position
 *      requests (relayer uses this to update the on-chain price).
 *   2. Reading the latest price for `getQuote`.
 *
 * Hermes is a public stateless service — no authentication, no rate-limit
 * known, but we still want to keep request volume reasonable and let
 * upstream errors surface as `NETWORK` BrokerErrors.
 */

const HERMES_BASE = 'https://hermes.pyth.network'

export interface PythUpdateResponse {
  binary: { encoding: string; data: `0x${string}`[] }
  parsed?: Array<{
    id: string
    price: { price: string; conf: string; expo: number; publish_time: number }
    ema_price: { price: string; conf: string; expo: number; publish_time: number }
  }>
}

/**
 * Fetch the latest signed price update payload(s) for the given Pyth feed IDs.
 * Returns both `binary.data` (for relayer ingestion) and `parsed` (for client-side
 * price display). Pass multiple IDs in one call when a request needs both pair
 * + collateral feeds (e.g., BTC/USD + USDC/USD).
 */
export async function fetchPythUpdateData(feedIds: `0x${string}`[]): Promise<PythUpdateResponse> {
  if (feedIds.length === 0) {
    throw new Error('fetchPythUpdateData: at least one feed ID required')
  }
  const params = feedIds.map(id => `ids[]=${id}`).join('&')
  const url = `${HERMES_BASE}/v2/updates/price/latest?${params}&parsed=true`

  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Pyth Hermes request failed (${res.status}): ${body.slice(0, 200)}`)
  }
  const data = (await res.json()) as PythUpdateResponse
  if (!data.binary?.data || data.binary.data.length === 0) {
    throw new Error('Pyth Hermes returned no binary update data')
  }
  return data
}

/**
 * Convenience: fetch a single feed and return both its raw price (price * 10^expo)
 * and the binary update payload (which is what the relayer needs).
 */
export async function fetchPythPrice(feedId: `0x${string}`): Promise<{
  price: number
  publishTime: Date
  updateData: `0x${string}`[]
}> {
  const res = await fetchPythUpdateData([feedId])
  const parsed = res.parsed?.[0]
  if (!parsed) {
    throw new Error(`Pyth Hermes returned no parsed price for feed ${feedId}`)
  }
  // Pyth stores price as integer * 10^expo where expo is typically -8.
  const raw = Number(parsed.price.price)
  const expo = parsed.price.expo
  const price = raw * Math.pow(10, expo)
  return {
    price,
    publishTime: new Date(parsed.price.publish_time * 1000),
    updateData: res.binary.data,
  }
}
