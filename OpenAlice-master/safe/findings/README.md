# Findings Log

Each red-team session that discovers a real weakness files one or more
finding documents here.

## Filename convention

`YYYY-MM-DD-<short-kebab-title>.md`

Examples:
- `2026-05-23-pre-implementation.md` — baseline ("everything is broken")
- `2026-06-15-xff-spoof-allows-localhost-bypass.md`
- `2026-07-20-session-tampering-via-cookie-injection.md`

If multiple findings come from one session, use a single file with multiple
findings inside, OR multiple files with same date and topic suffixes:
- `2026-05-30-csrf-on-trading-config.md`
- `2026-05-30-csrf-on-workspace-create.md`

## Finding template

```markdown
# Finding: <short title>

**Date**: YYYY-MM-DD
**Reporter**: <agent name or human handle>
**Severity**: Critical / High / Medium / Low / Informational
**Status**: Open / Mitigated / Fixed in <commit> / Won't fix (with rationale)
**Related playbook**: `playbooks/NN-xxx.md`

## Summary

One paragraph: what's the weakness, what's the impact?

## Reproduction

Exact steps from a clean state. Should be copy-pasteable.

```bash
# Setup
git checkout dev
pnpm dev   # in another terminal

# Attack
curl ...
```

**Expected (secure)**: ...
**Observed**: ...

## Why it matters

What an attacker gains by exploiting this. Be concrete:
- Can read positions list of all UTAs
- Can place orders on broker without authentication
- Can rotate session cookies of other users
- etc.

## Suggested remediation

Brief outline (not the full implementation):

- Add middleware X that checks Y
- Move route ABC from public allowlist
- Update config file permissions to 600
- etc.

## Code references

- `src/path/to/file.ts:NN-MM` — relevant code
- `src/path/to/config.ts:NN` — where the misconfig lives

## Notes / open questions

Anything the implementer should know that didn't fit above.
```

## Severity guidelines

| Severity | Criteria | Examples |
|---|---|---|
| **Critical** | Broker funds at risk; full RCE; credential exfiltration | Unauthenticated order placement; admin token leaks in stdout long-term |
| **High** | Significant data exposure; auth bypass; CSRF on state-changing routes | Read all UTAs without login; CSRF on `wallet/push` |
| **Medium** | Information leak; minor auth weakness | Endpoint enumeration via 404 vs 401; session timing oracle |
| **Low** | Hardening gap; defense-in-depth missing | Missing CSP header; cookies missing `Secure` flag in HTTPS contexts |
| **Informational** | Design observation, not yet exploitable | "Token file is world-readable; mitigated by host root threat-model exclusion" |

## Closing findings

When a finding is fixed:

1. Change `Status` to `Fixed in <commit-sha>` or `Mitigated in <commit-sha>`
2. Add a "Verification" section describing how to test the fix
3. Optionally move the file to `findings/closed/` if the kit grows large

Do NOT delete fixed findings — they're a record for future audits.
