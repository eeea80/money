/**
 * Reference cache — the single-node version of the hub's cache layer.
 *
 * Low-frequency data behind per-IP-quota'd upstreams (OECD especially: the
 * data changes quarterly but the anonymous API rate-limits aggressively) is
 * the textbook cache case. Semantics match the future hosted hub exactly —
 * `meta.cachedAt` marks a cache hit, `meta.stale` marks stale-while-error —
 * so moving this behind the hub later swaps the storage, not the contract.
 */

import type { ReferenceMeta } from './types.js'

interface Entry<T> {
  at: number
  value: T
}

/** Wrap a board fetcher with TTL caching + in-flight dedupe + stale-while-error. */
export function cachedBoard<T extends { meta: ReferenceMeta }>(
  ttlMs: number,
  fn: () => Promise<T>,
): () => Promise<T> {
  let entry: Entry<T> | null = null
  let inflight: Promise<T> | null = null

  const withMeta = (e: Entry<T>, stale: boolean): T => ({
    ...e.value,
    meta: {
      ...e.value.meta,
      cachedAt: new Date(e.at).toISOString(),
      ...(stale ? { stale: true } : {}),
    },
  })

  return async () => {
    if (entry && Date.now() - entry.at < ttlMs) return withMeta(entry, false)
    if (inflight) return inflight
    inflight = fn()
      .then((value) => {
        entry = { at: Date.now(), value }
        inflight = null
        return value
      })
      .catch((err: unknown) => {
        inflight = null
        // Upstream down but we have a last-good payload → serve it, marked
        // stale. No payload at all → the error stays loud.
        if (entry) return withMeta(entry, true)
        throw err
      })
    return inflight
  }
}
