/**
 * One-time migration: strip legacy UNSET_DOUBLE sentinels from persisted
 * trading commits.
 *
 * Context: before the Decimal migration, Order's price-class fields
 * (lmtPrice, auxPrice, trailStopPrice, trailingPercent, cashQty)
 * defaulted to UNSET_DOUBLE = Number.MAX_VALUE. JSON.stringify serialised
 * this as 1.7976931348623157e+308 into data/trading/<account>/commit.json.
 *
 * Post-migration the fields are Decimal with a different UNSET_DECIMAL
 * sentinel (~1.7e38). TradingGit.rehydrateOrder wraps any non-null value
 * via `new Decimal(String(x))`, so the old legacy sentinel rehydrates
 * into a perfectly valid but absurd Decimal (~1.7e308) that slips past
 * every UNSET check. Surfaces as "$179769313486231570000..." in the
 * Recent Trades panel; would also blow up max-position-size guard if
 * run against historical staging.
 *
 * Fix: delete those sentinel fields at rest. After this script, every
 * price field is either a real numeric string / number or absent —
 * Order's class defaults (UNSET_DECIMAL) take over on rehydrate.
 *
 * Idempotent — rerun is a no-op.
 *
 * Run:
 *   pnpm tsx scripts/migrate-order-sentinels.ts
 */

import { readFileSync, writeFileSync, readdirSync, statSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { dataPath } from '../src/core/paths.js'

const LEGACY_UNSET_DOUBLE = Number.MAX_VALUE  // = 1.7976931348623157e+308
const PRICE_FIELDS = ['lmtPrice', 'auxPrice', 'trailStopPrice', 'trailingPercent', 'cashQty'] as const

const TRADING_DIR = dataPath('trading')

interface Commit {
  hash?: string
  operations?: Array<{
    action?: string
    order?: Record<string, unknown>
    changes?: Record<string, unknown>
  }>
}

interface CommitFile {
  commits?: Commit[]
  head?: string
}

function isLegacySentinel(v: unknown): boolean {
  return typeof v === 'number' && v === LEGACY_UNSET_DOUBLE
}

function cleanOrderObject(obj: Record<string, unknown> | undefined, counter: Map<string, number>): boolean {
  if (!obj) return false
  let dirty = false
  for (const field of PRICE_FIELDS) {
    if (field in obj && isLegacySentinel(obj[field])) {
      delete obj[field]
      counter.set(field, (counter.get(field) ?? 0) + 1)
      dirty = true
    }
  }
  return dirty
}

function cleanFile(path: string): { dirty: boolean; counts: Map<string, number> } {
  const counts = new Map<string, number>()
  const raw = readFileSync(path, 'utf8')
  const data: CommitFile = JSON.parse(raw)
  let dirty = false

  for (const commit of data.commits ?? []) {
    for (const op of commit.operations ?? []) {
      if (cleanOrderObject(op.order, counts)) dirty = true
      if (cleanOrderObject(op.changes, counts)) dirty = true
    }
  }

  if (dirty) {
    const serialised = JSON.stringify(data, null, 2) + '\n'
    const tmp = path + '.tmp'
    writeFileSync(tmp, serialised, 'utf8')
    renameSync(tmp, path)
  }
  return { dirty, counts }
}

function main() {
  let totalFiles = 0
  let changedFiles = 0
  const grandTotal = new Map<string, number>()

  let entries: string[]
  try {
    entries = readdirSync(TRADING_DIR)
  } catch (err) {
    console.error(`No ${TRADING_DIR} directory found. Nothing to do.`)
    return
  }

  for (const entry of entries) {
    const commitPath = join(TRADING_DIR, entry, 'commit.json')
    let st
    try { st = statSync(commitPath) } catch { continue }
    if (!st.isFile()) continue
    totalFiles++

    const { dirty, counts } = cleanFile(commitPath)
    const summary = [...counts.entries()].map(([k, v]) => `${k}:${v}`).join(' ')
    if (dirty) {
      changedFiles++
      console.log(`✓ ${entry} — stripped ${summary}`)
      for (const [k, v] of counts) grandTotal.set(k, (grandTotal.get(k) ?? 0) + v)
    } else {
      console.log(`· ${entry} — clean`)
    }
  }

  console.log(`\n${changedFiles}/${totalFiles} files changed. Total stripped:`,
    [...grandTotal.entries()].map(([k, v]) => `${k}=${v}`).join(', ') || '(none)')
}

main()
