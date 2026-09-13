# Base URLs

All BingX OpenAPI endpoints share the same base URL prefix. Choose the environment that matches your use case.

## Environment Table

| Environment ID | Description | Base URL (Primary) | Base URL (Fallback) |
|----------------|-------------|---------------------|---------------------|
| `prod-live` | Production Live | `https://open-api.bingx.com` | `https://open-api.bingx.pro` |
| `prod-vst` | Production Simulated (Testnet) | `https://open-api-vst.bingx.com` | `https://open-api-vst.bingx.pro` |

> **Default:** Use `prod-live` for real trading. Use `prod-vst` for paper trading / testing without real funds.

## Domain Priority Constraint

**The `.com` domain is the mandatory primary endpoint. The `.pro` domain is a fallback ONLY for network-level failures.**

1. **Always call `.com` first** — every request must target the primary `.com` domain.
2. **Fallback to `.pro` only on timeout or network unreachable** — if the `.com` domain fails due to a connection error (DNS failure, TCP refused, TLS handshake failure) or a request timeout (default 10 s), retry the same request against the `.pro` fallback domain.
3. **Never fallback on business errors** — if the `.com` domain responds with an HTTP status and a valid JSON body (even if `code !== 0`), that is a successful network round-trip. Do **not** retry with `.pro`; throw the business error immediately.

## TypeScript Helper

Use this constant in your code to switch environments easily. Each environment maps to an array of URLs — primary first, fallback second:

```typescript
const BASE_URLS: Record<string, string[]> = {
  "prod-live": ["https://open-api.bingx.com", "https://open-api.bingx.pro"],
  "prod-vst":  ["https://open-api-vst.bingx.com", "https://open-api-vst.bingx.pro"],
};

function getBaseUrls(env: string = "prod-live"): string[] {
  return BASE_URLS[env] ?? BASE_URLS["prod-live"];
}

function isNetworkOrTimeout(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  if (e instanceof DOMException && e.name === "AbortError") return true;
  if (e instanceof Error && e.name === "TimeoutError") return true;
  return false;
}
```
