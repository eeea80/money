import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createEntityStore,
  createMemoryEntityStore,
  type Entity,
  type IEntityStore,
} from './entity-store.js'

describe('EntityStore (in-memory)', () => {
  let store: IEntityStore

  beforeEach(() => {
    store = createMemoryEntityStore()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('upsert creates an entity and stamps createdAt', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const e = await store.upsert({ name: 'vst', type: 'asset', description: 'Vistra, TX power' })
    expect(e).toEqual<Entity>({
      name: 'vst',
      type: 'asset',
      description: 'Vistra, TX power',
      createdAt: 1000,
    })
  })

  it('upsert trims name + description', async () => {
    const e = await store.upsert({ name: '  vst  ', type: 'asset', description: '  Vistra  ' })
    expect(e.name).toBe('vst')
    expect(e.description).toBe('Vistra')
  })

  it('upsert rejects empty name', async () => {
    await expect(
      store.upsert({ name: '   ', type: 'asset', description: 'x' }),
    ).rejects.toThrow(/name is required/)
  })

  it('upsert rejects a name with spaces', async () => {
    await expect(
      store.upsert({ name: 'ai power', type: 'topic', description: 'x' }),
    ).rejects.toThrow(/no spaces/)
  })

  it('upsert rejects empty description', async () => {
    await expect(
      store.upsert({ name: 'vst', type: 'asset', description: '   ' }),
    ).rejects.toThrow(/description is required/)
  })

  it('upsert rejects an invalid type', async () => {
    await expect(
      // @ts-expect-error — exercising the runtime guard
      store.upsert({ name: 'vst', type: 'stonk', description: 'x' }),
    ).rejects.toThrow(/type must be/)
  })

  it('upsert is idempotent on name: updates fields, keeps createdAt, no duplicate', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const first = await store.upsert({ name: 'vst', type: 'asset', description: 'Vistra' })
    expect(first.createdAt).toBe(1000)

    vi.setSystemTime(5000)
    const second = await store.upsert({ name: 'vst', type: 'asset', description: 'Vistra Energy (updated)' })
    expect(second.createdAt).toBe(1000) // preserved
    expect(second.description).toBe('Vistra Energy (updated)')

    const all = await store.list()
    expect(all).toHaveLength(1)
  })

  it('keys case-insensitively: [[VST]] and [[vst]] are one entity', async () => {
    await store.upsert({ name: 'VST', type: 'asset', description: 'first' })
    await store.upsert({ name: 'vst', type: 'asset', description: 'second' })
    const all = await store.list()
    expect(all).toHaveLength(1)
    expect(await store.get('Vst')).not.toBeNull()
    expect((await store.get('vSt'))?.description).toBe('second')
  })

  it('list returns newest-created first', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    await store.upsert({ name: 'a', type: 'topic', description: 'x' })
    vi.setSystemTime(2000)
    await store.upsert({ name: 'b', type: 'topic', description: 'x' })
    vi.setSystemTime(3000)
    await store.upsert({ name: 'c', type: 'topic', description: 'x' })
    const all = await store.list()
    expect(all.map((e) => e.name)).toEqual(['c', 'b', 'a'])
  })

  it('search matches name or description, case-insensitive; empty lists all', async () => {
    await store.upsert({ name: 'vst', type: 'asset', description: 'Vistra, Texas power producer' })
    await store.upsert({ name: 'gev', type: 'asset', description: 'GE Vernova, grid + power equipment' })
    await store.upsert({ name: 'ai-data-center-power', type: 'topic', description: 'datacenter electricity demand' })

    expect((await store.search('texas')).map((e) => e.name)).toEqual(['vst'])
    expect((await store.search('POWER')).map((e) => e.name).sort()).toEqual(
      ['ai-data-center-power', 'gev', 'vst'].sort(),
    )
    expect((await store.search('gev')).map((e) => e.name)).toEqual(['gev'])
    expect(await store.search('')).toHaveLength(3)
  })

  it('delete removes by name (case-insensitive); missing returns false', async () => {
    await store.upsert({ name: 'vst', type: 'asset', description: 'x' })
    await store.upsert({ name: 'gev', type: 'asset', description: 'y' })
    expect(await store.delete('VST')).toBe(true)
    expect((await store.list()).map((e) => e.name)).toEqual(['gev'])
    expect(await store.delete('nope')).toBe(false)
  })

  it('onChanged fires on upsert + delete; dispose stops it', async () => {
    let count = 0
    const dispose = store.onChanged(() => { count++ })
    await store.upsert({ name: 'vst', type: 'asset', description: 'x' })
    await store.upsert({ name: 'vst', type: 'asset', description: 'y' }) // update still notifies
    await store.delete('vst')
    expect(count).toBe(3)
    dispose()
    await store.upsert({ name: 'gev', type: 'asset', description: 'z' })
    expect(count).toBe(3)
  })
})

