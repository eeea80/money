/**
 * Proxy bootstrap — makes globalThis.fetch proxy-aware via undici.
 *
 * Call setupProxy() ONCE at server startup, BEFORE any fetch calls.
 * Reads HTTP_PROXY / HTTPS_PROXY / NO_PROXY from environment.
 * If no proxy env vars are set, this is a no-op.
 */
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici'

export function setupProxy(): void {
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY
                || process.env.https_proxy || process.env.http_proxy
  if (!proxy) return

  // EnvHttpProxyAgent auto-reads HTTP_PROXY/HTTPS_PROXY/NO_PROXY
  const agent = new EnvHttpProxyAgent()
  setGlobalDispatcher(agent)

  console.log(`[proxy] Using proxy: ${proxy}`)
}
