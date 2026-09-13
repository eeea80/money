/**
 * Global macro board — cross-country comparison from OECD (keyless).
 *
 * Columns: CPI YoY, short-term interest rate, composite leading indicator.
 * (Real GDP is deliberately absent: the OECD GDP dataset paths 404 since
 * the upstream SDMX reshuffle — tracked in Linear, not silently empty.)
 *
 * Unit normalization happens HERE, not in the UI: OECD returns CPI YoY in
 * percent (3.81) but interest rates as fractions (0.0372) — cells always
 * carry display percent.
 */

import type { EconomyClientLike } from '../client/types.js'
import type { ReferenceMeta } from './types.js'

export interface GlobalMacroCell {
  value: number | null
  date: string | null
  error?: string
}

export interface GlobalMacroRow {
  /** opentypebb country slug, e.g. 'united_states'. */
  country: string
  label: string
  cpiYoy: GlobalMacroCell
  shortRate: GlobalMacroCell
  cli: GlobalMacroCell
  /** Real house price index, 2015 = 100 — cross-country comparable. */
  housePrice: GlobalMacroCell
  /** Share price index, 2015 = 100. */
  sharePrice: GlobalMacroCell
}

export interface GlobalMacroBoard {
  rows: GlobalMacroRow[]
  meta: ReferenceMeta
}

const COUNTRIES: Array<{ slug: string; label: string }> = [
  { slug: 'united_states', label: 'United States' },
  { slug: 'china', label: 'China' },
  { slug: 'japan', label: 'Japan' },
  { slug: 'germany', label: 'Germany' },
  { slug: 'united_kingdom', label: 'United Kingdom' },
  { slug: 'india', label: 'India' },
  { slug: 'brazil', label: 'Brazil' },
]

export async function fetchGlobalMacro(economyClient: EconomyClientLike): Promise<GlobalMacroBoard> {
  const start = new Date()
  start.setMonth(start.getMonth() - 14)
  const startDate = start.toISOString().slice(0, 10)
  // ONE batched SDMX call per indicator ("USA+CHN+…" in REF_AREA) instead of
  // per-country fan-out — 5 requests total vs 35. OECD's anonymous per-IP
  // quota is small enough that the fan-out version could exhaust it on a
  // couple of board loads.
  const allCountries = COUNTRIES.map((c) => c.slug).join(',')

  const settled = await Promise.allSettled([
    economyClient.getCPI({ provider: 'oecd', country: allCountries, transform: 'yoy', frequency: 'monthly', start_date: startDate }),
    economyClient.getInterestRates({ provider: 'oecd', country: allCountries, duration: 'short', start_date: startDate }),
    economyClient.getCompositeLeadingIndicator({ provider: 'oecd', country: allCountries, start_date: startDate }),
    economyClient.getHousePriceIndex({ provider: 'oecd', country: allCountries, start_date: startDate }),
    economyClient.getSharePriceIndex({ provider: 'oecd', country: allCountries, start_date: startDate }),
  ] as const)

  type Row = { date: string; country?: string | null; value?: number | null }

  // indicator → country label → latest cell
  const cellsByIndicator = settled.map((r, idx): { cells: Map<string, GlobalMacroCell>; error?: string } => {
    if (r.status === 'rejected') {
      return { cells: new Map(), error: r.reason instanceof Error ? r.reason.message : String(r.reason) }
    }
    const scale = idx === 1 ? 100 : 1 // rates come back as fractions
    const latestByCountry = new Map<string, Row>()
    for (const row of r.value as Row[]) {
      if (typeof row.value !== 'number' || !row.country) continue
      const prev = latestByCountry.get(row.country)
      if (!prev || row.date > prev.date) latestByCountry.set(row.country, row)
    }
    const cells = new Map<string, GlobalMacroCell>()
    for (const [country, row] of latestByCountry) {
      cells.set(country, { value: (row.value as number) * scale, date: row.date })
    }
    return { cells }
  })

  const cellFor = (indicator: number, label: string): GlobalMacroCell => {
    const { cells, error } = cellsByIndicator[indicator]
    const hit = cells.get(label)
    if (hit) return hit
    return error ? { value: null, date: null, error } : { value: null, date: null }
  }

  const rows: GlobalMacroRow[] = COUNTRIES.map(({ slug, label }) => ({
    country: slug,
    label,
    cpiYoy: cellFor(0, label),
    shortRate: cellFor(1, label),
    cli: cellFor(2, label),
    housePrice: cellFor(3, label),
    sharePrice: cellFor(4, label),
  }))

  // Every indicator down = OECD itself is unreachable — fail loud.
  if (cellsByIndicator.every((c) => c.cells.size === 0)) {
    const firstErr = cellsByIndicator.map((c) => c.error).find(Boolean)
    throw new Error(firstErr ?? 'OECD returned no data for any country.')
  }

  return { rows, meta: { provider: 'oecd', asOf: new Date().toISOString() } }
}
