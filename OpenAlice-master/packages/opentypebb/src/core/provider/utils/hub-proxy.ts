/**
 * Hub-proxy credential sentinel.
 *
 * A credential value of the form `hub:<baseUrl>` means "no user key —
 * route this provider's requests through the TraderHub keyed proxy at
 * <baseUrl> instead". The hub injects its own key upstream; the fetcher
 * keeps building paths/params/transforms exactly as for the real origin,
 * so response shapes cannot drift.
 *
 * Only origin-centralized providers participate (fred / eia / bls).
 */

export interface KeyedOrigin {
  /** Real user key, or '' when routing via hub (hub injects its own). */
  key: string
  /** Origin to build request URLs against. */
  origin: string
}

export function resolveKeyedOrigin(
  rawKey: string | undefined | null,
  realOrigin: string,
  providerSegment: string,
): KeyedOrigin {
  const value = (rawKey ?? '').trim()
  if (value.startsWith('hub:')) {
    const hub = value.slice('hub:'.length).replace(/\/+$/, '')
    return { key: '', origin: `${hub}/api/proxy/${providerSegment}` }
  }
  return { key: value, origin: realOrigin }
}
