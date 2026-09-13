# `safe/` — Red Team Toolkit (NOT a deployment guide)

This folder is OpenAlice's **internal penetration-test kit**. It contains:

- Attack playbooks (`playbooks/`) — categorized attack scenarios with seed cases
- Knowledge of the target (`knowledge/`) — endpoints, architecture, config touchpoints
- Reusable attack tools (`tools/`) — curl templates, browser POCs, WS attackers
- A verification harness (`harness/`) — runs playbook cases, reports pass/fail
- Past findings (`findings/`) — discovered weaknesses + their fix history

The folder is **agent-first by design**. The primary "operator" is an AI red-team
agent reading [`AGENT_BRIEF.md`](./AGENT_BRIEF.md), not a human running shell
scripts. Humans can absolutely use it (everything is markdown + curl), but the
playbook structure assumes an exploratory AI will extend each class of attack
beyond the seeded cases.

## Why this exists

Modern security testing inverts the normal engineering flow: instead of
"build defenses then write tests," you **enumerate attacks first** and treat
the defense build as a TDD exercise to close them off.

A 2026-era OpenAlice instance will be attacked by AI agents, not just by
script-kiddie scanners. So we build our defense against the same kind of
adversary — an AI agent with code access, creative instincts, and willingness
to chain weaknesses.

If our own red-team agent can't break in, we have at least the floor of
security a real attacker would face.

## Workflow

1. **Operator (you)** starts a dev OpenAlice instance: `pnpm dev`
2. **Operator** spawns a fresh Claude (or any capable AI agent) and says:
   > "Read `safe/AGENT_BRIEF.md` and red-team this instance"
3. **Red-team agent** reads brief → explores knowledge → runs playbooks →
   files findings → reports
4. **Operator** reviews findings, opens fix tasks, re-runs once fixes ship
5. **Repeat** after every meaningful change to auth/networking surface

## Status

- 🟥 **Auth not yet implemented.** Today's baseline finding (see
  [`findings/2026-05-23-pre-implementation.md`](./findings/2026-05-23-pre-implementation.md))
  is that **every** playbook case passes — i.e. every attack succeeds. The
  point of this kit is to drive that to 🟩 **all attacks blocked**.

## What this is NOT

- ❌ **Not a deployment guide.** Don't read this to learn how to host OpenAlice.
  See the root `README.md`.
- ❌ **Not a compliance audit.** No SOC2 / PCI / GDPR checklist here. Specific
  to OpenAlice's threat model.
- ❌ **Not a fuzzer.** We don't try random bytes; we try targeted scenarios.
- ❌ **Not exhaustive.** Real adversaries find things we haven't imagined. This
  is a floor, not a ceiling.

## Layout

```
safe/
  README.md                  ← you are here
  AGENT_BRIEF.md             ← red-team agent's entry point
  THREAT_MODEL.md            ← who we defend against, what they want
  scope.md                   ← what's in / out of bounds for testing
  
  knowledge/                 ← target intelligence
    architecture.md
    endpoints.md
    config-files.md
    data-flows.md            ← (TBD post-auth-impl)
  
  playbooks/                 ← attack classes (start here as agent)
    01-auth-bypass.md
    02-csrf-cross-origin.md
    03-localhost-spoofing.md
    04-public-misconfig.md           (TBD)
    05-credential-leakage.md          (TBD)
    06-session-lifecycle.md           (TBD)
    07-websocket-auth.md              (TBD)
    08-uta-direct-bypass.md           (TBD)
    09-credential-storage.md          (TBD)
    10-network-exposure.md            (TBD)
    11-xss-and-headers.md             (TBD)
    12-brute-force-rate-limit.md      (TBD)
  
  tools/                     ← attack building blocks
    README.md
  
  harness/                   ← verification + reporting
    runner.ts                ← minimal scaffolded runner
  
  findings/                  ← discovered weaknesses (snapshots in time)
    README.md
    2026-05-23-pre-implementation.md
```

## Adding a finding

When you (or an agent) find a real weakness:

1. Create `findings/YYYY-MM-DD-<short-title>.md`
2. Use the template in [`findings/README.md`](./findings/README.md)
3. Cross-link the relevant playbook and code paths
4. Set severity honestly — critical means "broker funds at risk"

## License + secrecy

This folder is checked in. It's public. That's by design — the attack surface
is the attacker's already-known territory, not a secret. We just document it
clearly. Defense in depth, not security through obscurity.

Real exploitation tools that would harm running instances should NOT live here
(use private channels). What lives here is the **playbook framework** + curl
snippets that document the issue.
