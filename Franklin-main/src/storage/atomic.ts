/**
 * Crash-safe file writes.
 *
 * `writeFileSync` truncates the target before writing its bytes, so a crash
 * or kill mid-write leaves a half-written (often empty) file. For Franklin
 * that means a wiped portfolio (cross-session P&L — the Trading vertical's
 * headline feature) or a wiped content library (budget `spentUsd`). We
 * instead write to a sibling temp file and `renameSync` it into place:
 * rename is atomic on the same filesystem, so a reader ever sees only the
 * complete old file or the complete new one — never a torn write. The
 * previous good copy is preserved as `<file>.bak` for recovery.
 */

import {
  writeFileSync, renameSync, copyFileSync, existsSync, mkdirSync,
  openSync, fsyncSync, closeSync, unlinkSync,
} from 'node:fs';
import { dirname } from 'node:path';

export function atomicWriteFileSync(filePath: string, data: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;

  // Write AND fsync the temp file before renaming it into place. rename is
  // atomic w.r.t. concurrent readers, but it is not durable across a hard
  // crash/power loss on its own: the filesystem can persist the rename while
  // the temp file's data blocks are still in the page cache, leaving a
  // zero-length target after reboot — exactly the wiped-state failure this
  // module exists to prevent. fsync forces the bytes down first.
  const fd = openSync(tmp, 'w');
  try {
    writeFileSync(fd, data, 'utf-8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }

  // Snapshot the last good file before swapping, so an interrupted future
  // write (or a corrupt new payload) is still recoverable from <file>.bak.
  if (existsSync(filePath)) {
    try { copyFileSync(filePath, `${filePath}.bak`); } catch { /* best-effort */ }
  }

  try {
    renameSync(tmp, filePath);
  } catch (err) {
    // Don't litter a half-written temp file on a failed swap (callers treat
    // persistence as best-effort and swallow the throw, so nothing else reaps it).
    try { unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }

  // fsync the directory so the rename itself survives a crash. Some platforms
  // (and Windows) reject directory fsync — best-effort.
  try {
    const dfd = openSync(dirname(filePath), 'r');
    try { fsyncSync(dfd); } finally { closeSync(dfd); }
  } catch { /* best-effort */ }
}
