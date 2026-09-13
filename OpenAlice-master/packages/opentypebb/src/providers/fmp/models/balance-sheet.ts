/**
 * FMP Balance Sheet Model.
 * Maps to: openbb_fmp/models/balance_sheet.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { BalanceSheetQueryParamsSchema, BalanceSheetDataSchema } from '../../../standard-models/balance-sheet.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getDataMany } from '../utils/helpers.js'
import type { FinancialStatementPeriods } from '../utils/definitions.js'

// --- Query Params ---

export const FMPBalanceSheetQueryParamsSchema = BalanceSheetQueryParamsSchema.extend({
  period: z.enum(['q1', 'q2', 'q3', 'q4', 'fy', 'ttm', 'annual', 'quarter']).default('annual').describe('Time period of the data to return.'),
})

export type FMPBalanceSheetQueryParams = z.infer<typeof FMPBalanceSheetQueryParamsSchema>

// --- Data ---

const ALIAS_DICT: Record<string, string> = {
  period_ending: 'date',
  fiscal_period: 'period',
  fiscal_year: 'calendarYear',
  filing_date: 'fillingDate',
  accepted_date: 'acceptedDate',
  reported_currency: 'reportedCurrency',
  cash_and_cash_equivalents: 'cashAndCashEquivalents',
  short_term_investments: 'shortTermInvestments',
  cash_and_short_term_investments: 'cashAndShortTermInvestments',
  net_receivables: 'netReceivables',
  inventory: 'inventories',
  other_current_assets: 'otherCurrentAssets',
  total_current_assets: 'totalCurrentAssets',
  plant_property_equipment_net: 'propertyPlantEquipmentNet',
  goodwill: 'goodwill',
  prepaid_expenses: 'prepaids',
  intangible_assets: 'intangibleAssets',
  goodwill_and_intangible_assets: 'goodwillAndIntangibleAssets',
  long_term_investments: 'longTermInvestments',
  tax_assets: 'taxAssets',
  other_non_current_assets: 'otherNonCurrentAssets',
  non_current_assets: 'totalNonCurrentAssets',
  other_assets: 'otherAssets',
  total_assets: 'totalAssets',
  accounts_payable: 'accountPayables',
  short_term_debt: 'shortTermDebt',
  tax_payables: 'taxPayables',
  current_deferred_revenue: 'deferredRevenue',
  other_current_liabilities: 'otherCurrentLiabilities',
  total_current_liabilities: 'totalCurrentLiabilities',
  long_term_debt: 'longTermDebt',
  deferred_revenue_non_current: 'deferredRevenueNonCurrent',
  deferred_tax_liabilities_non_current: 'deferredTaxLiabilitiesNonCurrent',
  other_non_current_liabilities: 'otherNonCurrentLiabilities',
  total_non_current_liabilities: 'totalNonCurrentLiabilities',
  other_liabilities: 'otherLiabilities',
  capital_lease_obligations: 'capitalLeaseObligations',
  total_liabilities: 'totalLiabilities',
  preferred_stock: 'preferredStock',
  common_stock: 'commonStock',
  retained_earnings: 'retainedEarnings',
  accumulated_other_comprehensive_income: 'accumulatedOtherComprehensiveIncomeLoss',
  other_shareholders_equity: 'otherStockholdersEquity',
  other_total_shareholders_equity: 'otherTotalStockholdersEquity',
  total_common_equity: 'totalStockholdersEquity',
  total_equity_non_controlling_interests: 'totalEquity',
  total_liabilities_and_shareholders_equity: 'totalLiabilitiesAndStockholdersEquity',
  minority_interest: 'minorityInterest',
  total_liabilities_and_total_equity: 'totalLiabilitiesAndTotalEquity',
  total_investments: 'totalInvestments',
  total_debt: 'totalDebt',
  net_debt: 'netDebt',
}

const intOrNull = z.number().int().nullable().default(null)

export const FMPBalanceSheetDataSchema = BalanceSheetDataSchema.extend({
  filing_date: z.string().nullable().default(null).describe('The date when the filing was made.'),
  accepted_date: z.string().nullable().default(null).describe('The date and time when the filing was accepted.'),
  cik: z.string().nullable().default(null).describe('The Central Index Key (CIK) assigned by the SEC.'),
  symbol: z.string().nullable().default(null).describe('The stock ticker symbol.'),
  reported_currency: z.string().nullable().default(null).describe('The currency in which the balance sheet was reported.'),
  cash_and_cash_equivalents: intOrNull.describe('Cash and cash equivalents.'),
  short_term_investments: intOrNull.describe('Short term investments.'),
  cash_and_short_term_investments: intOrNull.describe('Cash and short term investments.'),
  net_receivables: intOrNull.describe('Net receivables.'),
  inventory: intOrNull.describe('Inventory.'),
  other_current_assets: intOrNull.describe('Other current assets.'),
  total_current_assets: intOrNull.describe('Total current assets.'),
  plant_property_equipment_net: intOrNull.describe('Plant property equipment net.'),
  goodwill: intOrNull.describe('Goodwill.'),
  intangible_assets: intOrNull.describe('Intangible assets.'),
  goodwill_and_intangible_assets: intOrNull.describe('Goodwill and intangible assets.'),
  long_term_investments: intOrNull.describe('Long term investments.'),
  tax_assets: intOrNull.describe('Tax assets.'),
  other_non_current_assets: intOrNull.describe('Other non current assets.'),
  non_current_assets: intOrNull.describe('Total non current assets.'),
  other_assets: intOrNull.describe('Other assets.'),
  total_assets: intOrNull.describe('Total assets.'),
  accounts_payable: intOrNull.describe('Accounts payable.'),
  prepaid_expenses: intOrNull.describe('Prepaid expenses.'),
  short_term_debt: intOrNull.describe('Short term debt.'),
  tax_payables: intOrNull.describe('Tax payables.'),
  current_deferred_revenue: intOrNull.describe('Current deferred revenue.'),
  other_current_liabilities: intOrNull.describe('Other current liabilities.'),
  total_current_liabilities: intOrNull.describe('Total current liabilities.'),
  long_term_debt: intOrNull.describe('Long term debt.'),
  deferred_revenue_non_current: intOrNull.describe('Non current deferred revenue.'),
  deferred_tax_liabilities_non_current: intOrNull.describe('Deferred tax liabilities non current.'),
  other_non_current_liabilities: intOrNull.describe('Other non current liabilities.'),
  total_non_current_liabilities: intOrNull.describe('Total non current liabilities.'),
  capital_lease_obligations: intOrNull.describe('Capital lease obligations.'),
  other_liabilities: intOrNull.describe('Other liabilities.'),
  total_liabilities: intOrNull.describe('Total liabilities.'),
  preferred_stock: intOrNull.describe('Preferred stock.'),
  common_stock: intOrNull.describe('Common stock.'),
  retained_earnings: intOrNull.describe('Retained earnings.'),
  accumulated_other_comprehensive_income: intOrNull.describe('Accumulated other comprehensive income (loss).'),
  other_shareholders_equity: intOrNull.describe('Other shareholders equity.'),
  other_total_shareholders_equity: intOrNull.describe('Other total shareholders equity.'),
  total_common_equity: intOrNull.describe('Total common equity.'),
  total_equity_non_controlling_interests: intOrNull.describe('Total equity non controlling interests.'),
  total_liabilities_and_shareholders_equity: intOrNull.describe('Total liabilities and shareholders equity.'),
  minority_interest: intOrNull.describe('Minority interest.'),
  total_liabilities_and_total_equity: intOrNull.describe('Total liabilities and total equity.'),
  total_investments: intOrNull.describe('Total investments.'),
  total_debt: intOrNull.describe('Total debt.'),
  net_debt: intOrNull.describe('Net debt.'),
}).passthrough()

export type FMPBalanceSheetData = z.infer<typeof FMPBalanceSheetDataSchema>

// --- Fetcher ---

export class FMPBalanceSheetFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPBalanceSheetQueryParams {
    return FMPBalanceSheetQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPBalanceSheetQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    let baseUrl = 'https://financialmodelingprep.com/stable/balance-sheet-statement'

    if (query.period === 'ttm') {
      baseUrl += '-ttm'
    }

    const url = baseUrl
      + `?symbol=${query.symbol}`
      + (query.period !== 'ttm' ? `&period=${query.period}` : '')
      + `&limit=${query.limit ?? 5}`
      + `&apikey=${apiKey}`

    return getDataMany(url)
  }

  static override transformData(
    query: FMPBalanceSheetQueryParams,
    data: Record<string, unknown>[],
  ): FMPBalanceSheetData[] {
    return data.map((d) => {
      const aliased = applyAliases(d, ALIAS_DICT)
      return FMPBalanceSheetDataSchema.parse(aliased)
    })
  }
}
