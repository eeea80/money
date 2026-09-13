/**
 * Price Target Standard Model.
 * Maps to: standard_models/price_target.py
 */

import { z } from 'zod'

// --- Query Params ---

export const PriceTargetQueryParamsSchema = z.object({
  symbol: z.string().transform(v => v.toUpperCase()).describe('Symbol to get data for.'),
  limit: z.coerce.number().int().nullable().default(200).describe('The number of data entries to return.'),
})

export type PriceTargetQueryParams = z.infer<typeof PriceTargetQueryParamsSchema>

// --- Data ---

export const PriceTargetDataSchema = z.object({
  published_date: z.string().nullable().default(null).describe('Published date of the price target.'),
  published_time: z.string().nullable().default(null).describe('Published time of the price target.'),
  symbol: z.string().describe('Symbol representing the entity.'),
  exchange: z.string().nullable().default(null).describe('Exchange where the stock is listed.'),
  company_name: z.string().nullable().default(null).describe('Name of the company.'),
  analyst_name: z.string().nullable().default(null).describe('Analyst name.'),
  analyst_firm: z.string().nullable().default(null).describe('Analyst firm.'),
  currency: z.string().nullable().default(null).describe('Currency of the price target.'),
  price_target: z.number().nullable().default(null).describe('Price target.'),
  adj_price_target: z.number().nullable().default(null).describe('Adjusted price target.'),
  price_target_previous: z.number().nullable().default(null).describe('Previous price target.'),
  previous_adj_price_target: z.number().nullable().default(null).describe('Previous adjusted price target.'),
  price_when_posted: z.number().nullable().default(null).describe('Price when posted.'),
  rating_current: z.string().nullable().default(null).describe('Current rating.'),
  rating_previous: z.string().nullable().default(null).describe('Previous rating.'),
  action: z.string().nullable().default(null).describe('Description of the rating change.'),
}).passthrough()

export type PriceTargetData = z.infer<typeof PriceTargetDataSchema>
