/**
 * Base QueryParams schema.
 * Maps to: openbb_core/provider/abstract/query_params.py
 *
 * In Python, QueryParams is a Pydantic BaseModel with:
 * - __alias_dict__: maps field names to API aliases for model_dump()
 * - __json_schema_extra__: provider-specific schema hints
 * - ConfigDict(extra="allow", populate_by_name=True)
 *
 * In TypeScript, we use Zod schemas. Extensions use .extend() to add fields.
 * Alias handling is done in the Fetcher's transformQuery via applyAliases().
 */

import { z } from 'zod'

/**
 * Base QueryParams schema — empty by default.
 * Standard models extend this with their specific fields.
 * Provider-specific models further extend the standard with extra fields.
 *
 * Using .passthrough() to match Python's ConfigDict(extra="allow").
 */
export const BaseQueryParamsSchema = z.object({}).passthrough()

export type BaseQueryParams = z.infer<typeof BaseQueryParamsSchema>
