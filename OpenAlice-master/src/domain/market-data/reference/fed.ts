/**
 * Fed board — the central-bank-policy read in one screen:
 *   - H.4.1 balance sheet (FRED): total assets / Treasuries / MBS → QT/QE
 *   - Primary dealer net positions (NY Fed, keyless) → intermediation
 *   - FOMC documents (federalreserve.gov, keyless) → statements & minutes
 *
 * Three independent sources — per-section failures annotate, total failure
 * throws (two-grain loud-failure, same as the other boards).
 */

import type { EconomyClientLike } from '../client/types.js'
import type { MacroPoint, MacroSeriesCard, ReferenceMeta } from './types.js'

export interface FedDocument {
  date: string
  title: string
  type: string
  url: string
}

export interface FedBoard {
  /** Balance-sheet + dealer-positioning sparkline cards (USD, absolute). */
  cards: MacroSeriesCard[]
  /** Latest FOMC statements / minutes / projections, newest first. */
  documents: FedDocument[]
  errors?: Partial<Record<'balanceSheet' | 'dealers' | 'documents', string>>
  meta: ReferenceMeta
}

const MAX_POINTS = 90
const MAX_DOCS = 12

function card(
  id: string,
  label: string,
  points: MacroPoint[],
): MacroSeriesCard {
  const recent = points.slice(-MAX_POINTS)
  const latest = recent[recent.length - 1] ?? null
  const prev = recent[recent.length - 2] ?? null
  return {
    id,
    label,
    unit: 'count', // absolute USD — fmtCompact renders 6.6T / 132.8B
    points: recent,
    latest: latest?.value ?? null,
    latestDate: latest?.date ?? null,
    change: latest && prev ? latest.value - prev.value : null,
  }
}

export async function fetchFedBoard(economyClient: EconomyClientLike): Promise<FedBoard> {
  const dealerStart = new Date()
  dealerStart.setFullYear(dealerStart.getFullYear() - 2)

  const [holdings, dealers, documents] = await Promise.allSettled([
    economyClient.getCentralBankHoldings({ provider: 'federal_reserve' }),
    economyClient.getPrimaryDealerPositioning({
      provider: 'federal_reserve',
      start_date: dealerStart.toISOString().slice(0, 10),
    }),
    economyClient.getFomcDocuments({ provider: 'federal_reserve' }),
  ])

  if (holdings.status === 'rejected' && dealers.status === 'rejected' && documents.status === 'rejected') {
    const first = holdings.reason
    throw first instanceof Error ? first : new Error(String(first))
  }

  const errors: NonNullable<FedBoard['errors']> = {}
  const cards: MacroSeriesCard[] = []

  if (holdings.status === 'fulfilled') {
    // H.4.1 values come in USD millions — scale to absolute dollars.
    const points = (field: string): MacroPoint[] =>
      holdings.value
        .map((r) => ({ date: String(r.date), value: (r as Record<string, unknown>)[field] }))
        .filter((p): p is MacroPoint => typeof p.value === 'number')
        .map((p) => ({ date: p.date, value: p.value * 1e6 }))
    cards.push(
      card('WALCL', 'Total Assets', points('total_assets')),
      card('TREAST', 'Treasuries Held', points('treasury_holding_value')),
      card('WSHOMCB', 'MBS Held', points('mbs_holding_value')),
    )
  } else {
    errors.balanceSheet = holdings.reason instanceof Error ? holdings.reason.message : String(holdings.reason)
  }

  if (dealers.status === 'fulfilled') {
    const points = (field: string): MacroPoint[] =>
      dealers.value
        .map((r) => ({ date: String(r.date), value: (r as Record<string, unknown>)[field] }))
        .filter((p): p is MacroPoint => typeof p.value === 'number')
        .map((p) => ({ date: p.date, value: p.value * 1e6 })) // millions → absolute
    cards.push(
      card('PD_NET', 'Dealer Net Positions (Total)', points('total_net_position')),
      card('PD_UST', 'Dealer Net Treasuries', points('treasury_total')),
    )
  } else {
    errors.dealers = dealers.reason instanceof Error ? dealers.reason.message : String(dealers.reason)
  }

  let docs: FedDocument[] = []
  if (documents.status === 'fulfilled') {
    docs = documents.value.slice(0, MAX_DOCS).map((d) => ({
      date: String(d.date),
      title: String(d.title ?? ''),
      type: String(d.type ?? ''),
      url: String(d.url ?? ''),
    }))
  } else {
    errors.documents = documents.reason instanceof Error ? documents.reason.message : String(documents.reason)
  }

  return {
    cards,
    documents: docs,
    ...(Object.keys(errors).length ? { errors } : {}),
    meta: { provider: 'fred+nyfed+federalreserve.gov', asOf: new Date().toISOString() },
  }
}
