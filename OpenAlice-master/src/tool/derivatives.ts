/**
 * Derivatives AI Tools
 *
 * Crypto options surface (Deribit, keyless). The futures curve is already
 * served by the Term Structure board / reference contract; this exposes the
 * options chain to the agent for vol / skew / positioning reads.
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { DerivativesClientLike } from '@/domain/market-data/client/types'

export function createDerivativesTools(derivativesClient: DerivativesClientLike) {
  return {
    cryptoOptionsChains: tool({
      description: `Get the crypto options chain from Deribit (keyless).

Returns all listed option contracts for the underlying: strike, expiration,
option type, bid/ask, mark, implied volatility, open interest and volume.
The chain is LARGE (hundreds of contracts) — filter by expiration/strike
range in your analysis, and prefer reading a few expiries at a time.

Use for: IV levels and skew (puts vs calls), open-interest walls near
strikes, positioning around events.`,
      inputSchema: z.object({
        symbol: z.enum(['BTC', 'ETH', 'PAXG']).describe('Underlying: BTC, ETH, or PAXG (gold token)'),
      }).meta({ examples: [{ symbol: 'BTC' }] }),
      execute: async ({ symbol }) => {
        return await derivativesClient.getOptionsChains({ symbol, provider: 'deribit' })
      },
    }),

    cryptoFuturesInstruments: tool({
      description: `List all Deribit futures instruments (keyless).

Returns every listed future/perpetual: instrument id, symbol
(e.g. BTC-PERPETUAL, BTC-26JUN26), base/counter currency, contract size,
expiration. Use to discover what's tradeable before reading the curve or
a specific contract.`,
      inputSchema: z.object({}).meta({ examples: [{}] }),
      execute: async () => {
        return await derivativesClient.getFuturesInstruments({ provider: 'deribit' })
      },
    }),
  }
}
