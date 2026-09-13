# Playbook 02: Cross-Site Request Forgery

**Threat**: A malicious site induces the victim's browser to issue
authenticated requests to OpenAlice while the victim has an active session.
**Severity**: High
**Tier applies**: T2 ☑ / T3 ☑ (T1 localhost rarely targeted)
**Status (2026-05-23)**: ✅ Mitigated in commit `754cef7` — Origin allowlist
+ `SameSite=Lax` + `HttpOnly` cookie. Cross-origin POST/PUT/DELETE/PATCH with
a foreign Origin returns 403 via `auth.spec.ts > "02.1: cross-origin POST with bad Origin → 403"`.

## What this class is

The victim is logged into OpenAlice (has a valid session cookie). They visit
an attacker-controlled site (`evil.example.com`). The attacker's JavaScript
or HTML form issues a request to `https://alice.victim.com/api/...`. The
browser **automatically attaches the session cookie** (because that's how
cookies work). The request runs with the victim's privileges.

Without CSRF defense:

- `<form action="https://alice.victim.com/api/trading/uta/alpaca-paper/wallet/push" method="post">` would execute pending trades
- Hidden `<img src="https://alice.victim.com/api/..."/>` triggers GET requests
- `fetch('https://alice.victim.com/api/...', {credentials: 'include'})` from
  any origin can do POST/PUT/DELETE if CORS allows

The defenses against CSRF:

1. **`SameSite=Lax` cookie** — most modern browsers block third-party form
   POSTs by default. Catches 80% of real-world CSRF.
2. **Origin header validation** — server checks `Origin` header on
   state-changing requests. Reject if not in allowlist.
3. **CSRF token in form/header** — server emits an unguessable token, client
   echoes it back. Most thorough but most invasive to UI.

The plan for OpenAlice v1: **SameSite=Lax + Origin header check**. Token
approach is overkill given the threat model.

## Pre-conditions

- Victim has a valid session cookie (post-auth-impl)
- Attacker has a website the victim visits while logged in
- Attacker knows OpenAlice endpoints (open-source, trivially)
- Attacker knows the victim's OpenAlice URL (less trivial but discoverable
  via social engineering)

## Seed cases

### 2.1 — Simple HTML form POST (classic CSRF)

**Attack**: attacker hosts:
```html
<!DOCTYPE html>
<html>
<body>
  <h1>Click here for a free t-shirt</h1>
  <form id="evil" action="http://localhost:47331/api/trading/uta/alpaca-paper/wallet/push" method="POST">
    <input type="hidden" name="dummy" value="1">
  </form>
  <script>document.getElementById('evil').submit()</script>
</body>
</html>
```

Victim with a valid Alice session clicks the link.

**Secure behavior**:
- `SameSite=Lax` cookie → browser DROPS the cookie on cross-site POST → server sees no cookie → 401
- Origin header check → POST has `Origin: http://evil.example.com` → server rejects → 403

**Current behavior**: no defenses, request lands → push executes → real
broker order placed. **Critical**.

To reproduce locally:
```bash
# Set up the attack page
mkdir -p safe/tools/browser
cat > safe/tools/browser/csrf-poc.html <<EOF
<!DOCTYPE html>
<html><body>
<form id=e action="http://localhost:47331/api/trading/uta/mock-paper/wallet/push" method=POST>
  <input type=hidden name=x value=1>
</form>
<script>document.getElementById('e').submit()</script>
</body></html>
EOF

# Serve it on a different origin
cd safe/tools/browser && python3 -m http.server 9999

# In browser, navigate to http://localhost:9999/csrf-poc.html
# (different origin from Alice's localhost:47331)
# Observe what happens
```

⚠️ Use a Mock UTA for testing. Don't aim at real broker UTAs.

---

### 2.2 — JSON fetch from cross-origin

**Attack**: attacker's JS:
```js
fetch('http://localhost:47331/api/trading/config/uta/alpaca-paper', {
  method: 'DELETE',
  credentials: 'include',
})
```

**Secure behavior**:
- Modern browsers send `Origin: http://evil.example.com` automatically on
  cross-origin fetch
- Server rejects based on Origin
- Even if Origin check missing, CORS preflight should block (OPTIONS
  rejected → fetch fails)

**Current**: Hono CORS defaults are permissive. Request likely succeeds.
**Critical**.

---

