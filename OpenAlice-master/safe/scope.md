# Test Scope

What the red-team agent (or human pentester) **may** and **may not** do.

## Test target

- The OpenAlice dev instance running on the operator's local machine
- Started via `pnpm dev` (Guardian + UTA + Alice + Vite)
- Bound to localhost by default; operator may rebind to `0.0.0.0` if testing
  public-mode scenarios

**Never** test against a non-dev instance unless the operator explicitly
points the agent at one. "Production" doesn't really exist for OpenAlice
(it's self-hosted) — but if the operator has a personal cloud instance,
don't touch it without confirmation.

## Allowed actions

| Action | Allowed? | Notes |
|---|---|---|
| `curl` against `localhost:47331` / `localhost:47333` | ✅ | Primary attack vector |
| Reading source files in this repo | ✅ | Static analysis is fair game |
| Writing scripts in `safe/tools/` | ✅ | Adds to the kit |
| Filing findings in `safe/findings/` | ✅ | Expected output |
| Modifying source code outside `safe/` | ❌ | Use findings to recommend fixes; don't fix |
| Running `pnpm dev` / restarting services | ⚠️ | OK if operator left state restorable. Don't kill if active broker connections in-flight |
| Writing/modifying `data/config/*.json` to simulate weakened state | ⚠️ | Backup first, restore after |
| Brute-forcing auth endpoints at scale | ❌ | Single test of "is rate-limit there" is fine; not a real brute force |
| Submitting orders to real broker accounts | ❌ | Mock / simulator only |
| Inducing crash of host OS / kernel panic | ❌ | Out of scope |
| Network-level attacks (ARP, DNS, etc.) | ❌ | Out of scope |
| Modifying `safe/` itself | ✅ | Extending playbooks / adding finds is the whole point |

## Account types — what's safe to play with

OpenAlice's `data/config/accounts.json` controls which brokers are loaded.
The operator should keep at least one **MockBroker** UTA configured for
testing. Hands-off real ones.

Decision rule:

| Broker type | Hands-on? | Why |
|---|---|---|
| `mock` (MockBroker) | ✅ Yes | In-memory simulator, no real-world side effects |
| `alpaca-paper` | ⚠️ With caution | Paper account = no real funds, but rate limits / API key are real |
| `bybit-demo` / `okx-test` | ⚠️ With caution | Same as alpaca-paper |
| `alpaca-live` / `bybit-main` / any **live** | ❌ Hard no | Real funds. Never touch from within `safe/` |
| `ibkr-paper` | ⚠️ With caution | TWS sessions are stateful; can disrupt operator |

If you're not sure whether an account is live, check `data/config/accounts.json`
— look for `mode: "live"` vs `mode: "paper"`/`mode: "demo"` in `presetConfig`.

## Destructive vs non-destructive tests

- **Non-destructive** (default): observe responses, file findings. Don't
  change state. Read-only requests, dry-run probes.
- **Destructive** (require operator confirmation): rotating the admin
  token, deleting `data/config/sessions.json`, modifying `accounts.json`.
  These change state the operator may care about. Always:
  1. Back up the file before modifying
  2. Note in the finding what was changed
  3. Restore at end of session

## Reset / cleanup checklist

After a red-team session:

- [ ] All `data/config/*.json` files restored to pre-session state (if modified)
- [ ] No leftover test sessions in `data/config/sessions.json` (when it exists)
- [ ] No orphaned `data/control/restart-uta.flag` if one was touched
- [ ] No stale processes (UTA / Alice still bound correctly)
- [ ] Findings filed under `safe/findings/`
- [ ] Playbook status (✅ / ⬜ / ❌) updated in each `playbooks/NN-*.md`

## Escalation

If an agent discovers something **critical** (broker funds at risk, secrets
plainly exfiltrate-able, full RCE on the host) during a session, it should:

1. Stop probing further — the finding alone is enough
2. File the finding with severity `Critical`
3. Note in the final summary that the operator should review before any
   public push

Critical findings should land before any push to `master` or any tagged
release.
