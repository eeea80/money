# Threat Model

What we defend against, what we don't, and why.

## Who we defend against

### 1. Internet scanner bots
**Capability**: scan public IPs for known service ports, attempt default
credentials, exploit known CVEs.

**Coverage**: high. Bind defaults are localhost-only; public mode refuses to
start without auth; admin token is randomly generated, not a default.

### 2. Targeted attacker with code knowledge
**Capability**: knows OpenAlice is open-source, has read this repo. Knows
endpoint paths, auth mechanism, file layouts. Could craft specific
exploits against known weaknesses.

**Coverage**: this is the **primary adversary** the security work targets.
We assume the attacker has full source-code access (because it's open).
Defense must be robust against a code-aware adversary, not security
through obscurity.

### 3. Network-positioned attacker (HTTPS-misconfigured)
**Capability**: man-in-the-middle on the wire if TLS is misconfigured;
session cookie sniffing; replay attacks.

**Coverage**: medium. OpenAlice mandates that public deployment is behind
a TLS-terminating reverse proxy (Caddy, nginx, Cloudflare Tunnel). We
trust `X-Forwarded-Proto` only when an explicit trusted-proxy IP is
configured. Cookies are `Secure` + `HttpOnly` + `SameSite=Lax`.

### 4. Compromised client-side device (XSS / browser supply chain)
**Capability**: malicious JavaScript in the browser context; can read DOM
but not HttpOnly cookies; can issue requests with the user's cookie.

**Coverage**: medium. Cookies are HttpOnly so XSS can't directly steal
them. Browser can still issue authenticated requests from within the
session. We rely on CSP, careful sanitization of agent-rendered content,
and CSRF defense to limit the blast radius.

### 5. AI red-team agents (our own primary adversary)
**Capability**: programmatic exploration, code reading, scenario chaining,
creative variant generation. Faster and more thorough than human
red-teamers.

**Coverage**: this is **the standard we test against**. If our own
purpose-built AI agent (with full source access) can't compromise the
running instance, the security floor is reasonable. See `AGENT_BRIEF.md`
for the agent's mandate.

## Who we do NOT defend against

### Root on the host
If an attacker has root or shell access on the host machine, they can read
`data/config/auth.json`, kill processes, modify code. Game over by
definition. Mitigation is host security, not application security.

### Compromised operator (insider)
If the legitimate operator deliberately exfiltrates the admin token,
distributes it, or runs the agent in a hostile manner — out of scope.

### Quantum attack on cryptographic primitives
We assume modern primitives (argon2id, ed25519, AES-GCM) hold. If they
break, the broader internet has bigger problems.

### Side-channel attacks on hardware
Timing attacks on argon2 verification, cache attacks across VM
boundaries, electromagnetic emissions — out of scope for an
application-layer tool.

### Supply-chain compromise
If a malicious npm package lands in our dependencies, it's a different
class of issue requiring different mitigations (lockfile audits, signing,
SBOM tracking). Separate workstream.

### Social engineering
Convincing the operator to "click this link" or "paste this command" —
out of scope for code-level defense.

### Denial of service
We don't attempt to keep the service running under load. The operator's
ops layer (reverse proxy, fail2ban, rate limiter) is responsible for
availability. Application-level rate limiting on auth endpoints is
in-scope, but full DDoS resistance is not.

### Multi-tenant isolation
OpenAlice is single-user by design. There is one "admin." We do not
defend "user A from user B" because there is no user B at the application
level. If multi-tenant arrives, this section will be rewritten.

## Threat-actor goals (what an attacker would want)

In rough priority order:

1. **Direct broker access** → execute trades, withdraw funds (highest harm)
2. **Read trading history / positions** → competitive intel, privacy harm
3. **Modify trading config** → silently change agent behavior, plant
   backdoors via custom brokers/guards
4. **Steal AI provider credentials** → use the operator's OpenAI / Claude
   key for free LLM compute
5. **Persistent foothold** → write to workspace dirs, run agent CLI commands,
   eventually escalate to host root
6. **Read user code in workspaces** → exfiltrate the operator's projects
7. **Use Alice as a proxy** → for hiding origin of other attacks (low-value
   but possible)

The defense priority follows: broker isolation > config integrity > credential
storage > persistence prevention.

## Defense layers (planned)

The auth work scheduled for v1 implements:

- **L1 Origin / Transport** — bind / proxy / network restriction
- **L2 Authentication** — admin token + session cookie
- **L3 Authorization** — limits on what Alice can ask UTA (partial; full in v2)
- **L4 Carrier Isolation** — UTA on separate device (v2+)
- **L5 Pre-execution ceremony** — per-trade approval at carrier (v2+)

This kit tests L1+L2 today (since that's what's being built). When L3/L4/L5
come online, new playbooks will cover them.

## Versioning

This document evolves as the threat model changes. Each major auth/networking
change should bump a section here with a date.

| Date | Change |
|---|---|
| 2026-05-23 | Initial threat model — pre-auth-implementation |
