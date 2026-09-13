/**
 * EntityStore — the durable, cross-workspace index of things the user is
 * tracking. Sibling of {@link InboxStore}: same file-backed, no-DB shape, but
 * the atomic concept is an **entity** (a tracked asset or topic) rather than a
 * push notification.
 *
 * An entity is a *deliberately created* anchor, not an extracted one. The
 * agent calls `entity_upsert` when it decides something is worth tracking;
 * the notes it writes then point at the entity with Obsidian-style `[[name]]`
 * links. We never parse prose to infer entities or relations — the design
 * principle is "complexity lives in the semantic layer (the name + the
 * description + the authored `[[]]` links), not in the schema." The whole
 * record is four fields.
 *
 * Keyed by `name`, not an opaque id: the name is already a stable semantic
 * key (a ticker for an asset, a kebab phrase for a topic) and doubles as the
 * `[[name]]` link target. Matching is case-insensitive so `[[VST]]` and
 * `[[vst]]` don't fragment into two. Storage is the *current state* (one JSONL
 * line per entity, last write wins), rewritten atomically (tmp + rename) on
 * each upsert/delete — the set is a small curated watchlist, not a log.
 */

import { readFile, mkdir, writeFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { EventEmitter } from 'node:events'

import { dataPath } from '@/core/paths.js'

export type EntityType = 'asset' | 'topic'

export interface EntityInput {
  /** Short, kebab, no whitespace. The key, and the `[[name]]` link target.
   *  For an `asset` use the ticker so view-time enrichment can join. */
  name: string
  /** Free text "what is this" — disambiguates the terse name. */
  description: string
  type: EntityType
}

export interface Entity extends EntityInput {
  /** Epoch ms the entity was first tracked. Preserved across upserts. */
  createdAt: number
}

export interface IEntityStore {
  /** Create or update by `name` (case-insensitive). An update keeps the
   *  original `createdAt` and overwrites description/type. */
  upsert(input: EntityInput): Promise<Entity>
  /** All entities, most-recently-created first. */
  list(): Promise<Entity[]>
  get(name: string): Promise<Entity | null>
  /** Substring match on name + description (case-insensitive). Empty query
   *  returns everything. Used by the agent's pre-create dedup check and the
   *  Tracked-tab search box. */
  search(query: string): Promise<Entity[]>
  delete(name: string): Promise<boolean>
  onChanged(listener: () => void): () => void
}

const ENTITY_FILE = dataPath('entities', 'entities.jsonl')

/** Case-insensitive identity key for a name. */
const keyOf = (name: string): string => name.trim().toLowerCase()

// ==================== Validation ====================

function validateInput(input: EntityInput): void {
  const name = input.name?.trim() ?? ''
  if (!name) {
    throw new Error('EntityStore.upsert: name is required')
  }
  if (/\s/.test(name)) {
    throw new Error(
      'EntityStore.upsert: name must contain no spaces (kebab-case or ticker, e.g. "vst" or "ai-data-center-power")',
    )
  }
  if (!(input.description ?? '').trim()) {
    throw new Error('EntityStore.upsert: description is required (it disambiguates the short name)')
  }
  if (input.type !== 'asset' && input.type !== 'topic') {
    throw new Error('EntityStore.upsert: type must be "asset" or "topic"')
  }
}

function matches(e: Entity, q: string): boolean {
  return e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q)
}

const byNewest = (a: Entity, b: Entity): number => b.createdAt - a.createdAt

// ==================== JSONL store ====================

export interface EntityStoreOptions {
  filePath?: string
}

