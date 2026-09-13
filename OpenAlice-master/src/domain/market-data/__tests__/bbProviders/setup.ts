/**
 * bbProvider test setup — shared executor + credentials.
 *
 * Reads config.json for provider API keys, initializes the openTypeBB executor.
 * Lazily cached: first call loads config, subsequent calls return same instance.
 */

import { loadConfig } from '@/core/config.js'
import { buildSDKCredentials } from '@/domain/market-data/credential-map.js'
import { createExecutor, type QueryExecutor } from '@traderalice/opentypebb'

export interface TestContext {
  executor: QueryExecutor
  credentials: Record<string, string>
}

let _ctx: TestContext | null = null

export async function getTestContext(): Promise<TestContext> {
  if (!_ctx) {
    const config = await loadConfig()
    _ctx = {
      executor: createExecutor(),
      credentials: buildSDKCredentials(config.marketData.providerKeys),
    }
  }
  return _ctx
}

/** Check whether a specific bbProvider's API key is configured. */
export function hasCredential(credentials: Record<string, string>, bbProvider: string): boolean {
  const key = `${bbProvider}_api_key`
  return !!credentials[key]
}
