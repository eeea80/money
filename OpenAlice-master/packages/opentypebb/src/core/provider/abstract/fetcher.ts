/**
 * Abstract Fetcher class — the TET (Transform, Extract, Transform) pipeline.
 * Maps to: openbb_core/provider/abstract/fetcher.py
 *
 * In Python, Fetcher is Generic[Q, R] with three static methods:
 *   1. transform_query(params: dict) -> Q         — validate & coerce input params
 *   2. extract_data(query: Q, creds) -> Any        — fetch raw data from provider API
 *   3. transform_data(query: Q, data: Any) -> R    — parse raw data into typed output
 *   4. fetch_data() orchestrates the above pipeline
 *
 * Subclasses implement either extract_data (sync) or aextract_data (async).
 * In TypeScript, we only need async (extractData is always async).
 *
 * Fetcher classes are never instantiated — all methods are static.
 * This matches the Python pattern where all methods are @staticmethod.
 */

/** Type for a Fetcher class (not instance). */
export interface FetcherClass {
  /** Whether this fetcher requires provider credentials. */
  requireCredentials: boolean

  /** Transform raw params dict into typed query object. */
  transformQuery(params: Record<string, unknown>): unknown

  /** Extract raw data from the provider API. */
  extractData(
    query: unknown,
    credentials: Record<string, string> | null,
  ): Promise<unknown>

  /** Transform raw data into typed result. */
  transformData(query: unknown, data: unknown): unknown

  /** Full pipeline: transformQuery → extractData → transformData */
  fetchData(
    params: Record<string, unknown>,
    credentials?: Record<string, string> | null,
  ): Promise<unknown>
}

/**
 * Abstract Fetcher base class.
 *
 * Each provider model creates a concrete subclass:
 *
 * ```typescript
 * export class FMPEquityProfileFetcher extends Fetcher {
 *   static requireCredentials = true
 *
 *   static transformQuery(params) {
 *     return FMPEquityProfileQueryParamsSchema.parse(params)
 *   }
 *
 *   static async extractData(query, credentials) {
 *     const apiKey = credentials?.fmp_api_key ?? ''
 *     return await amakeRequest(`https://...?apikey=${apiKey}`)
 *   }
 *
 *   static transformData(query, data) {
 *     return data.map(d => FMPEquityProfileDataSchema.parse(applyAliases(d, aliasDict)))
 *   }
 * }
 * ```
 */
export abstract class Fetcher {
  /** Whether this fetcher requires provider credentials. Can be overridden by subclasses. */
  static requireCredentials = true

  /** Transform the params to the provider-specific query. */
  static transformQuery(_params: Record<string, unknown>): unknown {
    throw new Error('transformQuery not implemented')
  }

  /** Extract the data from the provider (async). */
  static async extractData(
    _query: unknown,
    _credentials: Record<string, string> | null,
  ): Promise<unknown> {
    throw new Error('extractData not implemented')
  }

  /** Transform the provider-specific data. */
  static transformData(_query: unknown, _data: unknown): unknown {
    throw new Error('transformData not implemented')
  }

  /**
   * Fetch data from a provider.
   * Orchestrates the TET pipeline: transformQuery → extractData → transformData.
   *
   * Maps to: Fetcher.fetch_data() in fetcher.py
   */
  static async fetchData(
    params: Record<string, unknown>,
    credentials: Record<string, string> | null = null,
  ): Promise<unknown> {
    const query = this.transformQuery(params)
    const data = await this.extractData(query, credentials)
    return this.transformData(query, data)
  }
}
