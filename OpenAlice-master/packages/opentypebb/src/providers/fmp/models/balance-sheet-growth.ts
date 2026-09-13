/**
 * FMP Balance Sheet Growth Model.
 * Maps to: openbb_fmp/models/balance_sheet_growth.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { BalanceSheetGrowthQueryParamsSchema, BalanceSheetGrowthDataSchema } from '../../../standard-models/balance-sheet-growth.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getDataMany } from '../utils/helpers.js'

// --- Query Params ---

export const FMPBalanceSheetGrowthQueryParamsSchema = BalanceSheetGrowthQueryParamsSchema.extend({
  period: z.enum(['annual', 'quarter']).default('annual').describe('Time period of the data to return.'),
  limit: z.coerce.number().int().nullable().default(null).describe('The number of data entries to return.'),
})

export type FMPBalanceSheetGrowthQueryParams = z.infer<typeof FMPBalanceSheetGrowthQueryParamsSchema>

// --- Data ---

const ALIAS_DICT: Record<string, string> = {
  period_ending: 'date',
  fiscal_year: 'calendarYear',
  fiscal_period: 'period',
  reported_currency: 'reportedCurrency',
  growth_other_total_shareholders_equity: 'growthOthertotalStockholdersEquity',
  growth_total_shareholders_equity: 'growthTotalStockholdersEquity',
  growth_total_liabilities_and_shareholders_equity: 'growthTotalLiabilitiesAndStockholdersEquity',
  growth_accumulated_other_comprehensive_income: 'growthAccumulatedOtherComprehensiveIncomeLoss',
  growth_prepaid_expenses: 'growthPrepaids',
}

const pctOrNull = z.number().nullable().default(null)

export const FMPBalanceSheetGrowthDataSchema = BalanceSheetGrowthDataSchema.extend({
  symbol: z.string().nullable().default(null).describe('The stock ticker symbol.'),
  reported_currency: z.string().nullable().default(null).describe('The currency in which the financial data is reported.'),
  growth_cash_and_cash_equivalents: pctOrNull.describe('Growth rate of cash and cash equivalents.'),
  growth_short_term_investments: pctOrNull.describe('Growth rate of short-term investments.'),
  growth_cash_and_short_term_investments: pctOrNull.describe('Growth rate of cash and short-term investments.'),
  growth_accounts_receivables: pctOrNull.describe('Growth rate of accounts receivable.'),
  growth_other_receivables: pctOrNull.describe('Growth rate of other receivables.'),
  growth_net_receivables: pctOrNull.describe('Growth rate of net receivables.'),
  growth_inventory: pctOrNull.describe('Growth rate of inventory.'),
  growth_other_current_assets: pctOrNull.describe('Growth rate of other current assets.'),
  growth_total_current_assets: pctOrNull.describe('Growth rate of total current assets.'),
  growth_property_plant_equipment_net: pctOrNull.describe('Growth rate of net property, plant, and equipment.'),
  growth_goodwill: pctOrNull.describe('Growth rate of goodwill.'),
  growth_intangible_assets: pctOrNull.describe('Growth rate of intangible assets.'),
  growth_goodwill_and_intangible_assets: pctOrNull.describe('Growth rate of goodwill and intangible assets.'),
  growth_long_term_investments: pctOrNull.describe('Growth rate of long-term investments.'),
  growth_tax_assets: pctOrNull.describe('Growth rate of tax assets.'),
  growth_other_non_current_assets: pctOrNull.describe('Growth rate of other non-current assets.'),
  growth_total_non_current_assets: pctOrNull.describe('Growth rate of total non-current assets.'),
  growth_other_assets: pctOrNull.describe('Growth rate of other assets.'),
  growth_total_assets: pctOrNull.describe('Growth rate of total assets.'),
  growth_account_payables: pctOrNull.describe('Growth rate of accounts payable.'),
  growth_other_payables: pctOrNull.describe('Growth rate of other payables.'),
  growth_total_payables: pctOrNull.describe('Growth rate of total payables.'),
  growth_accrued_expenses: pctOrNull.describe('Growth rate of accrued expenses.'),
  growth_prepaid_expenses: pctOrNull.describe('Growth rate of prepaid expenses.'),
  growth_capital_lease_obligations_current: pctOrNull.describe('Growth rate of current capital lease obligations.'),
  growth_short_term_debt: pctOrNull.describe('Growth rate of short-term debt.'),
  growth_tax_payables: pctOrNull.describe('Growth rate of tax payables.'),
  growth_deferred_tax_liabilities_non_current: pctOrNull.describe('Growth rate of non-current deferred tax liabilities.'),
  growth_deferred_revenue: pctOrNull.describe('Growth rate of deferred revenue.'),
  growth_other_current_liabilities: pctOrNull.describe('Growth rate of other current liabilities.'),
  growth_total_current_liabilities: pctOrNull.describe('Growth rate of total current liabilities.'),
  growth_deferred_revenue_non_current: pctOrNull.describe('Growth rate of non-current deferred revenue.'),
  growth_long_term_debt: pctOrNull.describe('Growth rate of long-term debt.'),
  growth_deferrred_tax_liabilities_non_current: pctOrNull.describe('Growth rate of non-current deferred tax liabilities (alternate).'),
  growth_other_non_current_liabilities: pctOrNull.describe('Growth rate of other non-current liabilities.'),
  growth_total_non_current_liabilities: pctOrNull.describe('Growth rate of total non-current liabilities.'),
  growth_other_liabilities: pctOrNull.describe('Growth rate of other liabilities.'),
  growth_total_liabilities: pctOrNull.describe('Growth rate of total liabilities.'),
  growth_retained_earnings: pctOrNull.describe('Growth rate of retained earnings.'),
  growth_accumulated_other_comprehensive_income: pctOrNull.describe('Growth rate of accumulated other comprehensive income/loss.'),
  growth_minority_interest: pctOrNull.describe('Growth rate of minority interest.'),
  growth_additional_paid_in_capital: pctOrNull.describe('Growth rate of additional paid-in capital.'),
  growth_other_total_shareholders_equity: pctOrNull.describe("Growth rate of other total stockholders' equity."),
  growth_total_shareholders_equity: pctOrNull.describe("Growth rate of total stockholders' equity."),
  growth_common_stock: pctOrNull.describe('Growth rate of common stock.'),
  growth_preferred_stock: pctOrNull.describe('Growth rate of preferred stock.'),
  growth_treasury_stock: pctOrNull.describe('Growth rate of treasury stock.'),
  growth_total_equity: pctOrNull.describe('Growth rate of total equity.'),
  growth_total_liabilities_and_shareholders_equity: pctOrNull.describe("Growth rate of total liabilities and stockholders' equity."),
  growth_total_investments: pctOrNull.describe('Growth rate of total investments.'),
  growth_total_debt: pctOrNull.describe('Growth rate of total debt.'),
  growth_net_debt: pctOrNull.describe('Growth rate of net debt.'),
}).passthrough()

export type FMPBalanceSheetGrowthData = z.infer<typeof FMPBalanceSheetGrowthDataSchema>

// --- Fetcher ---

export class FMPBalanceSheetGrowthFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPBalanceSheetGrowthQueryParams {
    return FMPBalanceSheetGrowthQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPBalanceSheetGrowthQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    const url = 'https://financialmodelingprep.com/stable/balance-sheet-statement-growth'
      + `?symbol=${query.symbol}`
      + `&period=${query.period}`
      + `&limit=${query.limit ?? 5}`
      + `&apikey=${apiKey}`
    return getDataMany(url)
  }

  static override transformData(
    query: FMPBalanceSheetGrowthQueryParams,
    data: Record<string, unknown>[],
  ): FMPBalanceSheetGrowthData[] {
    return data.map(d => {
      const aliased = applyAliases(d, ALIAS_DICT)
      return FMPBalanceSheetGrowthDataSchema.parse(aliased)
    })
  }
}
