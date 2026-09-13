# Finding: Pre-Implementation Baseline — No Authentication Layer Exists

**Date**: 2026-05-23
**Reporter**: red-team scaffold author (during `safe/` kit construction)
**Severity**: Critical (when deployed at T2/T3 tier — see scope)
**Status**: Mitigated in commit `754cef7` (2026-05-23) — see "Mitigation"
section at the bottom. This finding is preserved as the pre-implementation
baseline; specific case re-runs live in the per-playbook "Verification status"
tables.
**Related playbook**: all of `playbooks/*` — every seed case currently passes

## Summary

OpenAlice as of 2026-05-23 ships with **zero authentication at the Alice
process boundary**. Any HTTP request that reaches Alice's bound interface
is processed as if it came from the legitimate user. There is no:

- Admin token bootstrap
- Session middleware
- Cookie verification
- Origin / CORS protection on mutations
- Localhost-trust gate (because there's nothing yet to gate)
- Rate limiting on auth-shaped endpoints
- Public-mode safety net (i.e., binding 0.0.0.0 doesn't refuse to start)

This is a deliberate baseline. The implementation is queued; this finding
captures the state pre-implementation so we can verify after-impl that
each gap is closed.

## Reproduction

```bash
# Start the dev stack
pnpm dev    # Guardian → UTA → Alice → Vite

# In another terminal, no cookie, no token:
curl -s http://localhost:47331/api/trading/uta | jq

# Result: full UTA list returned, no 401, no challenge
```

Attempting any mutation likewise:

```bash
curl -i -X POST http://localhost:47331/api/trading/uta/mock-paper/wallet/stage-place-order \
  -H "content-type: application/json" \
  -d '{"aliceId":"mock-paper|FAKE","action":"BUY","orderType":"MKT","totalQuantity":"1"}'

# Result: 200, order staged. From any origin, with any cookies, with no token.
```

**Expected (secure)**: every authenticated route returns 401 to unauthenticated callers.
**Observed**: 200 everywhere.

## Why it matters

In its current state, **T2 (LAN-exposed) and T3 (public-exposed)
deployments are not safe**. Anyone who can route a TCP packet to Alice's
bound port has full administrative control:

- List all configured broker UTAs (including paper/live distinction)
- Read trading history, positions, equity curves
- Place real orders via `wallet/push` (broker side effect; real funds at
  risk on live UTAs)
- Modify broker configuration including API keys (via PUT `/api/trading/config/uta/:id`)
- Modify AI provider config (potential to redirect LLM calls / drain user
  API quota)
- Spawn new workspaces (file-system write + PTY)

T1 (pure localhost) is safe **only** because no external party can reach
the bound port. But port-scanning bots and same-host malware would compromise this trivially.

## Suggested remediation

The auth implementation queued for upcoming work should deliver:

1. **L1 Transport gate**: Refuse to start with non-localhost bind + no auth
   config (`OPENALICE_BIND_HOST=0.0.0.0` requires `data/config/auth.json`)
2. **L2 Authentication**:
   - First-run admin token generation (256-bit random, written to
     `data/config/auth.json` as argon2 hash + printed to stdout once)
   - `POST /api/auth/login` accepts token, sets `alice_session` cookie
   - `POST /api/auth/logout` invalidates session
   - Hono middleware enforces session on all routes except a small
     public allowlist
3. **Cookie hardening**: `HttpOnly; Secure (when HTTPS); SameSite=Lax;
   Max-Age=604800`
4. **CSRF**: Origin header check on POST/PUT/DELETE (allowlist-based)
5. **Localhost trust passthrough**: only true loopback IPs bypass; trusted-
   proxy header parsing with explicit env config
6. **Session storage**: `data/config/sessions.json` with `600` permissions
7. **Token rotation**: Settings UI + CLI command (`pnpm alice auth rotate`)
   to regenerate token + invalidate all sessions

## Verification (post-implementation)

Each playbook (`safe/playbooks/01-*` through `12-*`) has seed cases that
should be re-run after implementation. The expected result for every
"current behavior" line that says `200` should flip to `401` (or `403`
where appropriate).

Specifically, the canary smoke test is:

```bash
# Fresh, no cookie
curl -i http://localhost:47331/api/trading/uta

# Should return 401 (or 302 → /login)
# Anything else = remediation incomplete
```

## Code references

Routes currently unprotected:

- `src/webui/plugin.ts` — root Hono app mount point; no auth middleware
  attached before `app.route(...)` calls
- All files under `src/webui/routes/` and `services/uta/src/http/`

Files to create / modify:

- `src/webui/middleware/auth.ts` — session check middleware
- `src/services/auth/token-store.ts` — auth.json read/write + argon2
- `src/services/auth/session-store.ts` — sessions.json + cookie issuance
- `src/webui/routes/auth.ts` — `/api/auth/login` + `/api/auth/logout`
- `src/webui/plugin.ts` — wire it all up with correct mount order

## Mitigation (added 2026-05-23 — commit `754cef7`)

The auth implementation queued above shipped within the same day. Concretely:

- `src/services/auth/token-store.ts` — admin token bootstrap, scrypt hash
  (N=16384, r=8, p=1), plaintext shown once on first run, `auth.json` written
  with `0o600`.
- `src/services/auth/session-store.ts` — `data/config/sessions.json`, 32-byte
  base64url SIDs, 7-day sliding TTL, atomic tmp+rename writes, 30s touch throttle.
- `src/webui/middleware/auth.ts` — Hono middleware; public-path allowlist;
  Origin allowlist for mutations; localhost passthrough gated on
  `OPENALICE_TRUSTED_PROXIES` config.
- `src/webui/routes/auth.ts` — `POST /api/auth/login`, `POST /api/auth/logout`,
  `GET /api/auth/status`. Cookies: `HttpOnly; SameSite=Lax;
  Secure (when HTTPS); Max-Age=604800`.
- `src/webui/plugin.ts` — bootstrap call early, public-mode safety net
  (non-loopback bind + no token + no `OPENALICE_DISABLE_AUTH=1` → refuse to start).
- `src/webui/workspaces-ws.ts` — WebSocket upgrade handler re-applies the
  same auth gate (HTTP middleware doesn't run for upgrades). Localhost
  passthrough + cookie check.

Test coverage: 43 new test cases across token-store / session-store /
middleware specs, all passing (1783/1783 total).

Open follow-ups (tracked in per-playbook status tables, not as new findings):

- UI login flow — React app still assumes always-authed; needs 401 handler
  + login modal before public deployment is operator-usable.
- Token rotation Settings UI — operator-friendly rotation (today: `rm
  data/config/auth.json && restart`).
- Playbooks 04-12 (public-misconfig, credential-leakage, ws-auth detail,
  uta-direct-bypass, network-exposure, xss-headers, rate-limit-brute) —
  drafted out as files, seed cases still to fill.

## Notes

This finding is intentionally filed before the implementation starts so
that the auth implementation work can be **validated against it**. The
implementation is "done" when:

- All playbook seed cases that previously returned 200 now return 401 or 403
- The harness runner (`safe/harness/runner.ts`) reports `pass` for all
  cases under L1+L2 scope
- No new finding can be filed via the playbook process (modulo edge cases
  the red-team agent discovers via extension hints — those are separate
  findings, not this baseline)
