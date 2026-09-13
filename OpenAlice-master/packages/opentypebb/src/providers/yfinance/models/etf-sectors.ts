/**
 * Yahoo Finance ETF Sectors Model.
 *
 * Keyless fallback for the FMP sector-weightings endpoint. Yahoo's
 * `topHoldings.sectorWeightings` carries the FULL sector breakdown
 * (one `{ key: weight }` entry per sector).
 */

import { z } from 'zod'
import { Fetcher } from '../../../core/provider/abstract/fetcher.js'
import { EtfSectorsQueryParamsSchema, EtfSectorsDataSchema } from '../../../standard-models/etf-sectors.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { getRawQuoteSummary } from '../utils/helpers.js'

/** Yahoo sector keys → display names (FMP-style labels). */
const SECTOR_NAMES: Record<string, string> = {
  realestate: 'Real Estate',
  consumer_cyclical: 'Consumer Cyclical',
  basic_materials: 'Basic Materials',
  consumer_defensive: 'Consumer Defensive',
  technology: 'Technology',
  communication_services: 'Communication Services',
  financial_services: 'Financial Services',
  utilities: 'Utilities',
  industrials: 'Industrials',
  energy: 'Energy',
  healthcare: 'Healthcare',
}

export const YFEtfSectorsQueryParamsSchema = EtfSectorsQueryParamsSchema
export type YFEtfSectorsQueryParams = z.infer<typeof YFEtfSectorsQueryParamsSchema>

export const YFEtfSectorsDataSchema = EtfSectorsDataSchema.passthrough()
export type YFEtfSectorsData = z.infer<typeof YFEtfSectorsDataSchema>

export class YFEtfSectorsFetcher extends Fetcher {
  static override requireCredentials = false

  static override transformQuery(params: Record<string, unknown>): YFEtfSectorsQueryParams {
    return YFEtfSectorsQueryParamsSchema.parse(params)
  }

  static override async extractData(query: YFEtfSectorsQueryParams): Promise<Record<string, unknown>[]> {
    const summary = await getRawQuoteSummary(query.symbol, ['topHoldings'])
    const weightings = (summary.topHoldings?.sectorWeightings ?? []) as Array<Record<string, unknown>>
    if (weightings.length === 0) {
      throw new EmptyDataError(`No sector data for ${query.symbol} (Yahoo carries sector weights for funds/ETFs only).`)
    }
    // Flatten [{ technology: 0.32 }, { energy: 0.04 }, …] → rows.
    const rows: Record<string, unknown>[] = []
    for (const entry of weightings) {
      for (const [key, weight] of Object.entries(entry)) {
        if (typeof weight === 'number') {
          rows.push({ symbol: query.symbol, sector: SECTOR_NAMES[key] ?? key, weight })
        }
      }
    }
    return rows
  }

  static override transformData(
    _query: YFEtfSectorsQueryParams,
    data: Record<string, unknown>[],
  ): YFEtfSectorsData[] {
    return data
      .map((d) => YFEtfSectorsDataSchema.parse(d))
      .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
  }
}
