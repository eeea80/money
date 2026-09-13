/**
 * FMP Cash Flow Statement Growth Model.
 * Maps to: openbb_fmp/models/cash_flow_growth.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { CashFlowStatementGrowthQueryParamsSchema, CashFlowStatementGrowthDataSchema } from '../../../standard-models/cash-flow-growth.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { getDataMany } from '../utils/helpers.js'

// --- Query Params ---

export const FMPCashFlowStatementGrowthQueryParamsSchema = CashFlowStatementGrowthQueryParamsSchema.extend({
  period: z.enum(['annual', 'quarter']).default('annual').describe('Time period of the data to return.'),
})

export type FMPCashFlowStatementGrowthQueryParams = z.infer<typeof FMPCashFlowStatementGrowthQueryParamsSchema>

// --- Data ---

const ALIAS_DICT: Record<string, string> = {
  period_ending: 'date',
  fiscal_year: 'calendarYear',
  fiscal_period: 'period',
  reported_currency: 'reportedCurrency',
  growth_acquisitions: 'growthAcquisitionsNet',
  growth_sale_and_maturity_of_investments: 'growthSalesMaturitiesOfInvestments',
  growth_net_cash_from_operating_activities: 'growthNetCashProvidedByOperatingActivites',
  growth_other_investing_activities: 'growthOtherInvestingActivites',
  growth_net_cash_from_investing_activities: 'growthNetCashUsedForInvestingActivites',
  growth_other_financing_activities: 'growthOtherFinancingActivites',
  growth_purchase_of_investment_securities: 'growthPurchasesOfInvestments',
  growth_account_receivables: 'growthAccountsReceivables',
  growth_account_payable: 'growthAccountsPayables',
  growth_purchase_of_property_plant_and_equipment: 'growthInvestmentsInPropertyPlantAndEquipment',
  growth_repayment_of_debt: 'growthDebtRepayment',
  growth_net_change_in_cash_and_equivalents: 'growthNetChangeInCash',
  growth_effect_of_exchange_rate_changes_on_cash: 'growthEffectOfForexChangesOnCash',
  growth_net_cash_from_financing_activities: 'growthNetCashUsedProvidedByFinancingActivities',
  growth_net_equity_issuance: 'growthNetStockIssuance',
  growth_common_equity_issuance: 'growthCommonStockIssued',
  growth_common_equity_repurchased: 'growthCommonStockRepurchased',
}

const pctOrNull = z.number().nullable().default(null)

export const FMPCashFlowStatementGrowthDataSchema = CashFlowStatementGrowthDataSchema.extend({
  symbol: z.string().nullable().default(null).describe('The stock ticker symbol.'),
  reported_currency: z.string().nullable().default(null).describe('The currency in which the financial data is reported.'),
  growth_net_income: pctOrNull.describe('Growth rate of net income.'),
  growth_depreciation_and_amortization: pctOrNull.describe('Growth rate of depreciation and amortization.'),
  growth_deferred_income_tax: pctOrNull.describe('Growth rate of deferred income tax.'),
  growth_stock_based_compensation: pctOrNull.describe('Growth rate of stock-based compensation.'),
  growth_change_in_working_capital: pctOrNull.describe('Growth rate of change in working capital.'),
  growth_account_receivables: pctOrNull.describe('Growth rate of accounts receivables.'),
  growth_inventory: pctOrNull.describe('Growth rate of inventory.'),
  growth_account_payable: pctOrNull.describe('Growth rate of account payable.'),
  growth_other_working_capital: pctOrNull.describe('Growth rate of other working capital.'),
  growth_other_non_cash_items: pctOrNull.describe('Growth rate of other non-cash items.'),
  growth_net_cash_from_operating_activities: pctOrNull.describe('Growth rate of net cash provided by operating activities.'),
  growth_purchase_of_property_plant_and_equipment: pctOrNull.describe('Growth rate of investments in property, plant, and equipment.'),
  growth_acquisitions: pctOrNull.describe('Growth rate of net acquisitions.'),
  growth_purchase_of_investment_securities: pctOrNull.describe('Growth rate of purchases of investments.'),
  growth_sale_and_maturity_of_investments: pctOrNull.describe('Growth rate of sales maturities of investments.'),
  growth_other_investing_activities: pctOrNull.describe('Growth rate of other investing activities.'),
  growth_net_cash_from_investing_activities: pctOrNull.describe('Growth rate of net cash used for investing activities.'),
  growth_short_term_net_debt_issuance: pctOrNull.describe('Growth rate of short term net debt issuance.'),
  growth_long_term_net_debt_issuance: pctOrNull.describe('Growth rate of long term net debt issuance.'),
  growth_net_debt_issuance: pctOrNull.describe('Growth rate of net debt issuance.'),
  growth_repayment_of_debt: pctOrNull.describe('Growth rate of debt repayment.'),
  growth_common_equity_issuance: pctOrNull.describe('Growth rate of common equity issued.'),
  growth_common_equity_repurchased: pctOrNull.describe('Growth rate of common equity repurchased.'),
  growth_net_equity_issuance: pctOrNull.describe('Growth rate of net equity issuance.'),
  growth_dividends_paid: pctOrNull.describe('Growth rate of dividends paid.'),
  growth_preferred_dividends_paid: pctOrNull.describe('Growth rate of preferred dividends paid.'),
  growth_other_financing_activities: pctOrNull.describe('Growth rate of other financing activities.'),
  growth_net_cash_from_financing_activities: pctOrNull.describe('Growth rate of net cash used/provided by financing activities.'),
  growth_effect_of_exchange_rate_changes_on_cash: pctOrNull.describe('Growth rate of the effect of foreign exchange changes on cash.'),
  growth_net_change_in_cash_and_equivalents: pctOrNull.describe('Growth rate of net change in cash.'),
  growth_cash_at_beginning_of_period: pctOrNull.describe('Growth rate of cash at the beginning of the period.'),
  growth_cash_at_end_of_period: pctOrNull.describe('Growth rate of cash at the end of the period.'),
  growth_operating_cash_flow: pctOrNull.describe('Growth rate of operating cash flow.'),
  growth_capital_expenditure: pctOrNull.describe('Growth rate of capital expenditure.'),
  growth_income_taxes_paid: pctOrNull.describe('Growth rate of income taxes paid.'),
  growth_interest_paid: pctOrNull.describe('Growth rate of interest paid.'),
  growth_free_cash_flow: pctOrNull.describe('Growth rate of free cash flow.'),
}).passthrough()

export type FMPCashFlowStatementGrowthData = z.infer<typeof FMPCashFlowStatementGrowthDataSchema>

// --- Fetcher ---

export class FMPCashFlowStatementGrowthFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPCashFlowStatementGrowthQueryParams {
    return FMPCashFlowStatementGrowthQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPCashFlowStatementGrowthQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    const url = 'https://financialmodelingprep.com/stable/cash-flow-statement-growth'
      + `?symbol=${query.symbol}`
      + `&period=${query.period}`
      + `&limit=${query.limit ?? 5}`
      + `&apikey=${apiKey}`
    return getDataMany(url)
  }

  static override transformData(
    query: FMPCashFlowStatementGrowthQueryParams,
    data: Record<string, unknown>[],
  ): FMPCashFlowStatementGrowthData[] {
    return data.map(d => {
      const aliased = applyAliases(d, ALIAS_DICT)
      return FMPCashFlowStatementGrowthDataSchema.parse(aliased)
    })
  }
}
