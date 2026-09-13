/**
 * Token store smoke tests.
 *
 * These exercise the scrypt round-trip + file persistence path. They
 * write to and clean up `data/config/auth.json` under the repo, which
 * is `.gitignore`d.
 *
 * Cross-test ordering matters less than usual because every test clears
 * the file in `beforeEach`. Run sequentially anyway (no concurrent test
 * isolation needed — vitest default is serial-per-file).
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { readFile, unlink } from 'node:fs/promises'
import { dataPath } from '@/core/paths.js'
import {
  bootstrapToken,
  generateToken,
  verifyToken,
  getTokenInfo,
  clearToken,
} from './token-store.js'

const AUTH_FILE = dataPath('config', 'auth.json')

async function ensureClean() {
  await unlink(AUTH_FILE).catch(() => { /* noop */ })
}

beforeEach(ensureClean)
afterAll(ensureClean)

describe('token-store', () => {
  it('returns exists:false when no auth file is present', async () => {
    const info = await getTokenInfo()
    expect(info.exists).toBe(false)
    expect(info.createdAt).toBeUndefined()
  })

  it('generateToken creates an auth file with valid metadata', async () => {
    const token = await generateToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/)  // base64url-ish, >= 20 chars

    const info = await getTokenInfo()
    expect(info.exists).toBe(true)
    expect(info.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(info.lastRotatedAt).toBe(info.createdAt)

    const raw = JSON.parse(await readFile(AUTH_FILE, 'utf-8'))
    expect(raw.version).toBe(1)
    expect(raw.scheme).toBe('scrypt')
    // The on-disk file must NOT contain the plaintext token.
    const fileText = await readFile(AUTH_FILE, 'utf-8')
    expect(fileText).not.toContain(token)
  })

  it('verifyToken returns true for the correct token', async () => {
    const token = await generateToken()
    expect(await verifyToken(token)).toBe(true)
  })

  it('verifyToken returns false for an incorrect token', async () => {
    await generateToken()
    expect(await verifyToken('not-the-real-token')).toBe(false)
    expect(await verifyToken('')).toBe(false)
  })

  it('verifyToken returns false when no auth file exists', async () => {
    expect(await verifyToken('anything')).toBe(false)
  })

  it('two successive generate calls produce different tokens', async () => {
    const t1 = await generateToken()
    const t2 = await generateToken()
    expect(t1).not.toBe(t2)
    // The most recent generate wins; old token no longer verifies
    expect(await verifyToken(t1)).toBe(false)
    expect(await verifyToken(t2)).toBe(true)
  })

  it('clearToken removes the auth file', async () => {
    await generateToken()
    expect((await getTokenInfo()).exists).toBe(true)
    await clearToken()
    expect((await getTokenInfo()).exists).toBe(false)
  })

  it('bootstrapToken is idempotent — second call does not regenerate', async () => {
    let onFirstCalls = 0
    let firstToken: string | undefined
    await bootstrapToken({
      onFirstGeneration: (t) => {
        onFirstCalls++
        firstToken = t
      },
    })
    expect(onFirstCalls).toBe(1)
    expect(firstToken).toBeDefined()

    // Second call sees existing file → no onFirstGeneration invocation
    await bootstrapToken({
      onFirstGeneration: () => { onFirstCalls++ },
    })
    expect(onFirstCalls).toBe(1)

    // The original token still verifies after the no-op second bootstrap
    expect(await verifyToken(firstToken!)).toBe(true)
  })

  it('the file is written with 0o600 permissions (best effort)', async () => {
    await generateToken()
    const { stat } = await import('node:fs/promises')
    const stats = await stat(AUTH_FILE)
    // mode includes file type bits; mask to permission bits
    const perms = stats.mode & 0o777
    // On Unix we expect 0o600. On Windows / some Docker setups chmod is
    // ignored; allow that too but log if it's broader than 644.
    if (process.platform !== 'win32') {
      expect(perms).toBe(0o600)
    }
  })
})
