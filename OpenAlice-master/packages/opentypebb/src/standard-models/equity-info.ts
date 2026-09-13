/**
 * Equity Info Standard Model.
 * Maps to: openbb_core/provider/standard_models/equity_info.py
 */

import { z } from 'zod'

export const EquityInfoQueryParamsSchema = z.object({
  symbol: z.string().transform((v) => v.toUpperCase()),
}).passthrough()

export type EquityInfoQueryParams = z.infer<typeof EquityInfoQueryParamsSchema>

export const EquityInfoDataSchema = z.object({
  symbol: z.string().describe('Symbol representing the entity requested in the data.'),
  name: z.string().nullable().default(null).describe('Common name of the company.'),
  cik: z.string().nullable().default(null).describe('Central Index Key (CIK) for the requested entity.'),
  cusip: z.string().nullable().default(null).describe('CUSIP identifier for the company.'),
  isin: z.string().nullable().default(null).describe('International Securities Identification Number.'),
  lei: z.string().nullable().default(null).describe('Legal Entity Identifier assigned to the company.'),
  legal_name: z.string().nullable().default(null).describe('Official legal name of the company.'),
  stock_exchange: z.string().nullable().default(null).describe('Stock exchange where the company is traded.'),
  sic: z.number().int().nullable().default(null).describe('Standard Industrial Classification code.'),
  short_description: z.string().nullable().default(null).describe('Short description of the company.'),
  long_description: z.string().nullable().default(null).describe('Long description of the company.'),
  ceo: z.string().nullable().default(null).describe('Chief Executive Officer of the company.'),
  company_url: z.string().nullable().default(null).describe("URL of the company's website."),
  business_address: z.string().nullable().default(null).describe("Address of the company's headquarters."),
  mailing_address: z.string().nullable().default(null).describe('Mailing address of the company.'),
  business_phone_no: z.string().nullable().default(null).describe("Phone number of the company's headquarters."),
  hq_address1: z.string().nullable().default(null).describe("Address of the company's headquarters."),
  hq_address2: z.string().nullable().default(null).describe("Address of the company's headquarters."),
  hq_address_city: z.string().nullable().default(null).describe("City of the company's headquarters."),
  hq_address_postal_code: z.string().nullable().default(null).describe("Zip code of the company's headquarters."),
  hq_state: z.string().nullable().default(null).describe("State of the company's headquarters."),
  hq_country: z.string().nullable().default(null).describe("Country of the company's headquarters."),
  inc_state: z.string().nullable().default(null).describe('State in which the company is incorporated.'),
  inc_country: z.string().nullable().default(null).describe('Country in which the company is incorporated.'),
  employees: z.number().int().nullable().default(null).describe('Number of employees.'),
  entity_legal_form: z.string().nullable().default(null).describe('Legal form of the company.'),
  entity_status: z.string().nullable().default(null).describe('Status of the company.'),
  latest_filing_date: z.string().nullable().default(null).describe("Date of the company's latest filing."),
  irs_number: z.string().nullable().default(null).describe('IRS number assigned to the company.'),
  sector: z.string().nullable().default(null).describe('Sector in which the company operates.'),
  industry_category: z.string().nullable().default(null).describe('Category of industry.'),
  industry_group: z.string().nullable().default(null).describe('Group of industry.'),
  template: z.string().nullable().default(null).describe("Template used to standardize the company's financial statements."),
  standardized_active: z.boolean().nullable().default(null).describe('Whether the company is active or not.'),
  first_fundamental_date: z.string().nullable().default(null).describe("Date of the company's first fundamental."),
  last_fundamental_date: z.string().nullable().default(null).describe("Date of the company's last fundamental."),
  first_stock_price_date: z.string().nullable().default(null).describe("Date of the company's first stock price."),
  last_stock_price_date: z.string().nullable().default(null).describe("Date of the company's last stock price."),
}).passthrough()

export type EquityInfoData = z.infer<typeof EquityInfoDataSchema>