export function createEntityStore(opts: EntityStoreOptions = {}): IEntityStore {
  const filePath = opts.filePath ?? ENTITY_FILE
  const emitter = new EventEmitter()
  emitter.setMaxListeners(50)

  // Serialize mutating ops so each read-modify-write-rename cycle is atomic for
  // this store instance. Without it, concurrent upserts — which Pi triggers by
  // running tool calls in PARALLEL — race on the shared `${filePath}.tmp`,
  // interleaving bytes and corrupting the file (observed in the wild as
  // "Unexpected token ','" on the next read), and clobber each other's writes.
  let writeTail: Promise<unknown> = Promise.resolve()
  function serialize<T>(op: () => Promise<T>): Promise<T> {
    const result = writeTail.then(op, op)
    writeTail = result.then(() => undefined, () => undefined)
    return result
  }

  async function readAll(): Promise<Entity[]> {
    let raw: string
    try {
      raw = await readFile(filePath, 'utf-8')
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return []
      }
      throw err
    }
    const out: Entity[] = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        out.push(JSON.parse(line) as Entity)
      } catch {
        // Tolerate a malformed line instead of bricking every entity op. A
        // corrupted line (e.g. left by a pre-fix concurrent-write interleave)
        // is skipped here and dropped on the next atomic rewrite — self-healing.
        console.warn('entity-store: skipping malformed line in', filePath)
      }
    }
    return out
  }

  async function writeAll(entities: Entity[]): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true })
    const body = entities.length > 0 ? entities.map((e) => JSON.stringify(e)).join('\n') + '\n' : ''
    // Atomic rewrite — tmp + rename, same as InboxStore.delete. Current-state
    // file (deduped by name), not an append log, so upsert is a read-modify-write.
    const tmp = `${filePath}.tmp`
    await writeFile(tmp, body, 'utf-8')
    await rename(tmp, filePath)
  }

  async function upsert(input: EntityInput): Promise<Entity> {
    validateInput(input) // sync — fail fast, outside the write queue
    return serialize(async () => {
      const all = await readAll()
      const k = keyOf(input.name)
      const idx = all.findIndex((e) => keyOf(e.name) === k)
      const existing = idx >= 0 ? all[idx] : undefined
      const entity: Entity = {
        name: input.name.trim(),
        description: input.description.trim(),
        type: input.type,
        createdAt: existing?.createdAt ?? Date.now(),
      }
      if (idx >= 0) all[idx] = entity
      else all.push(entity)
      await writeAll(all)
      emitter.emit('changed')
      return entity
    })
  }

  async function list(): Promise<Entity[]> {
    return (await readAll()).sort(byNewest)
  }

  async function get(name: string): Promise<Entity | null> {
    const k = keyOf(name)
    return (await readAll()).find((e) => keyOf(e.name) === k) ?? null
  }

  async function search(query: string): Promise<Entity[]> {
    const q = query.trim().toLowerCase()
    const all = await list()
    return q ? all.filter((e) => matches(e, q)) : all
  }

  async function deleteEntity(name: string): Promise<boolean> {
    return serialize(async () => {
      const k = keyOf(name)
      const all = await readAll()
      const next = all.filter((e) => keyOf(e.name) !== k)
      if (next.length === all.length) return false
      await writeAll(next)
      emitter.emit('changed')
      return true
    })
  }

  function onChanged(listener: () => void): () => void {
    emitter.on('changed', listener)
    return () => {
      emitter.off('changed', listener)
    }
  }

  return { upsert, list, get, search, delete: deleteEntity, onChanged }
}

// ==================== In-memory store (tests) ====================

export function createMemoryEntityStore(): IEntityStore {
  const byKey = new Map<string, Entity>()
  const emitter = new EventEmitter()
  emitter.setMaxListeners(50)

  async function upsert(input: EntityInput): Promise<Entity> {
    validateInput(input)
    const k = keyOf(input.name)
    const existing = byKey.get(k)
    const entity: Entity = {
      name: input.name.trim(),
      description: input.description.trim(),
      type: input.type,
      createdAt: existing?.createdAt ?? Date.now(),
    }
    byKey.set(k, entity)
    emitter.emit('changed')
    return entity
  }

  async function list(): Promise<Entity[]> {
    return [...byKey.values()].sort(byNewest)
  }

  async function get(name: string): Promise<Entity | null> {
    return byKey.get(keyOf(name)) ?? null
  }

  async function search(query: string): Promise<Entity[]> {
    const q = query.trim().toLowerCase()
    const all = await list()
    return q ? all.filter((e) => matches(e, q)) : all
  }

  async function deleteEntity(name: string): Promise<boolean> {
    const removed = byKey.delete(keyOf(name))
    if (removed) emitter.emit('changed')
    return removed
  }

  function onChanged(listener: () => void): () => void {
    emitter.on('changed', listener)
    return () => {
      emitter.off('changed', listener)
    }
  }

  return { upsert, list, get, search, delete: deleteEntity, onChanged }
}