describe('EntityStore (JSONL persistence)', () => {
  let dir: string
  let path: string
  let store: IEntityStore

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'oa-entities-'))
    path = join(dir, 'entities.jsonl')
    store = createEntityStore({ filePath: path })
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('persists across new store instances on the same file', async () => {
    await store.upsert({ name: 'vst', type: 'asset', description: 'Vistra' })
    const fresh = createEntityStore({ filePath: path })
    const all = await fresh.list()
    expect(all).toHaveLength(1)
    expect(all[0]!.name).toBe('vst')
    expect(all[0]!.type).toBe('asset')
  })

  it('returns empty when file does not exist', async () => {
    const missing = createEntityStore({ filePath: join(dir, 'absent.jsonl') })
    expect(await missing.list()).toEqual([])
    expect(await missing.get('vst')).toBeNull()
    expect(await missing.search('x')).toEqual([])
  })

  it('upsert preserves an existing createdAt read from disk', async () => {
    // Seed a record with a known-old createdAt, then update via upsert.
    await writeFile(
      path,
      JSON.stringify({ name: 'vst', description: 'old', type: 'asset', createdAt: 1000 }) + '\n',
      'utf-8',
    )
    const updated = await store.upsert({ name: 'vst', type: 'asset', description: 'new' })
    expect(updated.createdAt).toBe(1000)
    expect(updated.description).toBe('new')

    const fresh = createEntityStore({ filePath: path })
    const all = await fresh.list()
    expect(all).toHaveLength(1)
    expect(all[0]!.createdAt).toBe(1000)
    expect(all[0]!.description).toBe('new')
  })

  it('upsert rewrites the file deduped (no duplicate lines), atomically', async () => {
    await store.upsert({ name: 'vst', type: 'asset', description: 'a' })
    await store.upsert({ name: 'gev', type: 'asset', description: 'b' })
    await store.upsert({ name: 'VST', type: 'asset', description: 'a2' }) // same entity, new casing

    const fresh = createEntityStore({ filePath: path })
    const all = await fresh.list()
    expect(all).toHaveLength(2)
    expect((await fresh.get('vst'))?.description).toBe('a2')

    // No tmp file left behind.
    expect(await readdir(dir)).not.toContain('entities.jsonl.tmp')
  })

  it('delete rewrites atomically and persists', async () => {
    await store.upsert({ name: 'vst', type: 'asset', description: 'a' })
    await store.upsert({ name: 'gev', type: 'asset', description: 'b' })
    expect(await store.delete('vst')).toBe(true)

    const fresh = createEntityStore({ filePath: path })
    expect((await fresh.list()).map((e) => e.name)).toEqual(['gev'])
    expect(await readdir(dir)).not.toContain('entities.jsonl.tmp')
  })

  it('survives concurrent upserts with no lost writes or corruption', async () => {
    // Pi runs tool calls in PARALLEL — so it fires many entity_upsert at once.
    // Pre-fix this raced on the shared `${path}.tmp` (interleaved writes →
    // corrupted file → "Unexpected token ','") and clobbered each other's
    // read-modify-write snapshots. Serialized mutations must keep all of them.
    const names = Array.from({ length: 25 }, (_, i) => `e${i}`)
    await Promise.all(
      names.map((n) => store.upsert({ name: n, type: 'topic', description: `desc, with comma ${n}` })),
    )
    const fresh = createEntityStore({ filePath: path })
    const all = await fresh.list()
    expect(all.map((e) => e.name).sort()).toEqual([...names].sort())
    expect(await readdir(dir)).not.toContain('entities.jsonl.tmp')
  })

  it('tolerates a malformed line (skips it) and self-heals on the next write', async () => {
    await writeFile(
      path,
      JSON.stringify({ name: 'good', description: 'ok', type: 'asset', createdAt: 1000 }) +
        '\n,"type":"topic","createdAt":123}\n', // the exact corruption signature seen live
      'utf-8',
    )
    // Reads no longer throw — the bad fragment is skipped, not fatal.
    expect((await store.list()).map((e) => e.name)).toEqual(['good'])
    // Next mutation atomically rewrites the file clean (bad line gone).
    await store.upsert({ name: 'fresh-one', type: 'topic', description: 'x' })
    const reopened = createEntityStore({ filePath: path })
    expect((await reopened.list()).map((e) => e.name).sort()).toEqual(['fresh-one', 'good'])
  })
})
