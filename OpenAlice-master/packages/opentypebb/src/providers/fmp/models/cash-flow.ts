/**
 * FMP Cash Flow Statement Model.
 * Maps to: openbb_fmp/models/cash_flow.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { CashFlowStatementQueryParamsSchema, CashFlowStatementDataSchema } from '../../../standard-models/cash-flow.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getDataMany } from '../utils/helpers.js'

// --- Query Params ---

export const FMPCashFlowStatementQueryParamsSchema = CashFlowStatementQueryParamsSchema.extend({
  period: z.enum(['q1', 'q2', 'q3', 'q4', 'fy', 'ttm', 'annual', 'quarter']).default('annual').describe('Time period of the data to return.'),
})

export type FMPCashFlowStatementQueryParams = z.infer<typeof FMPCashFlowStatementQueryParamsSchema>

// --- Data ---

const ALIAS_DICT: Record<string, string> = {
  period_ending: 'date',
  fiscal_period: 'period',
  fiscal_year: 'calendarYear',
  filing_date: 'fillingDate',
  accepted_date: 'acceptedDate',
  reported_currency: 'reportedCurrency',
  net_income: 'netIncome',
  depreciation_and_amortization: 'depreciationAndAmortization',
  deferred_income_tax: 'deferredIncomeTax',
  stock_based_compensation: 'stockBasedCompensation',
  change_in_working_capital: 'changeInWorkingCapital',
  change_in_account_receivables: 'accountsReceivables',
  change_in_inventory: 'inventory',
  change_in_account_payable: 'accountsPayables',
  change_in_other_working_capital: 'otherWorkingCapital',
  change_in_other_non_cash_items: 'otherNonCashItems',
  net_cash_from_operating_activities: 'netCashProvidedByOperatingActivities',
  purchase_of_property_plant_and_equipment: 'investmentsInPropertyPlantAndEquipment',
  acquisitions: 'acquisitionsNet',
  purchase_of_investment_securities: 'purchasesOfInvestments',
  sale_and_maturity_of_investments: 'salesMaturitiesOfInvestments',
  other_investing_activities: 'otherInvestingActivities',
  net_cash_from_investing_activities: 'netCashProvidedByInvestingActivities',
  repayment_of_debt: 'debtRepayment',
  issuance_of_common_equity: 'commonStockIssuance',
  repurchase_of_common_equity: 'commonStockRepurchased',
  net_common_equity_issuance: 'netCommonStockIssuance',
  net_preferred_equity_issuance: 'netPreferredStockIssuance',
  net_equity_issuance: 'netStockIssuance',
  payment_of_dividends: 'dividendsPaid',
  other_financing_activities: 'otherFinancingActivites',
  net_cash_from_financing_activities: 'netCashProvidedByFinancingActivities',
  effect_of_exchange_rate_changes_on_cash: 'effectOfForexChangesOnCash',
  net_change_in_cash_and_equivalents: 'netChangeInCash',
  cash_at_beginning_of_period: 'cashAtBeginningOfPeriod',
  cash_at_end_of_period: 'cashAtEndOfPeriod',
  operating_cash_flow: 'operatingCashFlow',
  capital_expenditure: 'capitalExpenditure',
  free_cash_flow: 'freeCashFlow',
}

const intOrNull = z.number().int().nullable().default(null)

export const FMPCashFlowStatementDataSchema = CashFlowStatementDataSchema.extend({
  fiscal_year: z.number().int().nullable().default(null).describe('The fiscal year of the fiscal period.'),
  filing_date: z.string().nullable().default(null).describe('The date of the filing.'),
  accepted_date: z.string().nullable().default(null).describe('The date the filing was accepted.'),
  cik: z.string().nullable().default(null).describe('The Central Index Key (CIK) assigned by the SEC.'),
  symbol: z.string().nullable().default(null).describe('The stock ticker symbol.'),
  reported_currency: z.string().nullable().default(null).describe('The currency in which the cash flow statement was reported.'),
  net_income: intOrNull.describe('Net income.'),
  depreciation_and_amortization: intOrNull.describe('Depreciation and amortization.'),
  deferred_income_tax: intOrNull.describe('Deferred income tax.'),
  stock_based_compensation: intOrNull.describe('Stock-based compensation.'),
  change_in_working_capital: intOrNull.describe('Change in working capital.'),
  change_in_account_receivables: intOrNull.describe('Change in account receivables.'),
  change_in_inventory: intOrNull.describe('Change in inventory.'),
  change_in_account_payable: intOrNull.describe('Change in account payable.'),
  change_in_other_working_capital: intOrNull.describe('Change in other working capital.'),
  change_in_other_non_cash_items: intOrNull.describe('Change in other non-cash items.'),
  net_cash_from_operating_activities: intOrNull.describe('Net cash from operating activities.'),
  purchase_of_property_plant_and_equipment: intOrNull.describe('Purchase of property, plant and equipment.'),
  acquisitions: intOrNull.describe('Acquisitions.'),
  purchase_of_investment_securities: intOrNull.describe('Purchase of investment securities.'),
  sale_and_maturity_of_investments: intOrNull.describe('Sale and maturity of investments.'),
  other_investing_activities: intOrNull.describe('Other investing activities.'),
  net_cash_from_investing_activities: intOrNull.describe('Net cash from investing activities.'),
  repayment_of_debt: intOrNull.describe('Repayment of debt.'),
  issuance_of_common_equity: intOrNull.describe('Issuance of common equity.'),
  repurchase_of_common_equity: intOrNull.describe('Repurchase of common equity.'),
  payment_of_dividends: intOrNull.describe('Payment of dividends.'),
  other_financing_activities: intOrNull.describe('Other financing activities.'),
  net_cash_from_financing_activities: intOrNull.describe('Net cash from financing activities.'),
  effect_of_exchange_rate_changes_on_cash: intOrNull.describe('Effect of exchange rate changes on cash.'),
  net_change_in_cash_and_equivalents: intOrNull.describe('Net change in cash and equivalents.'),
  cash_at_beginning_of_period: intOrNull.describe('Cash at beginning of period.'),
  cash_at_end_of_period: intOrNull.describe('Cash at end of period.'),
  operating_cash_flow: intOrNull.describe('Operating cash flow.'),
  capital_expenditure: intOrNull.describe('Capital expenditure.'),
  free_cash_flow: intOrNull.describe('Free cash flow.'),
}).passthrough()

export type FMPCashFlowStatementData = z.infer<typeof FMPCashFlowStatementDataSchema>

// --- Fetcher ---

export class FMPCashFlowStatementFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPCashFlowStatementQueryParams {
    return FMPCashFlowStatementQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPCashFlowStatementQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    let baseUrl = 'https://financialmodelingprep.com/stable/cash-flow-statement'

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
    query: FMPCashFlowStatementQueryParams,
    data: Record<string, unknown>[],
  ): FMPCashFlowStatementData[] {
    return data.map((d) => {
      const aliased = applyAliases(d, ALIAS_DICT)
      return FMPCashFlowStatementDataSchema.parse(aliased)
    })
  }
}
