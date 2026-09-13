/**
 * Balance of Payments Standard Model.
 * Maps to: openbb_core/provider/standard_models/balance_of_payments.py
 *
 * Note: Python defines multiple data classes (BP6BopUsdData, ECBMain, ECBSummary, etc.)
 * for different provider report types. In TypeScript we define a generic base schema
 * and let provider-specific fetchers extend with their own fields via .passthrough().
 */

import { z } from 'zod'

export const BalanceOfPaymentsQueryParamsSchema = z.object({}).passthrough()

export type BalanceOfPaymentsQueryParams = z.infer<typeof BalanceOfPaymentsQueryParamsSchema>

export const BalanceOfPaymentsDataSchema = z.object({
  period: z.string().nullable().default(null).describe('The date representing the beginning of the reporting period.'),
  current_account: z.number().nullable().default(null).describe('Current Account Balance.'),
  goods: z.number().nullable().default(null).describe('Goods Balance.'),
  services: z.number().nullable().default(null).describe('Services Balance.'),
  primary_income: z.number().nullable().default(null).describe('Primary Income Balance.'),
  secondary_income: z.number().nullable().default(null).describe('Secondary Income Balance.'),
  capital_account: z.number().nullable().default(null).describe('Capital Account Balance.'),
  financial_account: z.number().nullable().default(null).describe('Financial Account Balance.'),
}).passthrough()

export type BalanceOfPaymentsData = z.infer<typeof BalanceOfPaymentsDataSchema>
