---
name: tool-audit
description: >
  Audit OpenAlice's AI tools end-to-end — call each one (using its declared
  example input as the starting point), judge whether it runs, whether its
  description / params / output are good, and write a review with concrete
  "how to change it" notes. Use when the developer wants to dogfood the tool
  surface, find tools that are broken / thin / confusing, or get an
  optimization to-do list: "audit the tools", "which tools are broken",
  "review all the MCP tools", "test the tool surface", "go use every tool and
  tell me what to fix". A half-automatic regression + tool-optimization input.
---

# Tool audit

You are auditing OpenAlice's AI tool surface from the **developer** side — not
inside a workspace. The tools reach you over the `openalice` MCP server (wired
by the repo-root `.mcp.json`). This is dogfooding: actually use each tool, then
say what's wrong and how to fix it.

## 0. Preconditions — check first, don't skip

1. **The backend must be running.** The MCP server is the live dev backend on
   `:47332`. If the `openalice` tools are NOT in your available toolset, stop
   and tell the developer to start it:
   ```
   pnpm dev      # Guardian spawns UTA + Alice (MCP on 47332) + Vite
   ```
   then reconnect the MCP server (`/mcp` in Claude Code) or restart the session.
2. **You have the source.** This is the repo — read `src/tool/*.ts` (and
   `src/core/workspace-tool-center.ts` for workspace-scoped tools) to get the
   authoritative, complete tool list and each tool's intent, instead of relying
   only on what the MCP toolset surfaces. Cross-check: a tool in the source but
   missing from your toolset is itself a finding.

## 1. Each tool's example IS your starting fixture

Every tool declares a runnable sample input via `.meta({ examples: [...] })` on
its `inputSchema` (see `[[feedback_tool_example_input]]`). It shows up as
`examples` in the tool's JSON schema. **Use `examples[0]` as the call input** —
don't invent parameters. If a tool has no example, that's a finding (note it),
and fall back to the minimal valid input you can infer from the schema.

## 2. Procedure — per tool

Go through **every** tool. For each:

1. Read its `description` and input schema (params + the declared `example`).
2. **Call it** with the example input — EXCEPT the safety list below.
3. Record a verdict on five axes:
   - **Runs?** — did it return a result, or error / hang / throw? Capture the
     exact error.
   - **Description** — does it tell the model clearly what the tool does, when
     to use it, and what it returns? Misleading or stale wording is a bug
     (e.g. a default that doesn't match behavior).
   - **Params** — are they coherent? Any dead params (declared but ignored),
     missing required ones, confusing names, or shapes the model will fumble?
   - **Output** — is the returned JSON useful and legible to a model, or thin /
     dumping raw vendor fields / empty when it shouldn't be?
   - **Example** — is the declared example representative and runnable?

## 3. Safety — do NOT execute broker mutations

These **stage or place real broker operations**. Do NOT call them — audit them
statically (read schema + description + the staging flow in `src/tool/trading.ts`)
and review the example without invoking:

> `placeOrder`, `modifyOrder`, `closePosition`, `cancelOrder`,
> `tradingCommit`, `tradingPush`, `tradingSync`

Safe to actually run: all read-only tools, `simulatePriceChange` (dry-run,
read-only), and `entity_upsert` / `entity_search` (local entity store, no money
or broker involved — `entity_upsert` writes local state, which is fine).

When a read-only tool errors because no broker account is configured / market
is closed / a vendor key is missing, that's an **environment** result, not a
tool bug — say so and don't count it against the tool. The bug bar is: does the
tool itself misbehave given a reasonable input?

## 4. Output — a review file

Write the review to `tool-audit-report.md` at the repo root (it's a throwaway
artifact — don't commit it). Structure:

- A one-line **summary**: N tools, X ran clean, Y errored, Z have description/
  param/output issues.
- A **table** — one row per tool: `tool | ran? | issues | how to change it`.
  Keep "how to change it" concrete and actionable (the point is a fix list,
  not vibes): e.g. "ratios: `period`/`limit` were dead until ttm:'include' —
  good now; output still dumps raw FMP fields under non-aliased names."
- A short **"top fixes"** list — the handful worth doing first.

Be a skeptic, not a cheerleader: the value is in the problems found. If a tool
is genuinely fine, one word ("clean") is enough — spend the words on what's broken.
