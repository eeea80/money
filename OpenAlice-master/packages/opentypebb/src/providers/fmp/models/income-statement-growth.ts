/**
 * FMP Income Statement Growth Model.
 * Maps to: openbb_fmp/models/income_statement_growth.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { IncomeStatementGrowthQueryParamsSchema, IncomeStatementGrowthDataSchema } from '../../../standard-models/income-statement-growth.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getDataMany } from '../utils/helpers.js'

// --- Query Params ---

export const FMPIncomeStatementGrowthQueryParamsSchema = IncomeStatementGrowthQueryParamsSchema.extend({
  period: z.enum(['annual', 'quarter']).default('annual').describe('Time period of the data to return.'),
})

export type FMPIncomeStatementGrowthQueryParams = z.infer<typeof FMPIncomeStatementGrowthQueryParamsSchema>

// --- Data ---

const ALIAS_DICT: Record<string, string> = {
  period_ending: 'date',
  fiscal_year: 'calendarYear',
  fiscal_period: 'period',
  growth_ebit: 'growthEBIT',
  growth_ebitda: 'growthEBITDA',
  growth_basic_earings_per_share: 'growthEPS',
  growth_gross_profit_margin: 'growthGrossProfitRatio',
  growth_consolidated_net_income: 'growthNetIncome',
  growth_diluted_earnings_per_share: 'growthEPSDiluted',
  growth_weighted_average_basic_shares_outstanding: 'growthWeightedAverageShsOut',
  growth_weighted_average_diluted_shares_outstanding: 'growthWeightedAverageShsOutDil',
  growth_research_and_development_expense: 'growthResearchAndDevelopmentExpenses',
  growth_general_and_admin_expense: 'growthGeneralAndAdministrativeExpenses',
  growth_selling_and_marketing_expense: 'growthSellingAndMarketingExpenses',
}

const pctOrNull = z.number().nullable().default(null)

export const FMPIncomeStatementGrowthDataSchema = IncomeStatementGrowthDataSchema.extend({
  symbol: z.string().nullable().default(null).describe('The stock ticker symbol.'),
  reported_currency: z.string().nullable().default(null).describe('The currency in which the financial data is reported.'),
  growth_revenue: pctOrNull.describe('Growth rate of total revenue.'),
  growth_cost_of_revenue: pctOrNull.describe('Growth rate of cost of goods sold.'),
  growth_gross_profit: pctOrNull.describe('Growth rate of gross profit.'),
  growth_gross_profit_margin: pctOrNull.describe('Growth rate of gross profit as a percentage of revenue.'),
  growth_general_and_admin_expense: pctOrNull.describe('Growth rate of general and administrative expenses.'),
  growth_research_and_development_expense: pctOrNull.describe('Growth rate of expenses on research and development.'),
  growth_selling_and_marketing_expense: pctOrNull.describe('Growth rate of expenses on selling and marketing activities.'),
  growth_other_expenses: pctOrNull.describe('Growth rate of other operating expenses.'),
  growth_operating_expenses: pctOrNull.describe('Growth rate of total operating expenses.'),
  growth_cost_and_expenses: pctOrNull.describe('Growth rate of total costs and expenses.'),
  growth_depreciation_and_amortization: pctOrNull.describe('Growth rate of depreciation and amortization expenses.'),
  growth_interest_income: pctOrNull.describe('Growth rate of interest income.'),
  growth_interest_expense: pctOrNull.describe('Growth rate of interest expenses.'),
  growth_net_interest_income: pctOrNull.describe('Growth rate of net interest income.'),
  growth_ebit: pctOrNull.describe('Growth rate of Earnings Before Interest and Taxes (EBIT).'),
  growth_ebitda: pctOrNull.describe('Growth rate of EBITDA.'),
  growth_operating_income: pctOrNull.describe('Growth rate of operating income.'),
  growth_non_operating_income_excluding_interest: pctOrNull.describe('Growth rate of non-operating income excluding interest.'),
  growth_total_other_income_expenses_net: pctOrNull.describe('Growth rate of net total other income and expenses.'),
  growth_other_adjustments_to_net_income: pctOrNull.describe('Growth rate of other adjustments to net income.'),
  growth_net_income_deductions: pctOrNull.describe('Growth rate of net income deductions.'),
  growth_income_before_tax: pctOrNull.describe('Growth rate of income before taxes.'),
  growth_income_tax_expense: pctOrNull.describe('Growth rate of income tax expenses.'),
  growth_net_income_from_continuing_operations: pctOrNull.describe('Growth rate of net income from continuing operations.'),
  growth_consolidated_net_income: pctOrNull.describe('Growth rate of net income.'),
  growth_basic_earings_per_share: pctOrNull.describe('Growth rate of Earnings Per Share (EPS).'),
  growth_diluted_earnings_per_share: pctOrNull.describe('Growth rate of diluted Earnings Per Share (EPS).'),
  growth_weighted_average_basic_shares_outstanding: pctOrNull.describe('Growth rate of weighted average shares outstanding.'),
  growth_weighted_average_diluted_shares_outstanding: pctOrNull.describe('Growth rate of diluted weighted average shares outstanding.'),
}).passthrough()

export type FMPIncomeStatementGrowthData = z.infer<typeof FMPIncomeStatementGrowthDataSchema>

// --- Fetcher ---

export class FMPIncomeStatementGrowthFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPIncomeStatementGrowthQueryParams {
    return FMPIncomeStatementGrowthQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPIncomeStatementGrowthQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    const url = 'https://financialmodelingprep.com/stable/income-statement-growth'
      + `?symbol=${query.symbol}`
      + `&period=${query.period}`
      + `&limit=${query.limit ?? 5}`
      + `&apikey=${apiKey}`
    return getDataMany(url)
  }

  static override transformData(
    query: FMPIncomeStatementGrowthQueryParams,
    data: Record<string, unknown>[],
  ): FMPIncomeStatementGrowthData[] {
    return data.map(d => {
      const aliased = applyAliases(d, ALIAS_DICT)
      return FMPIncomeStatementGrowthDataSchema.parse(aliased)
    })
  }
}
