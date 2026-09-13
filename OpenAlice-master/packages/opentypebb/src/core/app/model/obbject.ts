/**
 * OBBject — the universal response envelope.
 * Maps to: openbb_core/app/model/obbject.py
 *
 * In Python, OBBject is a Generic[T] Pydantic model with:
 *   results: T | None
 *   provider: str | None
 *   warnings: List[Warning_] | None
 *   chart: Chart | None
 *   extra: Dict[str, Any]
 *
 * It also has from_query() classmethod, to_dataframe(), to_dict(), etc.
 * In TypeScript, we skip the DataFrame/Polars/NumPy conversion methods.
 */

export interface Warning {
  category: string
  message: string
}

export interface OBBjectData<T> {
  results: T[] | null
  provider: string | null
  warnings: Warning[] | null
  chart: unknown | null
  extra: Record<string, unknown>
}

export class OBBject<T> {
  results: T[] | null
  provider: string | null
  warnings: Warning[] | null
  chart: unknown | null
  extra: Record<string, unknown>

  // Private metadata (matches Python's PrivateAttr fields)
  private _route: string | null = null
  private _standardParams: Record<string, unknown> | null = null
  private _extraParams: Record<string, unknown> | null = null

  constructor(data: Partial<OBBjectData<T>> = {}) {
    this.results = data.results ?? null
    this.provider = data.provider ?? null
    this.warnings = data.warnings ?? null
    this.chart = data.chart ?? null
    this.extra = data.extra ?? {}
  }

  /** Set route metadata. */
  setRoute(route: string): this {
    this._route = route
    return this
  }

  /** Set standard params metadata. */
  setStandardParams(params: Record<string, unknown>): this {
    this._standardParams = params
    return this
  }

  /** Set extra params metadata. */
  setExtraParams(params: Record<string, unknown>): this {
    this._extraParams = params
    return this
  }

  /** Get route metadata. */
  get route(): string | null {
    return this._route
  }

  /** JSON-serializable representation for HTTP responses. */
  toJSON(): OBBjectData<T> {
    return {
      results: this.results,
      provider: this.provider,
      warnings: this.warnings,
      chart: this.chart,
      extra: this.extra,
    }
  }

  /**
   * Create OBBject from query execution result.
   * Maps to: OBBject.from_query() in obbject.py
   *
   * In the simplified TypeScript version, this directly wraps
   * the fetcher result rather than going through the full
   * Query → ProviderInterface → CommandRunner pipeline.
   */
  static fromResults<R>(
    results: R[],
    provider: string,
    extra?: Record<string, unknown>,
  ): OBBject<R> {
    return new OBBject<R>({
      results,
      provider,
      extra,
    })
  }
}
