/**
 * FMP Literal Definitions.
 * Maps to: openbb_fmp/utils/definitions.py
 */

export type FinancialPeriods = 'q1' | 'q2' | 'q3' | 'q4' | 'fy' | 'annual' | 'quarter'

export type FinancialStatementPeriods = 'q1' | 'q2' | 'q3' | 'q4' | 'fy' | 'ttm' | 'annual' | 'quarter'

export type TransactionType =
  | 'award' | 'conversion' | 'return' | 'expire_short' | 'in_kind'
  | 'gift' | 'expire_long' | 'discretionary' | 'other' | 'small'
  | 'exempt' | 'otm' | 'purchase' | 'sale' | 'tender' | 'will'
  | 'itm' | 'trust'

export const TRANSACTION_TYPES_DICT: Record<string, string> = {
  award: 'A-Award',
  conversion: 'C-Conversion',
  return: 'D-Return',
  expire_short: 'E-ExpireShort',
  in_kind: 'F-InKind',
  gift: 'G-Gift',
  expire_long: 'H-ExpireLong',
  discretionary: 'I-Discretionary',
  other: 'J-Other',
  small: 'L-Small',
  exempt: 'M-Exempt',
  otm: 'O-OutOfTheMoney',
  purchase: 'P-Purchase',
  sale: 'S-Sale',
  tender: 'U-Tender',
  will: 'W-Will',
  itm: 'X-InTheMoney',
  trust: 'Z-Trust',
}
