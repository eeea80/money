/**
 * FMP Income Statement Model.
 * Maps to: openbb_fmp/models/income_statement.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { IncomeStatementQueryParamsSchema, IncomeStatementDataSchema } from '../../../standard-models/income-statement.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getDataMany } from '../utils/helpers.js'

// --- Query Params ---

export const FMPIncomeStatementQueryParamsSchema = IncomeStatementQueryParamsSchema.extend({
  period: z.enum(['q1', 'q2', 'q3', 'q4', 'fy', 'ttm', 'annual', 'quarter']).default('annual').describe('Time period of the data to return.'),
})

export type FMPIncomeStatementQueryParams = z.infer<typeof FMPIncomeStatementQueryParamsSchema>

// --- Data ---

const ALIAS_DICT: Record<string, string> = {
  period_ending: 'date',
  fiscal_period: 'period',
  fiscal_year: 'calendarYear',
  filing_date: 'fillingDate',
  accepted_date: 'acceptedDate',
  reported_currency: 'reportedCurrency',
  revenue: 'revenue',
  cost_of_revenue: 'costOfRevenue',
  gross_profit: 'grossProfit',
  general_and_admin_expense: 'generalAndAdministrativeExpenses',
  research_and_development_expense: 'researchAndDevelopmentExpenses',
  selling_and_marketing_expense: 'sellingAndMarketingExpenses',
  selling_general_and_admin_expense: 'sellingGeneralAndAdministrativeExpenses',
  other_expenses: 'otherExpenses',
  total_operating_expenses: 'operatingExpenses',
  cost_and_expenses: 'costAndExpenses',
  interest_income: 'interestIncome',
  total_interest_expense: 'interestExpense',
  depreciation_and_amortization: 'depreciationAndAmortization',
  ebitda: 'ebitda',
  total_operating_income: 'operatingIncome',
  total_other_income_expenses: 'totalOtherIncomeExpensesNet',
  total_pre_tax_income: 'incomeBeforeTax',
  income_tax_expense: 'incomeTaxExpense',
  consolidated_net_income: 'netIncome',
  basic_earnings_per_share: 'eps',
  diluted_earnings_per_share: 'epsDiluted',
  weighted_average_basic_shares_outstanding: 'weightedAverageShsOut',
  weighted_average_diluted_shares_outstanding: 'weightedAverageShsOutDil',
}

const intOrNull = z.number().int().nullable().default(null)

export const FMPIncomeStatementDataSchema = IncomeStatementDataSchema.extend({
  filing_date: z.string().nullable().default(null).describe('The date when the filing was made.'),
  accepted_date: z.string().nullable().default(null).describe('The date and time when the filing was accepted.'),
  cik: z.string().nullable().default(null).describe('The Central Index Key (CIK) assigned by the SEC.'),
  symbol: z.string().nullable().default(null).describe('The stock ticker symbol.'),
  reported_currency: z.string().nullable().default(null).describe('The currency in which the balance sheet was reported.'),
  revenue: intOrNull.describe('Total revenue.'),
  cost_of_revenue: intOrNull.describe('Cost of revenue.'),
  gross_profit: intOrNull.describe('Gross profit.'),
  general_and_admin_expense: intOrNull.describe('General and administrative expenses.'),
  research_and_development_expense: intOrNull.describe('Research and development expenses.'),
  selling_and_marketing_expense: intOrNull.describe('Selling and marketing expenses.'),
  selling_general_and_admin_expense: intOrNull.describe('Selling, general and administrative expenses.'),
  other_expenses: intOrNull.describe('Other expenses.'),
  total_operating_expenses: intOrNull.describe('Total operating expenses.'),
  cost_and_expenses: intOrNull.describe('Cost and expenses.'),
  interest_income: intOrNull.describe('Interest income.'),
  total_interest_expense: intOrNull.describe('Total interest expenses.'),
  depreciation_and_amortization: intOrNull.describe('Depreciation and amortization.'),
  ebitda: intOrNull.describe('EBITDA.'),
  total_operating_income: intOrNull.describe('Total operating income.'),
  total_other_income_expenses: intOrNull.describe('Total other income and expenses.'),
  total_pre_tax_income: intOrNull.describe('Total pre-tax income.'),
  income_tax_expense: intOrNull.describe('Income tax expense.'),
  consolidated_net_income: intOrNull.describe('Consolidated net income.'),
  basic_earnings_per_share: z.number().nullable().default(null).describe('Basic earnings per share.'),
  diluted_earnings_per_share: z.number().nullable().default(null).describe('Diluted earnings per share.'),
  weighted_average_basic_shares_outstanding: intOrNull.describe('Weighted average basic shares outstanding.'),
  weighted_average_diluted_shares_outstanding: intOrNull.describe('Weighted average diluted shares outstanding.'),
}).passthrough()

export type FMPIncomeStatementData = z.infer<typeof FMPIncomeStatementDataSchema>

// --- Fetcher ---

export class FMPIncomeStatementFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPIncomeStatementQueryParams {
    return FMPIncomeStatementQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPIncomeStatementQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    let baseUrl = 'https://financialmodelingprep.com/stable/income-statement'

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
    query: FMPIncomeStatementQueryParams,
    data: Record<string, unknown>[],
  ): FMPIncomeStatementData[] {
    return data.map((d) => {
      const aliased = applyAliases(d, ALIAS_DICT)
      return FMPIncomeStatementDataSchema.parse(aliased)
    })
  }
}
