/**
 * Index Sectors Standard Model.
 * Maps to: openbb_core/provider/standard_models/index_sectors.py
 */

import { z } from 'zod'

export const IndexSectorsQueryParamsSchema = z.object({
  symbol: z.string().transform(v => v.toUpperCase()).describe('Symbol to get data for.'),
}).passthrough()

export type IndexSectorsQueryParams = z.infer<typeof IndexSectorsQueryParamsSchema>

export const IndexSectorsDataSchema = z.object({
  sector: z.string().describe('The sector name.'),
  weight: z.number().describe('The weight of the sector in the index.'),
}).passthrough()

export type IndexSectorsData = z.infer<typeof IndexSectorsDataSchema>
