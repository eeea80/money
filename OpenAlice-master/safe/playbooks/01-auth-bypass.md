# Playbook 01: Authentication Bypass

**Threat**: Unauthenticated access to authenticated endpoints.
**Severity**: Critical
**Tier applies**: T2 (LAN) ☑ / T3 (public) ☑ (T1 localhost is bypass-by-design)
**Status (2026-05-23)**: ✅ Mitigated in commit `754cef7` — admin token +
session cookie + Hono middleware shipped. Cases 1.1 / 1.2 / 1.3 covered by
`src/webui/middleware/auth.spec.ts`. WebSocket upgrade gate added in the
same series — see `src/webui/workspaces-ws.ts:isUpgradeAuthorized`. Manual
re-run of curl seed cases pending (see "Verification status" below).

## What this class is

The attacker has no admin token and no valid session. They want to invoke
endpoints that should require authentication. Bypass can come from:

- Auth middleware not wired up at all (today's state)
- Auth middleware wired but mis-ordered (mounted after the protected route)
- Specific routes accidentally whitelisted in the "public" allowlist
- Localhost-trust passthrough exploitable from non-localhost (see also
  `03-localhost-spoofing.md`)
- Cookie validation that accepts trivially forged cookies (e.g., signed
  with a known/empty key)
- Session lookup that returns stale sessions whose owner has rotated tokens

## Pre-conditions

- Alice instance running (`pnpm dev` or `docker run`)
- Attacker can reach Alice's bound IP (localhost for dev, public/LAN
  for prod)
- Attacker has NO admin token, NO session cookie

## Seed cases

### 1.1 — Plain GET to protected route, no cookie

**Attack**:
```bash
curl -i http://localhost:47331/api/trading/uta
```

**Secure behavior**: `401 Unauthorized` with body indicating auth required
(or 302 redirect to `/login`).

**Current behavior (2026-05-23, post-754cef7)**: from non-localhost socket,
`401 Unauthorized`. From true loopback (`127.0.0.1`/`::1`) — `200 OK`, by
design (T1 single-user passthrough). Verified by
`auth.spec.ts > "01.1: GET /api/trading/uta without cookie from non-localhost → 401"`.
✅ Mitigated.

**Severity**: Critical (lists configured broker IDs to anyone).

---

### 1.2 — Plain POST to mutation endpoint, no cookie

**Attack**:
```bash
curl -i -X POST http://localhost:47331/api/trading/uta/alpaca-paper/wallet/stage-place-order \
  -H "content-type: application/json" \
  -d '{"aliceId":"alpaca-paper|AAPL","action":"BUY","orderType":"MKT","totalQuantity":"1"}'
```

**Secure behavior**: `401`.

**Current (post-754cef7)**: `401` from non-localhost (cookie missing). On
localhost without cookie: still `200` (T1 passthrough). Verified by
`auth.spec.ts > "01.2: POST mutation without cookie from non-localhost → 401"`.
✅ Mitigated.

**Severity**: Critical — chain to push and you've placed a real order.

---

### 1.3 — Forged cookie

**Attack** (post-impl test):
```bash
curl -i http://localhost:47331/api/trading/uta \
  -H "Cookie: alice_session=this-is-not-a-real-session-id"
```

**Secure behavior**: `401`. Cookie lookup in `sessions.json` must
return nothing for unknown SIDs.

**Current (post-754cef7)**: `401`. Forged SID returns null from
`session-store.validateAndTouch()`; middleware default-denies. Verified by
`auth.spec.ts > "01.3: forged cookie → 401"` and
`auth.spec.ts > "empty cookie value treated as 'no session' → 401"`. ✅ Mitigated.

---

### 1.4 — Expired session

**Attack** (post-impl test):
- Login, get a session cookie
- Modify `data/config/sessions.json` to set `expiresAt` in the past for that SID
- Make a request

**Secure behavior**: `401`. Server must check expiry on every request.

**Current**: N/A (no session concept).

---

### 1.5 — Session from a previous instance

**Attack** (post-impl test):
- Login on a dev instance, save the cookie
- Restart the instance with a fresh `data/`
- Replay the old cookie

**Secure behavior**: `401`. Sessions die when the file is rotated.

**Current**: N/A.

---

### 1.6 — Bearer token in Authorization header

**Attack** (post-impl test):
```bash
# Try the admin token directly as bearer — should NOT work for normal requests
curl -i http://localhost:47331/api/trading/uta \
  -H "Authorization: Bearer <admin-token>"
```

**Secure behavior**: depends on intended design. Two reasonable choices:
(a) Reject — only session cookie counts; admin token is for `/api/auth/login` only.
(b) Accept — bearer token = same auth as cookie.

If (a) is chosen, ensure 401. If (b), ensure (1.3) still rejects invalid tokens.

**Current**: probably 200 since there's no check.

---

### 1.7 — Method-confused request

**Attack**:
```bash
# DELETE on a route that only expects GET — does the framework respond
# with 405 or fall through to a 200 with implicit GET?
curl -i -X DELETE http://localhost:47331/api/trading/uta
```

**Secure behavior**: `405 Method Not Allowed` or `401` (auth check should
run before method-routing).

