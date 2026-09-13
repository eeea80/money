# Attack Tools

Reusable building blocks for playbook cases. Most attacks are one-line
curls embedded in the playbook itself; this folder holds reusable
scaffolding for the ones that aren't.

## Categories

```
tools/
  curl/       single-purpose curl scripts (most attacks fit here)
  browser/    HTML / JS POCs that need a real browser context
                (CSRF, clickjacking, XSS)
  ws/         WebSocket attack helpers (needs JS runtime)
  fuzzing/    parameter fuzzers (TBD; not built yet)
```

## Adding a tool

1. Pick a category dir (or create a new one with a README explaining
   what's distinct about it)
2. Add the script with a short header comment:
   ```
   # csrf-poc.html
   # POC for playbook 02.1 — cross-origin form POST
   # Usage: serve on a different origin, navigate browser to it
   ```
3. Reference it from the playbook case that needs it
4. If it's destructive in any way, document the reset/cleanup steps in
   the same file

## Naming convention

`<playbook-case-id>-<short-name>.<ext>`

Examples:
- `curl/01.1-no-cookie-list-utas.sh`
- `browser/02.1-csrf-form-post.html`
- `ws/07.3-upgrade-no-cookie.mjs`

This lets you `grep` for a playbook case ID and find both the docs and
the tools quickly.

## Current state

Empty. Tools will be added as playbook cases land. The first real attack
script is likely `curl/01.1-no-cookie-list-utas.sh` once we want to wire
the harness to it.

For now, the playbook seed cases include their curl commands inline.
