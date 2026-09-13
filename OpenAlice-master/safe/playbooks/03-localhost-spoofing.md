# Playbook 03: Localhost-Trust Spoofing

**Threat**: Bypass the "localhost requests skip auth" convenience shortcut
to gain authenticated access without a session.
**Severity**: Critical (if exploited successfully)
**Tier applies**: T2 ☑ / T3 ☑ (the entire reason this attack exists is
  the localhost-bypass dev-UX feature)
**Status (2026-05-23)**: ✅ Mitigated in commit `754cef7`. Localhost
trust gates on the raw `socket.remoteAddress` (not parsed headers), and
the trust path is **disabled entirely** when `OPENALICE_TRUSTED_PROXIES`
is configured. XFF-spoof + Host-spoof cases covered by
`auth.spec.ts > "03.1: X-Forwarded-For: 127.0.0.1 ... → ignored"` and
`"03.4: when trusted proxy is configured, localhost passthrough disabled entirely"`.

## What this class is

The plan for OpenAlice's auth is to skip auth for **true localhost**
requests, preserving zero-friction dev UX (`pnpm dev` → browser localhost:5173 → works without login).

But "true localhost" is subtle. Common implementation mistakes:

1. **Check `req.socket.remoteAddress === '127.0.0.1'`** — fine in raw
   deploys, BUT in production OpenAlice typically sits behind a reverse
   proxy (Caddy / nginx / Cloudflare Tunnel). The proxy IS at 127.0.0.1
   to OpenAlice. So **every** request looks like localhost.
2. **Trust `X-Forwarded-For` header** — usually correct in proxy setups,
   but if you trust this header unconditionally, an internet attacker can
   send `X-Forwarded-For: 127.0.0.1` and claim localhost.
3. **Trust `X-Real-IP`** — same problem as XFF.
4. **Match on hostname `Host: localhost`** — trivially spoofable in the
   request.

The defense:
- Only trust forwarded headers from a **configured trusted proxy IP**
- If no trusted proxy is configured, only believe `req.socket.remoteAddress`
  (true loopback)
- If a trusted proxy IS configured, **never** treat the proxy's own IP as
  "localhost" — the proxy is forwarding from external clients

## Pre-conditions

- Alice is bound to a non-localhost interface (LAN IP, public IP)
- Auth middleware is active
- The middleware has a "localhost-trust passthrough" branch

## Seed cases

### 3.1 — Direct `X-Forwarded-For` spoof, no proxy configured

**Setup**: Alice binds 0.0.0.0:47331, no `OPENALICE_TRUSTED_PROXIES` env.

**Attack**:
```bash
curl -i http://192.168.1.5:47331/api/trading/uta \
  -H "X-Forwarded-For: 127.0.0.1"
```

(Or `1.2.3.4` instead of `192.168.1.5` if testing on a public IP.)

**Secure behavior**: 401. The middleware should ignore `X-Forwarded-For`
when no trusted proxy is configured. `req.socket.remoteAddress` is the
attacker's IP (e.g., `192.168.1.99` or some public IP), so no
localhost bypass.

**Current (pre-impl)**: 200. The test will be: is this 401 after impl?

---

### 3.2 — `X-Real-IP` spoof

**Attack**:
```bash
curl -i http://192.168.1.5:47331/api/trading/uta \
  -H "X-Real-IP: 127.0.0.1"
```

**Secure behavior**: 401. Same as 3.1.

---

### 3.3 — `Host` header spoof

**Attack**:
```bash
curl -i http://192.168.1.5:47331/api/trading/uta \
  -H "Host: localhost"
```

**Secure behavior**: 401. The `Host` header is for routing/virtualhosts,
not authentication.

---

### 3.4 — Spoof through a configured-but-not-actually-trusted-IP

**Setup**: Alice configured with `OPENALICE_TRUSTED_PROXIES=10.0.0.5`
(a hypothetical reverse proxy at 10.0.0.5). Attacker is at 1.2.3.4.

**Attack**:
```bash
curl -i http://alice.example.com/api/trading/uta \
  -H "X-Forwarded-For: 127.0.0.1"
```

(Coming from 1.2.3.4, not from the trusted proxy.)

**Secure behavior**: 401. The middleware sees `req.socket.remoteAddress`
is 1.2.3.4 (NOT in trusted-proxies list), so it must IGNORE
`X-Forwarded-For`.

---

### 3.5 — Multi-hop XFF chain

**Setup**: trusted proxy at 10.0.0.5 forwarding to Alice.

**Attack**: legitimate request from 1.2.3.4 reaches 10.0.0.5, which appends
to XFF. But what if the legitimate attacker adds their own XFF?

Legitimate user at `1.2.3.4` sends:
```
GET / HTTP/1.1
Host: alice.example.com
X-Forwarded-For: 127.0.0.1
```

Reverse proxy at 10.0.0.5 appends `1.2.3.4` to it:
```
GET / HTTP/1.1
Host: alice.example.com
X-Forwarded-For: 127.0.0.1, 1.2.3.4
```

If Alice reads XFF and uses the **first** entry (the leftmost), it sees
`127.0.0.1` and grants localhost privilege. **WRONG.**