**Current**: likely `404` (Hono's default). Useful to confirm middleware
order when auth lands.

---

### 1.8 — Path traversal on routes that take :id

**Attack**:
```bash
curl -i "http://localhost:47331/api/trading/uta/../config"
curl -i "http://localhost:47331/api/trading/uta/%2E%2E/config"
curl -i "http://localhost:47331/api/trading/uta/%2F../config"
```

**Secure behavior**: `404` or `400`. Hono should handle URL normalization.

**Current**: likely safe (Hono normalizes), but verify.

---

### 1.9 — Endpoint enumeration via 404 vs 401 distinction

**Attack** (post-impl):
- Hit `/api/trading/uta` (real route) → expect 401 if unauthenticated
- Hit `/api/trading/fake-route` (non-existent) → expect 404
- Difference reveals route existence to unauthenticated callers

**Secure behavior**: depends on threat model. Some sites unify all
unauth responses as 401. OpenAlice can do either — but the choice should
be intentional and documented.

**Current**: routes mostly return 200, fakes return 404 — clear distinction.

---

### 1.10 — Auth bypass via the BFF proxy

**Attack** (post-impl): does Alice's BFF proxy (`trading-proxy.ts`) check
auth before forwarding to UTA?

```bash
curl -i http://localhost:47331/api/trading/uta
```

vs

```bash
curl -i http://127.0.0.1:47333/api/trading/uta
```

The latter is UTA direct. UTA isn't reachable from outside the host, but
if an attacker has the same host, they can hit UTA directly without going
through Alice's auth.

**Secure behavior**: UTA shouldn't trust just "request is on localhost"
either, OR Alice should be the only thing allowed to talk to UTA via some
shared secret. (Today's design accepts this risk — same-host trust.
Re-examine if it changes.)

**Current**: UTA serves anyone who can reach 127.0.0.1:47333. Acceptable
under current threat model (host root = game over) but worth flagging
as a defense-in-depth gap.

---

### 1.11 — `OPTIONS` preflight bypass

**Attack**:
```bash
curl -i -X OPTIONS http://localhost:47331/api/trading/uta/alpaca-paper/wallet/push \
  -H "Origin: http://evil.example.com" \
  -H "Access-Control-Request-Method: POST"
```

**Secure behavior**: `403` or `405` for cross-origin OPTIONS to a
protected route. CORS should reject from non-allowed origins.

**Current**: Hono's default CORS may allow. Verify after auth impl.

---

## Verification status (per case, 2026-05-23 post-754cef7)

| # | Title                                  | Unit-verified | Curl re-run | Status |
|---|----------------------------------------|---------------|-------------|--------|
| 1.1  | Plain GET no cookie                 | ✅ (auth.spec.ts) | pending | Mitigated |
| 1.2  | Plain POST no cookie                | ✅                | pending | Mitigated |
| 1.3  | Forged cookie                        | ✅                | pending | Mitigated |
| 1.4  | Expired session                      | ✅ (session-store.spec.ts "prunes expired") | pending | Mitigated |
| 1.5  | Stale session across instance        | ⚠ partial — `revokeAllSessions()` exists, no UI yet | pending | Operator path only |
| 1.6  | Bearer token in Authorization        | ⚪ design choice (a) — bearer NOT accepted | pending | By design |
| 1.7  | Method-confused request              | ⚪ unchanged — Hono default | pending | Out of scope |
| 1.8  | Path traversal on :id                | ⚪ unchanged — Hono normalizes | pending | Out of scope |
| 1.9  | 404 vs 401 enumeration               | ⚪ informational | pending | Accepted |
| 1.10 | BFF proxy bypass via UTA direct      | ❌ STILL OPEN — UTA `127.0.0.1` accepts anyone same-host | n/a | Same-host trust by design; revisit when UTA moves off-host |
| 1.11 | OPTIONS preflight cross-origin       | ⚪ informational | pending | Out of scope |

## Extension hints (for the red-team agent)

If the seed cases all show "blocked" after auth ships, try chaining and
mutating:

- **Combine 1.1 + 03 (localhost-spoofing)**: Try a public request with
  `X-Forwarded-For: 127.0.0.1` to claim localhost privilege.
- **Combine 1.3 + 02 (CSRF)**: A victim's browser has a valid cookie;
  trigger requests cross-origin.
- **Empty cookie value**: `Cookie: alice_session=` — does the middleware
  treat empty string as "no session" or as "session ID is empty string"?
- **Malformed JSON in /api/auth/login**: does it return verbose errors
  exposing internal stack traces?
- **Race condition**: Login and logout in parallel — can a stale session
  survive?
- **Sub-path matching**: does the auth middleware match `/api/trading*`
  with a single rule, missing edge cases like `/api/trading2/...` (made-up
  example) or `/api/trading/`?

## Code paths to read (for code review)

- `src/webui/plugin.ts` — Hono app setup, route mount order
- `src/webui/routes/trading-proxy.ts` — BFF forwarding logic
- `services/uta/src/http/app.ts` — UTA-side route mounting
- (When implemented) `src/webui/middleware/auth.ts` — the gate itself
- (When implemented) `src/services/auth/` — session store, token validation

## Remediation notes

The auth implementation should:

1. Mount auth middleware **before** all `app.route(...)` calls except the
   explicit public allowlist (`/api/auth/login`, `/api/version`, etc.)
2. Validate cookie freshness against `sessions.json` on every request
3. Use constant-time comparison for cookie/token verification (prevents
   timing oracles)
4. Default-deny: unknown route + no session = 401 (or 404 by design choice)
5. Localhost-trust only for true loopback IPs, gated behind explicit
   "no trusted proxy configured" check (see playbook 03)

## References

- OWASP Top 10 (2021) — A01: Broken Access Control
- OWASP Top 10 (2021) — A07: Identification & Authentication Failures
- [`safe/playbooks/03-localhost-spoofing.md`](./03-localhost-spoofing.md) — related
- [`safe/playbooks/06-session-lifecycle.md`](./06-session-lifecycle.md) — related (TBD)
