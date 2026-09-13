/**
 * Session store smoke tests.
 *
 * Writes to `data/config/sessions.json`; cleans up in beforeEach.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createSession,
  validateAndTouch,
  revokeSession,
  revokeAllSessions,
  listSessions,
  _reset,
  _unlinkFile,
} from './session-store.js'

// Redirect the store at a private temp file (via the OPENALICE_SESSIONS_FILE
// seam) so this file never touches the real data/config/sessions.json and
// can't race with other specs (e.g. auth.spec.ts) under parallel runs.
let tmpDir: string
let SESSIONS_FILE: string

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'oa-session-store-'))
  SESSIONS_FILE = join(tmpDir, 'sessions.json')
  process.env['OPENALICE_SESSIONS_FILE'] = SESSIONS_FILE
})

afterAll(async () => {
  delete process.env['OPENALICE_SESSIONS_FILE']
  await rm(tmpDir, { recursive: true, force: true })
})

beforeEach(async () => {
  await _reset()
  await _unlinkFile()
})

describe('session-store', () => {
  it('createSession returns a record with a base64url SID', async () => {
    const s = await createSession({ userAgent: 'test', ip: '127.0.0.1' })
    expect(s.sid).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(s.sid.length).toBeGreaterThanOrEqual(32)
    expect(s.userAgent).toBe('test')
    expect(s.ip).toBe('127.0.0.1')
    expect(new Date(s.expiresAt).getTime()).toBeGreaterThan(Date.now())
  })

  it('validateAndTouch returns the session for a valid SID', async () => {
    const s = await createSession()
    const back = await validateAndTouch(s.sid)
    expect(back?.sid).toBe(s.sid)
  })

  it('validateAndTouch returns null for an unknown SID', async () => {
    const back = await validateAndTouch('nonexistent-sid-value')
    expect(back).toBeNull()
  })

  it('validateAndTouch returns null and prunes expired sessions', async () => {
    const s = await createSession({ ttlMs: 50 })
    // Wait past TTL
    await new Promise((r) => setTimeout(r, 80))
    const back = await validateAndTouch(s.sid)
    expect(back).toBeNull()
    const remaining = await listSessions()
    expect(remaining.find((x) => x.sid === s.sid)).toBeUndefined()
  })

  it('revokeSession removes the named session, idempotently', async () => {
    const s = await createSession()
    await revokeSession(s.sid)
    expect(await validateAndTouch(s.sid)).toBeNull()
    // Calling revoke again is fine
    await revokeSession(s.sid)
  })

  it('revokeAllSessions wipes everything', async () => {
    await createSession()
    await createSession()
    await createSession()
    expect((await listSessions()).length).toBe(3)
    await revokeAllSessions()
    expect((await listSessions()).length).toBe(0)
  })

  it('SIDs are unique across multiple creations', async () => {
    const sids = new Set<string>()
    for (let i = 0; i < 5; i++) {
      sids.add((await createSession()).sid)
    }
    expect(sids.size).toBe(5)
  })

  it('persists across cache reset (file is source of truth)', async () => {
    const s = await createSession({ userAgent: 'persistent' })
    // Reset in-process cache; data should reload from disk on next call
    await _reset()
    const back = await validateAndTouch(s.sid)
    expect(back?.sid).toBe(s.sid)
    expect(back?.userAgent).toBe('persistent')
  })

  it('survives a malformed sessions.json (recovers as empty)', async () => {
    await _reset()
    await writeFile(SESSIONS_FILE, 'not valid json{{{')
    // First load falls back to empty
    const list = await listSessions()
    expect(list).toEqual([])
  })

  it('on-disk file is written with 0o600 permissions (best effort)', async () => {
    await createSession()
    const { stat } = await import('node:fs/promises')
    const stats = await stat(SESSIONS_FILE)
    const perms = stats.mode & 0o777
    if (process.platform !== 'win32') {
      expect(perms).toBe(0o600)
    }
  })
})
