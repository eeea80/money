/**
 * Crypto Search Standard Model.
 * Maps to: openbb_core/provider/standard_models/crypto_search.py
 */

import { z } from 'zod'

export const CryptoSearchQueryParamsSchema = z.object({
  query: z.string().nullable().default(null).describe('Search query.'),
}).passthrough()

export type CryptoSearchQueryParams = z.infer<typeof CryptoSearchQueryParamsSchema>

export const CryptoSearchDataSchema = z.object({
  symbol: z.string().describe('Symbol representing the entity requested in the data. (Crypto)'),
  name: z.string().nullable().default(null).describe('Name of the crypto.'),
}).passthrough()

export type CryptoSearchData = z.infer<typeof CryptoSearchDataSchema>
