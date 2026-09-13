# Playbook 07: WebSocket Upgrade Authentication

**Threat**: Reaching the workspaces PTY WebSocket without a valid session,
bypassing Hono's HTTP middleware chain.
**Severity**: Critical
**Tier applies**: T2 ☑ / T3 ☑ (T1 localhost bypass-by-design)
**Status (2026-05-23)**: ✅ Mitigated in commit `754cef7` — upgrade handler
re-applies the auth gate (`src/webui/workspaces-ws.ts:isUpgradeAuthorized`).
Manual cross-host re-run pending; no dedicated unit spec yet (the upgrade
path is event-driven on `http.Server` and is exercised via integration only).

## What this class is

Hono middleware runs on requests that complete a normal HTTP exchange.
WebSocket upgrade requests (`Connection: Upgrade`) are handled by the
`upgrade` event on the underlying `node:http.Server` — they never reach
Hono's middleware chain. So an auth middleware that only registers via
`app.use('*', ...)` does **not** gate `/api/workspaces/pty`.

The PTY endpoint hands the client raw access to a spawned process (Claude
Code, Codex CLI, etc.) running under the operator's user. An unauthenticated
attacker who can reach the upgrade endpoint can:

- Attach to an existing PTY session (if they can guess / leak the session ID)
- Send arbitrary keystrokes into a running agent's stdin
- Read all agent stdout (credentials in env, file paths, broker IDs, etc.)

## Pre-conditions

- Alice instance running (`pnpm dev` or `docker run`)
- Attacker reachable to bound port
- Attacker has NO admin token, NO session cookie

## Seed cases

### 7.1 — Unauthenticated upgrade from non-localhost

**Attack**:

```bash
# From a machine that's NOT Alice's loopback:
websocat -H 'Host: alice.victim.com' \
  ws://alice.victim.com:47331/api/workspaces/pty?session=abc
```

**Secure behavior**: HTTP `401 Unauthorized` returned during the upgrade
handshake; socket destroyed before WebSocket frames flow.

**Current (post-754cef7)**: `401`. `isUpgradeAuthorized()` runs before
`wss.handleUpgrade()`. ✅ Mitigated.

---

### 7.2 — Forged cookie on upgrade

**Attack**:

```bash
websocat -H 'Cookie: alice_session=clearly-not-real' \
  ws://alice.victim.com:47331/api/workspaces/pty?session=abc
```

**Secure behavior**: `401`. Forged SID returns null from
`session-store.validateAndTouch()`.

**Current**: `401`. ✅ Mitigated.

---

### 7.3 — Localhost passthrough

**Attack**: from true loopback, without cookie:

```bash
websocat 'ws://127.0.0.1:47331/api/workspaces/pty?session=abc'
```

**Secure behavior**: `101 Switching Protocols` (then 4404 close if `abc`
isn't a real workspace session ID). This is the dev-UX passthrough by design.

**Current**: behaves as designed. ✅ By design.

---

### 7.4 — XFF spoof on upgrade

**Attack**: same as 7.1 but with `X-Forwarded-For: 127.0.0.1`. Should be
ignored — upgrade handler reads `req.socket.remoteAddress`, not parsed
headers.

**Secure behavior**: `401`.

**Current**: `401`. ✅ Mitigated by reusing `isLoopbackIp(remote)` against
the raw socket address.

---

### 7.5 — Trusted-proxy mode + localhost from loopback socket

**Attack**: Alice configured with `OPENALICE_TRUSTED_PROXIES=10.0.0.5`,
but the trusted proxy IS at 127.0.0.1 from Alice's view. If the upgrade
handler still trusted loopback, the proxy would let every public request
in.

**Secure behavior**: localhost passthrough disabled entirely when
`OPENALICE_TRUSTED_PROXIES` is non-empty.

**Current**: handler short-circuits the loopback check when
`trustedProxies.length > 0`. ✅ Mitigated.

## Extension hints

- **Session ID enumeration**: the `?session=` query param is currently
  6-character workspace SIDs. Unauth attackers can't reach the upgrade
  path now, but an authenticated curious user could enumerate. Sessions
  should be ≥128-bit entropy if we plan multi-user later.
- **Origin header on upgrade**: handler rejects cross-origin browsers
  before auth (`isWsOriginAllowed`, unit-specced in
  `src/webui/workspaces-ws.spec.ts`). Same-origin — Origin host equal
  to the Host header — is always allowed (2026-06-11; previously a
  static localhost-only allowlist, which broke documented LAN/Tailscale
  self-hosting). A browser's Origin is not forgeable from a foreign
  page, so same-origin acceptance admits exactly the pages Alice served
  itself; the `WEB_TERMINAL_ALLOWED_ORIGINS` allowlist covers
  cross-origin topologies.
- **Slowloris on upgrade**: holding an upgrade handshake open without
  finishing — Node default timeouts should kill, but verify.

## Code paths to read

- `src/webui/workspaces-ws.ts` — `attachWorkspacesWS`, `onUpgrade`,
  `isUpgradeAuthorized`
- `src/webui/middleware/auth.ts` — shared `isLoopbackIp` + cookie name
- `src/services/auth/session-store.ts` — `validateAndTouch`

## References

- OWASP ASVS V13.2.4 — "WebSocket endpoints require the same level of
  authentication as their HTTP equivalents"
- [`safe/playbooks/01-auth-bypass.md`](./01-auth-bypass.md) — related
- [`safe/playbooks/03-localhost-spoofing.md`](./03-localhost-spoofing.md) — related
