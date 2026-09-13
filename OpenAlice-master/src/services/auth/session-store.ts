/**
 * Session store.
 *
 * Sessions are file-as-truth (`data/config/sessions.json`) — fits the rest
 * of OpenAlice's persistence model, no Redis/SQLite required. A session
 * is created on successful `POST /api/auth/login` and dies when:
 *   - Operator hits "logout" → explicit revoke
 *   - TTL expires (default 7 days from last touch)
 *   - Operator rotates the admin token (all sessions wiped server-side)
 *   - Sessions file is deleted manually (recovery path)
 *
 * Cookies are opaque session IDs — they carry no signed payload. The
 * cookie value is meaningless without an entry in `sessions.json`.
 */

import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile, chmod, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { dataPath } from '@/core/paths.js'

const SID_BYTES = 32
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000  // 7 days

// Resolved lazily on every call so the path can be redirected at runtime.
// `OPENALICE_SESSIONS_FILE` is a test-only seam (same spirit as the
// `_reset` / `_unlinkFile` exports below): specs point it at a private
// temp file so parallel test files don't race on — or clobber — the real
// `data/config/sessions.json`. Production never sets it.
const SESSIONS_FILE = () =>
  process.env['OPENALICE_SESSIONS_FILE'] || dataPath('config', 'sessions.json')

export interface SessionRecord {
  sid: string
  createdAt: string
  lastSeenAt: string
  expiresAt: string
  userAgent?: string
  ip?: string
}

interface SessionsFile {
  version: 1
  sessions: SessionRecord[]
}

// In-process cache. Sessions are appended to / mutated mostly in
// validate-and-touch path; an in-memory mirror keeps us off disk for the
// common case. The on-disk file is the source of truth across restarts.
let cache: SessionsFile | null = null
let writePromise: Promise<void> | null = null

async function loadCache(): Promise<SessionsFile> {
  if (cache) return cache
  try {
    const raw = await readFile(SESSIONS_FILE(), 'utf-8')
    const parsed = JSON.parse(raw) as SessionsFile
    if (parsed.version !== 1 || !Array.isArray(parsed.sessions)) {
      cache = { version: 1, sessions: [] }
    } else {
      cache = parsed
    }
  } catch {
    cache = { version: 1, sessions: [] }
  }
  return cache
}

async function flush(): Promise<void> {
  if (!cache) return
  // Coalesce concurrent writes — last writer wins.
  if (writePromise) {
    await writePromise
  }
  const snapshot: SessionsFile = { version: 1, sessions: [...cache.sessions] }
  writePromise = (async () => {
    const path = SESSIONS_FILE()
    await mkdir(dirname(path), { recursive: true })
    const tmp = `${path}.tmp`
    const data = JSON.stringify(snapshot, null, 2) + '\n'
    await writeFile(tmp, data, { mode: 0o600 })
    await rename(tmp, path)
    await chmod(path, 0o600).catch(() => { /* noop */ })
  })()
  await writePromise
  writePromise = null
}

/** Create a new session, persist, return the SID cookie value. */
export async function createSession(opts: {
  userAgent?: string
  ip?: string
  ttlMs?: number
} = {}): Promise<SessionRecord> {
  const file = await loadCache()
  const now = new Date()
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS
  const record: SessionRecord = {
    sid: randomBytes(SID_BYTES).toString('base64url'),
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    userAgent: opts.userAgent,
    ip: opts.ip,
  }
  file.sessions.push(record)
  await flush()
  return record
}

/**
 * Look up a session by SID, check expiry, slide the expiry window forward.
 * Returns null if no such session or expired. Removes expired entry as a
 * side effect (lazy cleanup).
 *
 * The lastSeenAt write is throttled internally — writes only when at
 * least 30 seconds have elapsed since the previous touch — to avoid
 * thrashing disk on the hot path. Expiry is still computed against the
 * current time, so security isn't affected by the throttle.
 */
const TOUCH_THROTTLE_MS = 30_000

export async function validateAndTouch(sid: string, opts: { ttlMs?: number } = {}): Promise<SessionRecord | null> {
  const file = await loadCache()
  const idx = file.sessions.findIndex((s) => s.sid === sid)
  if (idx < 0) return null
  const sess = file.sessions[idx]
  const now = new Date()
  if (new Date(sess.expiresAt).getTime() < now.getTime()) {
    file.sessions.splice(idx, 1)
    await flush()
    return null
  }
  const lastSeen = new Date(sess.lastSeenAt).getTime()
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS
  if (now.getTime() - lastSeen > TOUCH_THROTTLE_MS) {
    sess.lastSeenAt = now.toISOString()
    sess.expiresAt = new Date(now.getTime() + ttlMs).toISOString()
    await flush()
  }
  return sess
}

/** Forget a single session — typical "logout" path. Idempotent. */
export async function revokeSession(sid: string): Promise<void> {
  const file = await loadCache()
  const before = file.sessions.length
  file.sessions = file.sessions.filter((s) => s.sid !== sid)
  if (file.sessions.length !== before) {
    await flush()
  }
}

/** Wipe every session. Used on token rotation + "log out everywhere" UI. */
export async function revokeAllSessions(): Promise<void> {
  const file = await loadCache()
  if (file.sessions.length === 0) return
  file.sessions = []
  await flush()
}

/** Read-only inspection — list current sessions (for Settings UI). */
export async function listSessions(): Promise<SessionRecord[]> {
  const file = await loadCache()
  return [...file.sessions]
}

/**
 * Internal: clear in-process cache so the next read forces a reload
 * from disk. Test-only — needed to verify that persistence actually
 * goes through the file. Does NOT remove the file itself.
 */
export async function _reset(): Promise<void> {
  cache = null
}

/**
 * Internal: drop the on-disk file. Test setup uses this directly to
 * start each test from a clean slate; the recovery path "delete
 * sessions.json + restart" achieves the same effect at the OS level.
 */
export async function _unlinkFile(): Promise<void> {
  await unlink(SESSIONS_FILE()).catch(() => { /* fine */ })
}
