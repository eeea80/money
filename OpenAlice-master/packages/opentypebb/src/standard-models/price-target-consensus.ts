/**
 * Price Target Consensus Standard Model.
 * Maps to: openbb_core/provider/standard_models/price_target_consensus.py
 */

import { z } from 'zod'

export const PriceTargetConsensusQueryParamsSchema = z.object({
  symbol: z.string().nullable().default(null).transform((v) => v?.toUpperCase() ?? null),
}).passthrough()

export type PriceTargetConsensusQueryParams = z.infer<typeof PriceTargetConsensusQueryParamsSchema>

export const PriceTargetConsensusDataSchema = z.object({
  symbol: z.string().describe('Symbol representing the entity requested in the data.'),
  name: z.string().nullable().default(null).describe('The company name.'),
  target_high: z.number().nullable().default(null).describe('High target of the price target consensus.'),
  target_low: z.number().nullable().default(null).describe('Low target of the price target consensus.'),
  target_consensus: z.number().nullable().default(null).describe('Consensus target of the price target consensus.'),
  target_median: z.number().nullable().default(null).describe('Median target of the price target consensus.'),
}).passthrough()

export type PriceTargetConsensusData = z.infer<typeof PriceTargetConsensusDataSchema>