**Secure behavior**: the **rightmost** entry that was added by the trusted
proxy is the actual client IP. Specifically: trust the entry inserted by
the last trusted hop. Use a library like Hono's trusted-proxy support
correctly, or implement carefully:
- Split XFF by comma
- Skip rightmost entries that are in trusted-proxies list
- The first non-trusted IP is the client

This is the most subtle implementation pitfall.

---

### 3.6 — IPv6 loopback variations

**Attack**:
```bash
curl -i http://[::1]:47331/api/trading/uta -g
curl -i http://0.0.0.0:47331/api/trading/uta
curl -i http://localhost.localdomain:47331/api/trading/uta
```

**Secure behavior**: `::1` is IPv6 loopback — should bypass auth same as
`127.0.0.1`. `0.0.0.0` is NOT loopback — should require auth. The
"localhost" hostname depending on resolution may go either way; the
middleware should rely on the actual socket IP, not the hostname.

---

### 3.7 — `req.socket.remoteAddress` malformed

**Attack**: Node.js represents IPv4 as `127.0.0.1`, but IPv4-mapped IPv6
as `::ffff:127.0.0.1`. Does the middleware handle both?

```bash
# Force IPv6 connection
curl -i --ipv6 http://[::1]:47331/api/trading/uta -g
```

The address Node.js sees might be `::ffff:127.0.0.1`.

**Secure behavior**: middleware normalizes the IP and checks both forms.

---

## Extension hints

- **`Forwarded` standard header** (RFC 7239): syntax is different from
  XFF. Does the middleware understand it?
- **HTTP/2 pseudo-headers**: `:authority` instead of `Host` — does
  middleware check both?
- **Race conditions**: in a clustered Node process (Cluster module), is
  there any per-connection state that could leak?
- **WebSocket upgrade**: does the upgrade handshake go through the same
  localhost-trust check?
- **Trust the proxy chain but skip the LAST hop**: if there's a known
  bug where the implementation grants trust based on first IP not last
  IP in a chain, this becomes exploitable.

## Code paths to read (post-impl)

- `src/webui/middleware/auth.ts` (when it exists) — the localhost-trust
  branch
- `src/webui/middleware/trusted-proxy.ts` (or similar) — XFF parsing logic
- `src/core/config.ts` — `OPENALICE_TRUSTED_PROXIES` env parsing

## Remediation notes

The implementation should:

1. Default: no trusted proxies configured → only `req.socket.remoteAddress`
   counts → localhost bypass requires actual loopback IP
2. With trusted proxies: parse XFF from right to left, skip trusted proxy
   IPs, take the first non-trusted IP as the client
3. Normalize IP comparisons: handle IPv4, IPv6, IPv4-mapped IPv6
4. **Never** look at Host header for auth decisions
5. **Never** look at user-controlled headers (X-Real-IP, etc.) unless from
   trusted proxy
6. Document the env var clearly with sample config (Caddy / nginx /
   Cloudflare examples)
7. Log every localhost-bypass decision at DEBUG level so misconfigurations
   are auditable

## A specific test case to write

When auth lands, add a unit test:

```typescript
describe('auth middleware: localhost trust', () => {
  it('allows bypass for true loopback IPv4', () => {
    const req = mockReq({ remoteAddress: '127.0.0.1' })
    expect(shouldBypassAuth(req, { trustedProxies: [] })).toBe(true)
  })

  it('allows bypass for true loopback IPv6', () => {
    const req = mockReq({ remoteAddress: '::1' })
    expect(shouldBypassAuth(req, { trustedProxies: [] })).toBe(true)
  })

  it('DOES NOT bypass when XFF claims localhost without trusted proxy', () => {
    const req = mockReq({
      remoteAddress: '203.0.113.5',
      headers: { 'x-forwarded-for': '127.0.0.1' }
    })
    expect(shouldBypassAuth(req, { trustedProxies: [] })).toBe(false)
  })

  it('correctly extracts client from XFF behind trusted proxy', () => {
    const req = mockReq({
      remoteAddress: '10.0.0.5',
      headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.5' }
    })
    const clientIp = extractClientIp(req, { trustedProxies: ['10.0.0.5'] })
    expect(clientIp).toBe('203.0.113.5')
    expect(shouldBypassAuth(req, { trustedProxies: ['10.0.0.5'] })).toBe(false)
  })

  it('rejects XFF spoof from outside trusted proxy', () => {
    const req = mockReq({
      remoteAddress: '203.0.113.5',  // attacker's IP
      headers: { 'x-forwarded-for': '127.0.0.1' }
    })
    expect(shouldBypassAuth(req, { trustedProxies: ['10.0.0.5'] })).toBe(false)
  })
})
```

This is the kind of test that **must** exist before claiming localhost-trust
is implemented safely. Write it before the impl (TDD), make it red, then
implement until green.

## References

- RFC 7239 — Forwarded HTTP Extension
- OWASP IP Address Spoofing
- [`safe/playbooks/04-public-misconfig.md`](./04-public-misconfig.md) — related (TBD)