### 2.3 — Image-tag GET request

**Attack**:
```html
<img src="http://localhost:47331/api/trading/uta/alpaca-paper/wallet/reject?reason=lol">
```

**Secure behavior**: GET requests should NOT have side effects (state-
changing). If they do, this is exploitable.

OpenAlice's API design: state-changing endpoints are POST/PUT/DELETE
only. GET should be safe.

**Audit**: grep `app.get` for any handler that mutates state. Findings go
in the per-route audit.

```bash
# Quick audit
grep -rn "app\.get" src/webui/routes/ services/uta/src/http/
```

---

### 2.4 — `<form>` POST with custom Content-Type

**Attack**: HTML forms can only send `application/x-www-form-urlencoded`,
`multipart/form-data`, or `text/plain`. They cannot natively send
`application/json`.

A server that ONLY accepts `application/json` for state-changing endpoints
implicitly defeats simple HTML form CSRF. (Browser would have to use
`fetch()` which triggers CORS preflight.)

```bash
# Test: does the endpoint accept x-www-form-urlencoded?
curl -i -X POST http://localhost:47331/api/trading/uta/alpaca-paper/wallet/push \
  -H "content-type: application/x-www-form-urlencoded" \
  -d "dummy=1"
```

**Secure behavior**: server SHOULD reject non-JSON content type with 415
or 400. Hono with `c.req.json()` will throw on non-JSON body → caller gets
an error.

**Current**: probably returns 400 (json parse fail), not 401. Functionally
blocks simple form CSRF but isn't the intended defense.

---

### 2.5 — Cross-tab cookie reuse on subdomain

**Attack**: if Alice is at `alice.victim.com` and another service the victim
runs is at `other.victim.com`, the cookie's `Domain` setting matters.

- `Domain=.victim.com` → cookie sent to all subdomains
- `Domain=alice.victim.com` (default if not set, or set explicit) → only
  exact match

If `.victim.com` is set and `other.victim.com` is compromised, XSS there can
issue requests to alice with the cookie.

**Secure behavior**: don't set `Domain`. Let browser default to host-only.

---

### 2.6 — `OPTIONS` preflight bypass with simple request rules

**Attack**: CORS spec lets "simple requests" through without preflight:

- GET, HEAD, POST methods
- Only "CORS-safelisted" Content-Type values
- No custom headers

A clever attacker crafts a POST that meets "simple request" criteria — no
preflight → no chance to reject → request fires.

The defense: even for simple requests, the server still must check `Origin`
header before processing.

**Secure behavior**: Origin check is **inside the handler**, not just in
CORS middleware. Even simple requests get rejected based on Origin.

---

## Extension hints

- **JSON content-type with simple format**: try `application/json; charset=UTF-8` (allowed) vs `application/json` (allowed) — does parsing care?
- **PUT and DELETE with simple body**: do these go through CORS preflight, or does some library skip?
- **WebSocket CSRF**: WS upgrade carries cookies — does the upgrade handshake check Origin?
- **Server-Sent Events (SSE)**: same as WS — Origin check on the GET initial request?
- **Window.opener / popup chains**: more advanced, less likely
- **Subresource integrity bypass**: if Alice serves dynamic content via
  CDN, can that be poisoned?

## Code paths to read

- `src/webui/plugin.ts` — CORS middleware setup (Hono)
- (When implemented) `src/webui/middleware/csrf.ts` — Origin check
- Search for `c.req.json()` to find what currently rejects non-JSON
- Search for `cors(` in plugin.ts to find current CORS config

## Remediation notes

The CSRF defense should:

1. Set session cookie with `SameSite=Lax` (browser-side defense for
   ~80% of real-world cases)
2. Add Hono middleware that checks `Origin` header on POST/PUT/DELETE
   - Allow: same-origin (host matches)
   - Allow: explicit `OPENALICE_CSRF_TRUSTED_ORIGINS` env list
   - Reject: anything else
3. Use restrictive CORS (`Access-Control-Allow-Origin` returns only
   matching configured origins, not `*`)
4. Don't trust the `Referer` header (easily stripped); use `Origin`
5. Add specific test for WS upgrade Origin check

## References

- OWASP Top 10 — A01: Broken Access Control (CSRF historically here)
- MDN: SameSite cookies
- [`safe/playbooks/07-websocket-auth.md`](./07-websocket-auth.md) — related (TBD)
