import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { relocateLegacyData } from './relocate-data.js'

describe('relocateLegacyData', () => {
  let legacyRoot: string
  let newRoot: string

  beforeEach(async () => {
    legacyRoot = await mkdtemp(join(tmpdir(), 'oa-legacy-'))
    newRoot = await mkdtemp(join(tmpdir(), 'oa-new-'))
    // mkdtemp creates newRoot itself; relocate must tolerate it existing
    // while <newRoot>/data does not.
  })

  afterEach(async () => {
    await rm(legacyRoot, { recursive: true, force: true })
    await rm(newRoot, { recursive: true, force: true })
  })

  async function seedLegacyStore(): Promise<void> {
    await mkdir(join(legacyRoot, 'data', 'config'), { recursive: true })
    await writeFile(join(legacyRoot, 'data', 'config', 'accounts.json'), '[{"id":"x"}]')
  }

  it('moves the legacy data dir into the new root', async () => {
    await seedLegacyStore()
    const result = await relocateLegacyData(legacyRoot, newRoot)
    expect(result).toBe('moved')
    expect(await readFile(join(newRoot, 'data', 'config', 'accounts.json'), 'utf8')).toBe('[{"id":"x"}]')
    expect(existsSync(join(legacyRoot, 'data'))).toBe(false)
    expect(existsSync(join(legacyRoot, 'DATA-MOVED.txt'))).toBe(true)
  })

  it('no-ops when there is no legacy store', async () => {
    expect(await relocateLegacyData(legacyRoot, newRoot)).toBe('skipped')
    expect(existsSync(join(newRoot, 'data'))).toBe(false)
  })

  it('never clobbers an existing new store (new store wins)', async () => {
    await seedLegacyStore()
    await mkdir(join(newRoot, 'data', 'config'), { recursive: true })
    await writeFile(join(newRoot, 'data', 'config', 'accounts.json'), '[{"id":"newer"}]')

    expect(await relocateLegacyData(legacyRoot, newRoot)).toBe('skipped')
    expect(await readFile(join(newRoot, 'data', 'config', 'accounts.json'), 'utf8')).toBe('[{"id":"newer"}]')
    // legacy store untouched — user can still inspect/merge manually
    expect(await readFile(join(legacyRoot, 'data', 'config', 'accounts.json'), 'utf8')).toBe('[{"id":"x"}]')
  })

  it('is idempotent across repeated boots', async () => {
    await seedLegacyStore()
    expect(await relocateLegacyData(legacyRoot, newRoot)).toBe('moved')
    expect(await relocateLegacyData(legacyRoot, newRoot)).toBe('skipped')
  })

  it('sweeps a stale partial copy from a crashed previous run', async () => {
    await seedLegacyStore()
    await mkdir(join(newRoot, '.data.relocating'), { recursive: true })
    await writeFile(join(newRoot, '.data.relocating', 'partial.json'), '{}')

    expect(await relocateLegacyData(legacyRoot, newRoot)).toBe('moved')
    expect(existsSync(join(newRoot, '.data.relocating'))).toBe(false)
    expect(existsSync(join(newRoot, 'data', 'config', 'accounts.json'))).toBe(true)
  })
})
