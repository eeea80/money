/**
 * Economy AI Tools
 *
 * Macro / economic data surface exposed to the AI agent. Backed by
 * multiple providers under the hood — semantics drives the namespace
 * (the AI sees one cohesive "look up macro indicators" toolset), even
 * though the underlying SDK clients route them differently:
 *
 *   FRED (federal_reserve) — economyFredSearch / FredSeries / FredRegional
 *     (routed via /economy/* on the HTTP layer; uses EconomyClientLike)
 *   EIA — economyEnergyOutlook / economyPetroleumStatus
 *     (routed via /commodity/* upstream — OpenBB classifies oil/gas as
 *     commodity data; uses CommodityClientLike. Conceptually macro for
 *     the AI, structurally commodity for the wire.)
 *
 * Provider names are pinned at the tool boundary so the LLM never has
 * to know about the federal_reserve / eia provider strings.
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { EconomyClientLike, CommodityClientLike } from '@/domain/market-data/client/types'

const FRED_PROVIDER = 'federal_reserve'
const EIA_PROVIDER = 'eia'
const BLS_PROVIDER = 'bls'
const OECD_PROVIDER = 'oecd'
const IMF_PROVIDER = 'imf'

export function createEconomyTools(
  economyClient: EconomyClientLike,
  commodityClient: CommodityClientLike,
) {
  return {
    economyFredSearch: tool({
      description: `Search the FRED database for economic time series by keyword.

Returns a list of matching series with id, title, frequency, units, and seasonal adjustment.
Use this to discover the FRED series_id for a metric (e.g. "unemployment" → UNRATE,
"GDP" → GDP, "CPI" → CPIAUCSL), then pass the id to economyFredSeries to get observations.

The query is keyword-based and matches series titles + tags; expect dozens of hits per
common term. Increase limit only if you need to scan beyond the most popular results.`,
      inputSchema: z.object({
        query: z.string().describe('Keyword(s) to search FRED, e.g. "unemployment", "GDP", "CPI"'),
        limit: z.number().int().positive().optional().describe('Max results to return (default: 100)'),
      }).meta({ examples: [{ query: 'unemployment' }] }),
      execute: async ({ query, limit }) => {
        const params: Record<string, unknown> = { query, provider: FRED_PROVIDER }
        if (limit !== undefined) params.limit = limit
        return await economyClient.fredSearch(params)
      },
    }),

    economyFredSeries: tool({
      description: `Fetch observation values for one or more FRED series.

Pass a single series_id (e.g. "GDP") or comma-separated ids (e.g. "GDP,UNRATE,CPIAUCSL")
to retrieve and merge multiple series into one date-indexed result.

When limit is set without a date range, returns the LATEST N observations (e.g. limit=12
on a monthly series gives the most recent year). To pull a specific window, pass
start_date and/or end_date in YYYY-MM-DD form.

If you don't know the series_id, call economyFredSearch first.`,
      inputSchema: z.object({
        symbol: z.string().describe('FRED series id, or comma-separated ids for multi-series merge'),
        start_date: z.string().optional().describe('Start date YYYY-MM-DD (optional)'),
        end_date: z.string().optional().describe('End date YYYY-MM-DD (optional)'),
        limit: z.number().int().positive().optional().describe('Max observations per series (returns latest N when no date range given)'),
        frequency: z.string().optional().describe('Aggregation frequency override (e.g. "m", "q", "a")'),
      }).meta({ examples: [{ symbol: 'UNRATE', limit: 12 }] }),
      execute: async ({ symbol, start_date, end_date, limit, frequency }) => {
        const params: Record<string, unknown> = { symbol, provider: FRED_PROVIDER }
        if (start_date !== undefined) params.start_date = start_date
        if (end_date !== undefined) params.end_date = end_date
        if (limit !== undefined) params.limit = limit
        if (frequency !== undefined) params.frequency = frequency
        return await economyClient.fredSeries(params)
      },
    }),

    economyFredRegional: tool({
      description: `Fetch a US state-level cross-section for a FRED regional series.

The symbol is the regional series id (e.g. "WIPCPI" for per-capita personal income,
"UNRATE" for unemployment rate). Returns one row per region (~50 states + DC + territories)
with region name, code, and value for the given date.

Use this for state-by-state comparisons; for time-series of a single region,
use economyFredSeries with the region-specific id (e.g. "CAPCPI" for California
per-capita income).`,
      inputSchema: z.object({
        symbol: z.string().describe('FRED regional series id (e.g. "WIPCPI" for per-capita income)'),
        date: z.string().optional().describe('Observation date YYYY-MM-DD (defaults to latest available)'),
        region_type: z.string().optional().describe('Region granularity: "state" (default), "msa", "county"'),
        start_date: z.string().optional().describe('Start date for ranged queries (optional)'),
      }).meta({ examples: [{ symbol: 'WIPCPI' }] }),
      execute: async ({ symbol, date, region_type, start_date }) => {
        const params: Record<string, unknown> = { symbol, provider: FRED_PROVIDER }
        if (date !== undefined) params.date = date
        if (region_type !== undefined) params.region_type = region_type
        if (start_date !== undefined) params.start_date = start_date
        return await economyClient.fredRegional(params)
      },
    }),

    economyBlsSearch: tool({
      description: `Search the Bureau of Labor Statistics catalog for a series_id by keyword.

Returns a small curated list of common BLS series matching the query (CPI,
unemployment rate, nonfarm payrolls, JOLTS, PPI, productivity, etc.). BLS
itself does not expose a search API — this is a hand-maintained catalog
on the provider side, so coverage is intentionally narrow rather than
exhaustive.

Once you have the series_id, pass it to economyBlsSeries to get observations.`,
      inputSchema: z.object({
        query: z.string().describe('Keyword to filter the BLS catalog, e.g. "unemployment", "CPI", "JOLTS"'),
        limit: z.number().int().positive().optional().describe('Max results to return (default: 100)'),
      }).meta({ examples: [{ query: 'CPI' }] }),
      execute: async ({ query, limit }) => {
        const params: Record<string, unknown> = { query, provider: BLS_PROVIDER }
        if (limit !== undefined) params.limit = limit
        return await economyClient.getBlsSearch(params)
      },
    }),

    economyBlsSeries: tool({
      description: `Fetch observations for one or more BLS series.

Pass a single series_id (e.g. "LNS14000000" for unemployment rate) or
comma-separated ids (e.g. "LNS14000000,CUUR0000SA0") to retrieve multiple
series at once.

NOTE: Unlike economyFredSeries which pivots multi-series into one row per
date with a column per series, BLS results are returned in long form:
one row per (date, series_id) with a single \`value\` column. Filter or
group client-side if you need a pivot.

Default time window is the last 10 years if no date range is given. BLS
returns null/missing for unavailable observations (e.g. months affected
by funding lapses) — those rows are dropped before returning.

If you don't know the series_id, call economyBlsSearch first.`,
      inputSchema: z.object({
        symbol: z.string().describe('BLS series id, or comma-separated ids for multi-series'),
        start_date: z.string().optional().describe('Start date YYYY-MM-DD (only year is used; default: 10 years ago)'),
        end_date: z.string().optional().describe('End date YYYY-MM-DD (only year is used; default: current year)'),
      }).meta({ examples: [{ symbol: 'LNS14000000' }] }),
      execute: async ({ symbol, start_date, end_date }) => {
        const params: Record<string, unknown> = { symbol, provider: BLS_PROVIDER }
        if (start_date !== undefined) params.start_date = start_date
        if (end_date !== undefined) params.end_date = end_date
        return await economyClient.getBlsSeries(params)
      },
    }),

    economyEnergyOutlook: tool({
      description: `Fetch the EIA Short-Term Energy Outlook (STEO) for a given category.

Returns ~10 years of monthly observations (mix of historical + forecast). The
\`forecast\` field on each row is true when the observation is a projection,
false when it is a realised value — useful for distinguishing "what happened"
from "what EIA expects".

Use for energy-market context (oil price trajectory, refinery throughput,
gasoline price, gas/petroleum production trends). For macro indicators like
GDP / unemployment / CPI, use economyFredSeries instead.`,
      inputSchema: z.object({
        category: z.enum([
          'crude_oil_price',
          'gasoline_price',
          'natural_gas_price',
          'crude_oil_production',
          'petroleum_consumption',
        ]).describe('STEO category'),
        start_date: z.string().optional().describe('Start date YYYY-MM-DD (optional)'),
        end_date: z.string().optional().describe('End date YYYY-MM-DD (optional)'),
      }).meta({ examples: [{ category: 'crude_oil_price' }] }),
      execute: async ({ category, start_date, end_date }) => {
        const params: Record<string, unknown> = { category, provider: EIA_PROVIDER }
        if (start_date !== undefined) params.start_date = start_date
        if (end_date !== undefined) params.end_date = end_date
        return await commodityClient.getEnergyOutlook(params)
      },
    }),

    economyPetroleumStatus: tool({
      description: `Fetch the EIA Weekly Petroleum Status Report for a given category.

Returns ~5 years of weekly observations (no forecast — this is the EIA's
realised inventory + production data, released every Wednesday). Use for
short-horizon energy-market signals: crude/gasoline/distillate stock draws,
refinery utilisation, US crude production.

Categories cover commercial inventories ("..._stocks"), production, and
refinery utilisation. For longer-horizon outlook + forecasts use
economyEnergyOutlook.`,
      inputSchema: z.object({
        category: z.enum([
          'crude_oil_production',
          'crude_oil_stocks',
          'gasoline_stocks',
          'distillate_stocks',
          'refinery_utilization',
        ]).describe('Petroleum data category'),
        start_date: z.string().optional().describe('Start date YYYY-MM-DD (optional)'),
        end_date: z.string().optional().describe('End date YYYY-MM-DD (optional)'),
      }).meta({ examples: [{ category: 'crude_oil_stocks' }] }),
      execute: async ({ category, start_date, end_date }) => {
        const params: Record<string, unknown> = { category, provider: EIA_PROVIDER }
        if (start_date !== undefined) params.start_date = start_date
        if (end_date !== undefined) params.end_date = end_date
        return await commodityClient.getPetroleumStatus(params)
      },
    }),

    economyCountryCpi: tool({
      description: `Get CPI inflation for a specific country (OECD data, keyless).

Returns monthly observations; with the default transform "yoy" the value is the
year-over-year inflation rate IN PERCENT (3.81 = +3.81%). transform "period" gives
month-over-month, "index" the raw index level.

Covers ~36 countries: united_states, china, japan, germany, united_kingdom, france,
india, brazil, south_korea, canada, australia, mexico, turkey, indonesia, and other
OECD members (snake_case names).`,
      inputSchema: z.object({
        country: z.string().describe('Country slug, e.g. "united_states", "china", "japan"'),
        transform: z.enum(['yoy', 'period', 'index']).optional().describe('Default "yoy" — year-over-year percent'),
        start_date: z.string().optional().describe('Start date YYYY-MM-DD (optional)'),
      }).meta({ examples: [{ country: 'china' }] }),
      execute: async ({ country, transform, start_date }) => {
        const params: Record<string, unknown> = { country, provider: OECD_PROVIDER, transform: transform ?? 'yoy', frequency: 'monthly' }
        if (start_date !== undefined) params.start_date = start_date
        return await economyClient.getCPI(params)
      },
    }),

    economyCountryRates: tool({
      description: `Get a country's interest rates (OECD data, keyless).

duration "short" = 3-month interbank rate (the policy-rate proxy), "long" = 10-year
government bond yield. IMPORTANT: values are DECIMAL FRACTIONS — 0.0372 means 3.72%.

Same country coverage as economyCountryCpi (snake_case names).`,
      inputSchema: z.object({
        country: z.string().describe('Country slug, e.g. "united_states", "japan"'),
        duration: z.enum(['short', 'long']).optional().describe('Default "short" (3M interbank); "long" = 10Y govt yield'),
        start_date: z.string().optional().describe('Start date YYYY-MM-DD (optional)'),
      }).meta({ examples: [{ country: 'japan', duration: 'long' }] }),
      execute: async ({ country, duration, start_date }) => {
        const params: Record<string, unknown> = { country, provider: OECD_PROVIDER, duration: duration ?? 'short' }
        if (start_date !== undefined) params.start_date = start_date
        return await economyClient.getInterestRates(params)
      },
    }),

    economyLeadingIndicator: tool({
      description: `Get the OECD Composite Leading Indicator (CLI) for a country or group.

The CLI anticipates turning points in economic activity ~6-9 months ahead.
100 = long-term trend; above and rising = expansion, below and falling = downturn.
Monthly observations.

country accepts a country slug ("united_states", "china") or a group ("g20", "g7").`,
      inputSchema: z.object({
        country: z.string().optional().describe('Country slug or group (default "g20")'),
        start_date: z.string().optional().describe('Start date YYYY-MM-DD (optional)'),
      }).meta({ examples: [{ country: 'united_states' }] }),
      execute: async ({ country, start_date }) => {
        const params: Record<string, unknown> = { provider: OECD_PROVIDER }
        if (country !== undefined) params.country = country
        if (start_date !== undefined) params.start_date = start_date
        return await economyClient.getCompositeLeadingIndicator(params)
      },
    }),

    economyPortSearch: tool({
      description: `Search the IMF PortWatch database of 1,802 maritime ports (satellite AIS data, keyless).

Returns port id, name, country, continent, coordinates and total vessel count.
Use this to find the port id/name, then pass it to economyPortVolume for daily
trade activity. Omit the query to list the busiest ports globally.`,
      inputSchema: z.object({
        port: z.string().optional().describe('Port name fragment or id, e.g. "shanghai", "rotterdam" (omit = busiest ports)'),
      }).meta({ examples: [{ port: 'shanghai' }] }),
      execute: async ({ port }) => {
        const params: Record<string, unknown> = { provider: IMF_PROVIDER }
        if (port !== undefined) params.port = port
        return await economyClient.getPortInfo(params)
      },
    }),

    economyPortVolume: tool({
      description: `Daily trade activity for a maritime port (IMF PortWatch satellite AIS, keyless).

Returns daily portcalls (by vessel type) and import/export trade estimates in
METRIC TONS. Data updates weekly (Tuesdays) with a few days of lag. Use
economyPortSearch first if unsure of the port name. Note: large harbours are
split into sub-ports (e.g. "Shanghai (Pudong)" / "Shanghai (Yangshan)") — a
name query matches all of them.`,
      inputSchema: z.object({
        port: z.string().describe('Port name fragment or id, e.g. "shanghai"'),
        start_date: z.string().optional().describe('Start date YYYY-MM-DD'),
        end_date: z.string().optional().describe('End date YYYY-MM-DD'),
      }).meta({ examples: [{ port: 'rotterdam', start_date: '2026-05-01' }] }),
      execute: async ({ port, start_date, end_date }) => {
        const params: Record<string, unknown> = { port, provider: IMF_PROVIDER }
        if (start_date !== undefined) params.start_date = start_date
        if (end_date !== undefined) params.end_date = end_date
        return await economyClient.getPortVolume(params)
      },
    }),

    economyChokepointVolume: tool({
      description: `Daily transit volume through maritime chokepoints (IMF PortWatch, keyless).

Returns daily vessel counts (by type) and total trade volume in METRIC TONS for
the world's 24+ chokepoints. The supply-chain narrative read: Red Sea reroutes
show up as Suez ↓ / Cape of Good Hope ↑; drought shows as Panama ↓.

Common names that match: "suez", "panama", "hormuz", "malacca", "bab el-mandeb",
"bosporus", "gibraltar", "dover", "cape of good hope". Omit the chokepoint to
get ALL of them (use a short date range in that case).`,
      inputSchema: z.object({
        chokepoint: z.string().optional().describe('Chokepoint name fragment or id, e.g. "suez" (omit = all)'),
        start_date: z.string().optional().describe('Start date YYYY-MM-DD'),
        end_date: z.string().optional().describe('End date YYYY-MM-DD'),
      }).meta({ examples: [{ chokepoint: 'suez', start_date: '2026-05-01' }] }),
      execute: async ({ chokepoint, start_date, end_date }) => {
        const params: Record<string, unknown> = { provider: IMF_PROVIDER }
        if (chokepoint !== undefined) params.chokepoint = chokepoint
        if (start_date !== undefined) params.start_date = start_date
        if (end_date !== undefined) params.end_date = end_date
        return await economyClient.getChokepointVolume(params)
      },
    }),

    economyCountryRetail: tool({
      description: `Get a country's retail price index (OECD, keyless).

Monthly observations of the retail price level — a demand-side read that
complements CPI. Same country coverage as economyCountryCpi (snake_case
names like "united_states", "japan").`,
      inputSchema: z.object({
        country: z.string().describe('Country slug, e.g. "united_states"'),
        start_date: z.string().optional().describe('Start date YYYY-MM-DD (optional)'),
      }).meta({ examples: [{ country: 'united_states' }] }),
      execute: async ({ country, start_date }) => {
        const params: Record<string, unknown> = { country, provider: OECD_PROVIDER }
        if (start_date !== undefined) params.start_date = start_date
        return await economyClient.getRetailPrices(params)
      },
    }),

    economyCountryHousePrices: tool({
      description: `Get a country's real house price index (OECD, keyless).

Quarterly index (2015 = 100) of inflation-adjusted residential property
prices. The property-cycle read for cross-country comparison. Same country
coverage as economyCountryCpi (snake_case names).`,
      inputSchema: z.object({
        country: z.string().describe('Country slug, e.g. "united_states", "japan"'),
        start_date: z.string().optional().describe('Start date YYYY-MM-DD (optional)'),
      }).meta({ examples: [{ country: 'united_states' }] }),
      execute: async ({ country, start_date }) => {
        const params: Record<string, unknown> = { country, provider: OECD_PROVIDER }
        if (start_date !== undefined) params.start_date = start_date
        return await economyClient.getHousePriceIndex(params)
      },
    }),

    economyCountrySharePrices: tool({
      description: `Get a country's share price index (OECD, keyless).

Monthly equity-market index (2015 = 100), normalized across countries —
use for cross-country equity performance comparison rather than levels.`,
      inputSchema: z.object({
        country: z.string().describe('Country slug, e.g. "japan", "germany"'),
        start_date: z.string().optional().describe('Start date YYYY-MM-DD (optional)'),
      }).meta({ examples: [{ country: 'japan' }] }),
      execute: async ({ country, start_date }) => {
        const params: Record<string, unknown> = { country, provider: OECD_PROVIDER }
        if (start_date !== undefined) params.start_date = start_date
        return await economyClient.getSharePriceIndex(params)
      },
    }),

    economyEuroAreaBop: tool({
      description: `Get the euro-area balance of payments from the ECB (keyless).

Quarterly current account, goods, services, primary/secondary income —
the external-position read on the euro area. Values in EUR millions.`,
      inputSchema: z.object({
        start_date: z.string().optional().describe('Start date YYYY-MM-DD (optional)'),
      }).meta({ examples: [{}] }),
      execute: async ({ start_date }) => {
        const params: Record<string, unknown> = { provider: 'ecb' }
        if (start_date !== undefined) params.start_date = start_date
        return await economyClient.getBalanceOfPayments(params)
      },
    }),

    economyFomcDocuments: tool({
      description: `List FOMC document links — policy statements, meeting minutes and
projection materials — scraped from the Federal Reserve calendar (keyless).

Returns {date, title, type, url} sorted newest-first. Fetch the url with your
web tools to read the actual statement/minutes text. Statements publish on
meeting day; minutes ~3 weeks later.`,
      inputSchema: z.object({
        start_date: z.string().optional().describe('Earliest meeting date YYYY-MM-DD (optional)'),
      }).meta({ examples: [{}] }),
      execute: async ({ start_date }) => {
        const params: Record<string, unknown> = { provider: FRED_PROVIDER }
        if (start_date !== undefined) params.start_date = start_date
        return await economyClient.getFomcDocuments(params)
      },
    }),

    economyFedBalanceSheet: tool({
      description: `Get the Fed's balance sheet holdings (H.4.1 via FRED).

Weekly observations in USD millions: Treasuries held outright, MBS, agency
debt, and total assets. The QT/QE read — total assets shrinking = balance
sheet runoff. Requires a FRED key.`,
      inputSchema: z.object({
        date: z.string().optional().describe('Pin a specific week YYYY-MM-DD (optional; default recent history)'),
      }).meta({ examples: [{}] }),
      execute: async ({ date }) => {
        const params: Record<string, unknown> = { provider: FRED_PROVIDER }
        if (date !== undefined) params.date = date
        return await economyClient.getCentralBankHoldings(params)
      },
    }),

    economyDealerPositioning: tool({
      description: `Get primary dealer net positions from the NY Fed (keyless).

Weekly net positions in USD millions by asset class (treasury_total,
mbs_total, corporate_total, abs_total, agency_total) plus the summed
total_net_position. The dealer-balance-sheet read: heavy long Treasury
positioning = constrained intermediation capacity.`,
      inputSchema: z.object({
        start_date: z.string().optional().describe('Start date YYYY-MM-DD (optional)'),
        end_date: z.string().optional().describe('End date YYYY-MM-DD (optional)'),
      }).meta({ examples: [{ start_date: '2025-01-01' }] }),
      execute: async ({ start_date, end_date }) => {
        const params: Record<string, unknown> = { provider: FRED_PROVIDER }
        if (start_date !== undefined) params.start_date = start_date
        if (end_date !== undefined) params.end_date = end_date
        return await economyClient.getPrimaryDealerPositioning(params)
      },
    }),
  }
}
