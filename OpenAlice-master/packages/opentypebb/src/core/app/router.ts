/**
 * Router — command registration and routing.
 * Maps to: openbb_core/app/router.py
 *
 * In Python, Router wraps FastAPI's APIRouter with:
 * - @router.command(model="...") decorator for registering commands
 * - include_router() for hierarchical nesting
 * - Auto-generates FastAPI routes with dependency injection
 *
 * In TypeScript, Router serves two purposes:
 * 1. Library mode: getCommandMap() returns a flat map of commands
 * 2. HTTP mode: mountToHono() generates Hono routes
 *
 * Each command is a thin function that delegates to Query.execute().
 */

import type { Hono } from 'hono'
import type { QueryExecutor } from '../provider/query-executor.js'

/**
 * Coerce a URL query-string value to an appropriate JS type.
 * URL params are always strings, but Zod schemas (like OpenBB's Pydantic models)
 * expect native numbers/booleans. FastAPI does this automatically; we replicate it here.
 */
function coerceQueryValue(value: string): unknown {
  // Boolean
  if (value === 'true') return true
  if (value === 'false') return false
  // Null
  if (value === 'null' || value === 'none' || value === 'None') return null
  // Number (integer or float) — but NOT date-like strings like "2024-01-01"
  if (/^-?\d+$/.test(value)) return Number(value)
  if (/^-?\d+\.\d+$/.test(value)) return Number(value)
  // Keep as string
  return value
}

/**
 * A registered command handler.
 * The handler receives params + credentials and returns the raw result.
 */
export interface CommandHandler {
  (
    executor: QueryExecutor,
    provider: string,
    params: Record<string, unknown>,
    credentials: Record<string, string> | null,
  ): Promise<unknown>
}

/** Command definition registered in a Router. */
export interface CommandDef {
  /** Standard model name (e.g., "EquityHistorical"). */
  model: string
  /** Route path segment (e.g., "/historical"). */
  path: string
  /** Human-readable description. */
  description: string
  /** The handler function. */
  handler: CommandHandler
}

/**
 * Router class for registering commands and building routes.
 *
 * Usage in extensions (maps to Python's @router.command pattern):
 *
 * ```typescript
 * const router = new Router({ prefix: '/price' })
 *
 * router.command({
 *   model: 'EquityQuote',
 *   path: '/quote',
 *   description: 'Get the latest quote for a given stock.',
 *   handler: async (executor, provider, params, credentials) => {
 *     return executor.execute(provider, 'EquityQuote', params, credentials)
 *   },
 * })
 * ```
 */
export class Router {
  readonly prefix: string
  readonly description?: string
  private readonly _commands: CommandDef[] = []
  private readonly _subRouters: Array<{ prefix: string; router: Router }> = []

  constructor(opts: { prefix?: string; description?: string } = {}) {
    this.prefix = opts.prefix ?? ''
    this.description = opts.description
  }

  /**
   * Register a command.
   * Maps to: @router.command(model="...", ...) in router.py
   */
  command(def: CommandDef): void {
    this._commands.push(def)
  }

  /**
   * Include a sub-router.
   * Maps to: router.include_router(sub_router, prefix="/price") in router.py
   */
  includeRouter(router: Router, prefix?: string): void {
    this._subRouters.push({
      prefix: prefix ?? router.prefix,
      router,
    })
  }

  /**
   * Get all commands as a flat map of {fullPath: CommandDef}.
   * Used in library mode for direct invocation.
   */
  getCommandMap(basePath = ''): Map<string, CommandDef> {
    const map = new Map<string, CommandDef>()
    const fullPrefix = basePath + this.prefix

    for (const cmd of this._commands) {
      map.set(fullPrefix + cmd.path, cmd)
    }

    for (const { router } of this._subRouters) {
      // Let the sub-router add its own prefix — don't add the stored prefix too
      // (stored prefix defaults to router.prefix, so it would be applied twice)
      const subMap = router.getCommandMap(fullPrefix)
      for (const [path, cmd] of subMap) {
        map.set(path, cmd)
      }
    }

    return map
  }

  /**
   * Get all registered model names.
   * Useful for discovering available commands.
   */
  getModelNames(basePath = ''): string[] {
    const names: string[] = []
    const fullPrefix = basePath + this.prefix

    for (const cmd of this._commands) {
      names.push(cmd.model)
    }

    for (const { router } of this._subRouters) {
      names.push(...router.getModelNames(fullPrefix))
    }

    return names
  }

  /**
   * Mount all commands as Hono GET routes.
   * Maps to: AppLoader.add_routers() / RouterLoader in rest_api.py
   *
   * Each command becomes: GET /api/v1/{extension}/{path}?params...
   *   - Provider: explicit `?provider=` query wins; else `resolveProvider(path, basePath)`
   *     if supplied; else empty string (executor will surface a "provider required" error).
   *   - Credentials from X-OpenBB-Credentials header, falling back to
   *     `defaultCredentials` when the header is absent or malformed.
   *     Pass a function to have it evaluated per-request (picks up config
   *     changes without remounting).
   */
  mountToHono(
    app: Hono,
    executor: QueryExecutor,
    basePath = '/api/v1',
    defaultCredentials:
      | Record<string, string>
      | null
      | (() => Record<string, string> | null) = null,
    resolveProvider?: (path: string, basePath: string) => string | undefined,
  ): void {
    const commands = this.getCommandMap(basePath)
    const getDefaultCredentials =
      typeof defaultCredentials === 'function'
        ? defaultCredentials
        : () => defaultCredentials

    for (const [path, cmd] of commands) {
      app.get(path, async (c) => {
        const url = new URL(c.req.url)
        const params: Record<string, unknown> = {}
        for (const [key, value] of url.searchParams) {
          // Coerce URL query param strings to appropriate JS types.
          // FastAPI does this automatically via type annotations; we replicate it here.
          params[key] = coerceQueryValue(value)
        }

        // Provider precedence: explicit query > resolver callback > empty string.
        const queryProvider = (params.provider as string | undefined) ?? ''
        const provider = queryProvider || resolveProvider?.(path, basePath) || ''
        delete params.provider

        // Parse credentials from header; fall back to defaults (re-evaluated
        // per request so config edits take effect without a restart).
        const credHeader = c.req.header('X-OpenBB-Credentials')
        let credentials: Record<string, string> | null = getDefaultCredentials()
        if (credHeader) {
          try {
            credentials = JSON.parse(credHeader)
          } catch {
            // Malformed header — keep defaults rather than dropping creds.
          }
        }

        try {
          const result = await cmd.handler(executor, provider, params, credentials)
          // Wrap in OBBject-compatible envelope (matches OpenBB Python response format)
          return c.json({
            results: Array.isArray(result) ? result : [result],
            provider,
            warnings: null,
            chart: null,
            extra: {},
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return c.json({
            results: null,
            provider,
            warnings: null,
            chart: null,
            extra: {},
            error: message,
          }, 500)
        }
      })
    }
  }
}
