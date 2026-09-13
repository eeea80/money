/**
 * Earnings Call Transcript Standard Model.
 * Maps to: openbb_core/provider/standard_models/earnings_call_transcript.py
 */

import { z } from 'zod'

export const EarningsCallTranscriptQueryParamsSchema = z.object({
  symbol: z.string().describe('Symbol to get data for.'),
  year: z.coerce.number().nullable().default(null).describe('Year of the earnings call transcript.'),
  quarter: z.coerce.number().nullable().default(null).describe('Quarterly period of the earnings call transcript (1-4).'),
}).passthrough()

export type EarningsCallTranscriptQueryParams = z.infer<typeof EarningsCallTranscriptQueryParamsSchema>

export const EarningsCallTranscriptDataSchema = z.object({
  symbol: z.string().describe('Symbol representing the entity.'),
  year: z.number().describe('Year of the earnings call transcript.'),
  quarter: z.string().describe('Quarter of the earnings call transcript.'),
  date: z.string().describe('The date of the data.'),
  content: z.string().describe('Content of the earnings call transcript.'),
}).passthrough()

export type EarningsCallTranscriptData = z.infer<typeof EarningsCallTranscriptDataSchema>
