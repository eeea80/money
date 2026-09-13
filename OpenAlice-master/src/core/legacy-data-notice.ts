/**
 * One-shot startup notice for checkouts that predate the global data root.
 *
 * Until mid-2026 the default user-data home was process.cwd(), so every
 * checkout grew its own `./data/`. The default is now ~/.openalice — shared
 * across dev checkouts, `pnpm start`, and the packaged app. When a legacy
 * store exists next to the running process but the global store is still
 * virgin, tell the user how to adopt it. NEVER auto-move: multiple
 * worktrees may each carry a `./data/`, and only the user knows which one
 * (if any) is canonical.
 *
 * Silent whenever OPENALICE_HOME is set explicitly (guardian children,
 * docker, deliberate checkout-local pins) — the operator already chose.
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { dataPath, defaultUserDataHome } from './paths.js'

export function legacyDataNoticeLines(opts?: { cwd?: string }): string[] {
  if (process.env['OPENALICE_HOME']) return []
  const cwd = opts?.cwd ?? process.cwd()
  const legacyConfig = resolve(cwd, 'data', 'config')
  // `data/config/` is the tripwire — `data/control/` alone is flag debris.
  if (!existsSync(legacyConfig)) return []
  if (existsSync(dataPath('config'))) return []
  return [
    `Found an existing data/ store in this checkout (${resolve(cwd, 'data')}).`,
    `OpenAlice now keeps user data in ${defaultUserDataHome}/data — shared across checkouts and the desktop app.`,
    `To adopt this checkout's data:  mv "${resolve(cwd, 'data')}" "${defaultUserDataHome}/data"`,
    `Continuing with a fresh store. (Pin the old behavior with OPENALICE_HOME="$PWD".)`,
  ]
}

/** Print the notice to stderr if applicable. Returns true when shown. */
export function printLegacyDataNotice(prefix = '[openalice]'): boolean {
  const lines = legacyDataNoticeLines()
  if (lines.length === 0) return false
  for (const line of lines) console.warn(`${prefix} ${line}`)
  return true
}
