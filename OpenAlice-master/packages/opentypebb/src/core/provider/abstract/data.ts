/**
 * Base Data schema.
 * Maps to: openbb_core/provider/abstract/data.py
 *
 * In Python, Data is a Pydantic BaseModel with:
 * - __alias_dict__: maps {newFieldName: originalFieldName} for input aliasing
 * - AliasGenerator with camelCase validation / snake_case serialization
 * - ConfigDict(extra="allow", populate_by_name=True, strict=False)
 * - model_validator(mode="before") that applies __alias_dict__
 *
 * In TypeScript, we use Zod schemas. The alias handling is done explicitly
 * in each Fetcher's transformData via the applyAliases() helper.
 */

import { z } from 'zod'

/**
 * Base Data schema — empty by default.
 * Standard models extend this with their specific fields.
 * Provider-specific models further extend the standard.
 *
 * Using .passthrough() to match Python's ConfigDict(extra="allow").
 */
export const BaseDataSchema = z.object({}).passthrough()

export type BaseData = z.infer<typeof BaseDataSchema>

/**
 * ForceInt — coerces a value to integer.
 * Maps to: ForceInt = Annotated[int, BeforeValidator(check_int)] in data.py
 */
export const ForceInt = z.preprocess((v) => {
  if (v === null || v === undefined) return v
  const n = Number(v)
  if (isNaN(n)) return v
  return Math.trunc(n)
}, z.number().int().nullable())
