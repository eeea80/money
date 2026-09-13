/**
 * FMP Government Trades Model.
 * Maps to: openbb_fmp/models/government_trades.py
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { GovernmentTradesQueryParamsSchema, GovernmentTradesDataSchema } from '../../../standard-models/government-trades.js'
import { applyAliases } from '../../../core/provider/utils/helpers.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { amakeRequest } from '../../../core/provider/utils/helpers.js'

const ALIAS_DICT: Record<string, string> = {
  symbol: 'ticker',
  transaction_date: 'transactionDate',
  representative: 'office',
  url: 'link',
  transaction_type: 'type',
  date: 'disclosureDate',
}

const KEYS_TO_REMOVE = new Set([
  'district',
  'capitalGainsOver200USD',
  'disclosureYear',
  'firstName',
  'lastName',
])

const KEYS_TO_RENAME: Record<string, string> = {
  dateRecieved: 'date',
  disclosureDate: 'date',
}

export const FMPGovernmentTradesQueryParamsSchema = GovernmentTradesQueryParamsSchema
export type FMPGovernmentTradesQueryParams = z.infer<typeof FMPGovernmentTradesQueryParamsSchema>

export const FMPGovernmentTradesDataSchema = GovernmentTradesDataSchema.extend({
  chamber: z.enum(['House', 'Senate']).describe('Government Chamber - House or Senate.'),
  owner: z.string().nullable().default(null).describe('Ownership status (e.g., Spouse, Joint).'),
  asset_type: z.string().nullable().default(null).describe('Type of asset involved in the transaction.'),
  asset_description: z.string().nullable().default(null).describe('Description of the asset.'),
  transaction_type: z.string().nullable().default(null).describe('Type of transaction (e.g., Sale, Purchase).'),
  amount: z.string().nullable().default(null).describe('Transaction amount range.'),
  comment: z.string().nullable().default(null).describe('Additional comments on the transaction.'),
  url: z.string().nullable().default(null).describe('Link to the transaction document.'),
}).strip()
export type FMPGovernmentTradesData = z.infer<typeof FMPGovernmentTradesDataSchema>

/** Determine asset_type from description if missing */
function inferAssetType(d: Record<string, unknown>): string | null {
  const desc = String(d.assetDescription ?? d.asset_description ?? '').toLowerCase()
  const hasTicker = !!(d.ticker || d.symbol)

  if (hasTicker) {
    return desc.includes('etf') ? 'ETF' : 'Stock'
  }
  if (desc.includes('treasury') || desc.includes('bill')) return 'Treasury'
  if (desc.includes('%') || desc.includes('due') || desc.includes('pct')) return 'Bond'
  if (desc.includes('fund')) return 'Fund'
  if (desc.includes('etf')) return 'ETF'
  return null
}

export class FMPGovernmentTradesFetcher extends Fetcher {
  static override transformQuery(params: Record<string, unknown>): FMPGovernmentTradesQueryParams {
    return FMPGovernmentTradesQueryParamsSchema.parse(params)
  }

  static override async extractData(
    query: FMPGovernmentTradesQueryParams,
    credentials: Record<string, string> | null,
  ): Promise<Record<string, unknown>[]> {
    const apiKey = credentials?.fmp_api_key ?? ''
    const baseUrl = 'https://financialmodelingprep.com/stable/'
    const chamberUrls: Record<string, string[]> = {
      house: ['house-trades'],
      senate: ['senate-trades'],
      all: ['house-trades', 'senate-trades'],
    }
    const endpoints = chamberUrls[query.chamber] ?? chamberUrls.all
    const results: Record<string, unknown>[] = []

    if (query.symbol) {
      // Symbol-based: fetch for each symbol × each chamber
      const symbols = query.symbol.split(',').map(s => s.trim()).filter(Boolean)
      const urls: { url: string; chamber: string }[] = []
      for (const symbol of symbols) {
        for (const ep of endpoints) {
          urls.push({
            url: `${baseUrl}${ep}?symbol=${symbol}&apikey=${apiKey}`,
            chamber: ep.includes('senate') ? 'Senate' : 'House',
          })
        }
      }

      const settled = await Promise.allSettled(
        urls.map(async ({ url, chamber }) => {
          const data = await amakeRequest(url) as any[]
          return (data ?? []).map((d: any) => ({ ...d, chamber }))
        }),
      )

      for (const r of settled) {
        if (r.status === 'fulfilled' && r.value?.length) {
          results.push(...r.value)
        }
      }
    } else {
      // No symbol: fetch latest trades (up to limit)
      const limit = query.limit ?? 1000
      for (const ep of endpoints) {
        const chamber = ep.includes('senate') ? 'Senate' : 'House'
        try {
          const latestEp = ep.replace('trades', 'latest')
          const data = await amakeRequest(
            `${baseUrl}${latestEp}?page=0&limit=${Math.min(limit, 250)}&apikey=${apiKey}`,
          ) as any[]
          if (data?.length) {
            results.push(...data.map((d: any) => ({ ...d, chamber })))
          }
        } catch {
          // Ignore errors for individual chambers
        }
      }
    }

    if (!results.length) {
      throw new EmptyDataError('No government trades data returned.')
    }

    // Process: rename keys, remove unwanted keys, add chamber
    return results.map(entry => {
      const processed: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(entry)) {
        if (KEYS_TO_REMOVE.has(k)) continue
        const newKey = KEYS_TO_RENAME[k] ?? k
        processed[newKey] = v
      }
      return processed
    })
  }

  static override transformData(
    query: FMPGovernmentTradesQueryParams,
    data: Record<string, unknown>[],
  ): FMPGovernmentTradesData[] {
    const results = data
      .filter(d => {
        // Skip entries where all values are "--" or empty
        const vals = Object.values(d)
        return vals.some(v => v && v !== '--')
      })
      .map(d => {
        // Fill missing owner
        if (!d.owner) d.owner = 'Self'
        // Fill missing asset_type
        if (!d.assetType && !d.asset_type) {
          d.asset_type = inferAssetType(d)
        }
        // Clean "--" values to null
        for (const [k, v] of Object.entries(d)) {
          if (v === '--') d[k] = null
        }
        const aliased = applyAliases(d, ALIAS_DICT)
        return FMPGovernmentTradesDataSchema.parse(aliased)
      })

    // Sort by date descending
    results.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0))

    // Apply limit
    const limit = query.limit ?? results.length
    return results.slice(0, limit)
  }
}
