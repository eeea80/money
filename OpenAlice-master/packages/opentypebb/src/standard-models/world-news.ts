/**
 * World News Standard Model.
 * Maps to: openbb_core/provider/standard_models/world_news.py
 */

import { z } from 'zod'

export const WorldNewsQueryParamsSchema = z.object({
  start_date: z.string().nullable().default(null).describe('Start date of the data, in YYYY-MM-DD format.'),
  end_date: z.string().nullable().default(null).describe('End date of the data, in YYYY-MM-DD format.'),
  limit: z.number().int().nonnegative().nullable().default(null).describe('The number of data entries to return.'),
}).passthrough()

export type WorldNewsQueryParams = z.infer<typeof WorldNewsQueryParamsSchema>

export const WorldNewsDataSchema = z.object({
  date: z.string().describe('The date of publication.'),
  title: z.string().describe('Title of the article.'),
  author: z.string().nullable().default(null).describe('Author of the article.'),
  excerpt: z.string().nullable().default(null).describe('Excerpt of the article text.'),
  body: z.string().nullable().default(null).describe('Body of the article text.'),
  images: z.unknown().nullable().default(null).describe('Images associated with the article.'),
  url: z.string().nullable().default(null).describe('URL to the article.'),
}).passthrough()

export type WorldNewsData = z.infer<typeof WorldNewsDataSchema>
