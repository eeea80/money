/**
 * Minimal red-team harness runner — scaffold only.
 *
 * Eventually this script:
 *   1. Reads each `safe/playbooks/NN-*.md`
 *   2. Extracts seed cases (each has a curl-style invocation + expected
 *      status)
 *   3. Runs them against a live local OpenAlice instance
 *   4. Reports pass/fail/skipped + total coverage
 *
 * For 2026-05-23 this file is a sketch — concrete implementation lands
 * once we have at least one fully formalized case format that an AI
 * agent or vitest can run programmatically.
 *
 * Run:
 *   pnpm tsx safe/harness/runner.ts
 *   pnpm tsx safe/harness/runner.ts --playbook 01-auth-bypass
 *   pnpm tsx safe/harness/runner.ts --report-only
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

interface PlaybookCase {
  playbookId: string
  caseId: string
  title: string
  attackCommand: string
  expectedStatusSecure: number
  // Optional - documented "current state" for pre-impl tracking
  observedStatusCurrent?: number
}

interface CaseResult {
  case: PlaybookCase
  status: 'pass' | 'fail' | 'skipped' | 'error'
  actualStatus?: number
  notes?: string
}

const PLAYBOOK_DIR = new URL('../playbooks/', import.meta.url).pathname
const ALICE_URL = process.env['OPENALICE_RED_TEAM_TARGET'] ?? 'http://localhost:47331'

async function listPlaybooks(): Promise<string[]> {
  const files = await readdir(PLAYBOOK_DIR)
  return files
    .filter((f) => /^\d{2}-.*\.md$/.test(f))
    .map((f) => join(PLAYBOOK_DIR, f))
}

/**
 * Parse a playbook markdown file into structured cases.
 *
 * TODO (2026-05-23): the current playbook format is human-prose-heavy.
 * Cases are demarcated by `### N.X — <title>` headers and contain
 * `**Attack**:` / `**Secure behavior**:` blocks. A real parser would
 * need to:
 *   - Locate each `### N.X` block
 *   - Extract the code block under `**Attack**`
 *   - Look for expected status in the prose ("401", "200")
 *
 * For v0 of the runner, the simplest approach is to add a structured
 * footer per playbook that lists machine-readable cases, e.g.:
 *
 *   ```yaml
 *   # safe/harness/cases.yaml (alternative source of truth)
 *   - playbook: 01-auth-bypass
 *     case: 1.1
 *     name: list-utas-no-cookie
 *     method: GET
 *     path: /api/trading/uta
 *     expectStatusSecure: 401
 *   ```
 *
 * This is a deliberate punt — formalize when the playbook count > 5.
 */
async function parsePlaybook(_filepath: string): Promise<PlaybookCase[]> {
  return []
}

async function runCase(c: PlaybookCase): Promise<CaseResult> {
  // Placeholder. Real impl: invoke c.attackCommand via shell or
  // construct a fetch from parsed method/path/headers.
  return {
    case: c,
    status: 'skipped',
    notes: 'runner not yet implemented',
  }
}

function reportSummary(results: CaseResult[]): void {
  const pass = results.filter((r) => r.status === 'pass').length
  const fail = results.filter((r) => r.status === 'fail').length
  const skipped = results.filter((r) => r.status === 'skipped').length
  const error = results.filter((r) => r.status === 'error').length

  console.log('')
  console.log(`Target:    ${ALICE_URL}`)
  console.log(`Total:     ${results.length}`)
  console.log(`✓ Pass:    ${pass}    (attack was blocked = security holding)`)
  console.log(`✗ Fail:    ${fail}    (attack succeeded = finding to file)`)
  console.log(`⊘ Skip:    ${skipped}`)
  console.log(`!  Error:  ${error}`)
}

async function main(): Promise<void> {
  console.log('OpenAlice red-team harness — scaffold runner')
  console.log('')

  const playbooks = await listPlaybooks()
  console.log(`Found ${playbooks.length} playbooks under safe/playbooks/`)

  const allCases: PlaybookCase[] = []
  for (const path of playbooks) {
    const cases = await parsePlaybook(path)
    allCases.push(...cases)
  }

  console.log(`Parsed ${allCases.length} cases`)

  const results: CaseResult[] = []
  for (const c of allCases) {
    const r = await runCase(c)
    results.push(r)
  }

  reportSummary(results)

  console.log('')
  console.log('NOTE: This runner is scaffolded. Playbook parsing and case')
  console.log('execution are stubbed. Read safe/AGENT_BRIEF.md for the')
  console.log('agent-led workflow that actually exercises the playbooks.')
}

main().catch((err) => {
  console.error('runner: fatal:', err)
  process.exit(1)
})

// Helper used during file-content sanity checks (kept here so that the
// minimal scaffold compiles cleanly when `noUnusedLocals` is on).
export async function _internalReadFile(path: string): Promise<string> {
  return readFile(path, 'utf-8')
}
