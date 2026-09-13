/**
 * Query class.
 * Maps to: openbb_core/app/query.py
 *
 * In Python, Query holds CommandContext + ProviderChoices + StandardParams + ExtraParams,
 * and execute() calls ProviderInterface → QueryExecutor.
 *
 * In TypeScript, Query is simplified:
 * - Takes provider name, model name, params, and credentials directly
 * - Delegates to QueryExecutor.execute()
 * - No ProviderInterface dependency injection (handled by Router)
 */

import type { QueryExecutor } from '../provider/query-executor.js'
import { OBBject } from './model/obbject.js'
import { createMetadata } from './model/metadata.js'

export interface QueryConfig {
  /** Provider name (e.g., "fmp"). */
  provider: string
  /** Model name (e.g., "EquityHistorical"). */
  model: string
  /** Merged params (standard + extra). */
  params: Record<string, unknown>
  /** Provider credentials. */
  credentials: Record<string, string> | null
  /** Route path for metadata. */
  route?: string
}

export class Query {
  readonly provider: string
  readonly model: string
  readonly params: Record<string, unknown>
  readonly credentials: Record<string, string> | null
  readonly route: string

  constructor(
    private readonly executor: QueryExecutor,
    config: QueryConfig,
  ) {
    this.provider = config.provider
    this.model = config.model
    this.params = config.params
    this.credentials = config.credentials
    this.route = config.route ?? `/${config.model}`
  }

  /**
   * Execute the query and return an OBBject.
   * Maps to: Query.execute() in query.py + OBBject.from_query()
   */
  async execute<T>(): Promise<OBBject<T>> {
    const startTime = Date.now()

    const results = await this.executor.execute(
      this.provider,
      this.model,
      this.params,
      this.credentials,
    )

    const metadata = createMetadata(this.route, this.params, startTime)

    const obbject = new OBBject<T>({
      results: results as T[],
      provider: this.provider,
      extra: { metadata },
    })

    obbject.setRoute(this.route)
    obbject.setStandardParams(this.params)

    return obbject
  }
}
