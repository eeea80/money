/**
 * One-time relocation of the packaged app's user data store.
 *
 * Until the global-root change, the packaged backend kept user data under
 * Electron's userData dir (~/Library/Application Support/OpenAlice/data on
 * macOS). The user-data home is now ~/.openalice — shared with `pnpm dev`
 * and bare `pnpm start` — so an existing store must move once, before the
 * shell reads ports.json from the new root or spawns the backend (which
 * would run migrations against an empty store).
 *
 * Scope: ONLY `<userData>/data` moves. userData also holds Electron's
 * browser-profile state (Cache, Local Storage, …) which must stay.
 *
 * Crash safety:
 *   - same-volume: a single rename — atomic, nothing to clean up.
 *   - cross-volume (EXDEV): copy into `<newRoot>/.data.relocating`, then
 *     rename into place. A crash mid-copy leaves only the tmp dir, which is
 *     swept and re-copied on next boot; a crash after the commit rename is
 *     absorbed by the idempotency guard. The legacy dir is kept as
 *     `data.relocated` — never deleted, it's the user's trading history.
 */

import { existsSync } from 'node:fs'
import { cp, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function relocateLegacyData(legacyRoot: string, newRoot: string): Promise<'moved' | 'skipped'> {
  const legacyData = join(legacyRoot, 'data')
  const newData = join(newRoot, 'data')
  // Idempotent: nothing to move, or the new store already exists (in which
  // case it wins — it may have newer state from a dev/pnpm-start session).
  if (!existsSync(legacyData) || existsSync(newData)) return 'skipped'

  await mkdir(newRoot, { recursive: true })
  const tmp = join(newRoot, '.data.relocating')
  await rm(tmp, { recursive: true, force: true }) // sweep a stale partial copy

  try {
    await rename(legacyData, newData) // atomic same-volume fast path
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    await cp(legacyData, tmp, { recursive: true })
    await rename(tmp, newData) // atomic commit
    await rename(legacyData, `${legacyData}.relocated`) // keep as backup
  }

  await writeFile(
    join(legacyRoot, 'DATA-MOVED.txt'),
    `OpenAlice user data moved to ${newData} on ${new Date().toISOString()}\n`,
  )
  return 'moved'
}
