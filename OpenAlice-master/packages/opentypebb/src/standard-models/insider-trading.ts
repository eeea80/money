/**
 * Insider Trading Standard Model.
 * Maps to: openbb_core/provider/standard_models/insider_trading.py
 */

import { z } from 'zod'

export const InsiderTradingQueryParamsSchema = z.object({
  symbol: z.string().transform((v) => v.toUpperCase()),
  limit: z.number().int().nullable().default(null).describe('The number of data entries to return.'),
}).passthrough()

export type InsiderTradingQueryParams = z.infer<typeof InsiderTradingQueryParamsSchema>

export const InsiderTradingDataSchema = z.object({
  symbol: z.string().nullable().default(null).describe('Symbol representing the entity requested in the data.'),
  company_cik: z.string().nullable().default(null).describe('CIK number of the company.'),
  filing_date: z.string().nullable().default(null).describe('Filing date of the trade.'),
  transaction_date: z.string().nullable().default(null).describe('Date of the transaction.'),
  owner_cik: z.union([z.number(), z.string()]).nullable().default(null).describe("Reporting individual's CIK."),
  owner_name: z.string().nullable().default(null).describe('Name of the reporting individual.'),
  owner_title: z.string().nullable().default(null).describe('The title held by the reporting individual.'),
  ownership_type: z.string().nullable().default(null).describe('Type of ownership, e.g., direct or indirect.'),
  transaction_type: z.string().nullable().default(null).describe('Type of transaction being reported.'),
  acquisition_or_disposition: z.string().nullable().default(null).describe('Acquisition or disposition of the shares.'),
  security_type: z.string().nullable().default(null).describe('The type of security transacted.'),
  securities_owned: z.number().nullable().default(null).describe('Number of securities owned by the reporting individual.'),
  securities_transacted: z.number().nullable().default(null).describe('Number of securities transacted.'),
  transaction_price: z.number().nullable().default(null).describe('The price of the transaction.'),
  filing_url: z.string().nullable().default(null).describe('Link to the filing.'),
}).passthrough()

export type InsiderTradingData = z.infer<typeof InsiderTradingDataSchema>
