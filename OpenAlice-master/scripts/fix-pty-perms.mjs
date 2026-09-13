#!/usr/bin/env node
/**
 * node-pty's prebuilt `spawn-helper` (used on macOS/Linux to fork a controlling
 * terminal) sometimes lands on disk without the executable bit set, which makes
 * `pty.spawn()` fail with the unhelpful `posix_spawnp failed.` error.
 *
 * This postinstall hook walks node-pty's prebuilds and ensures the helper is
 * executable. No-op on Windows and on layouts where the file is missing.
 */
import { chmodSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

if (process.platform === 'win32') process.exit(0);

let nodePtyPkg;
try {
  nodePtyPkg = createRequire(import.meta.url).resolve('node-pty/package.json');
} catch {
  process.exit(0);
}

const prebuildsDir = join(dirname(nodePtyPkg), 'prebuilds');
if (!existsSync(prebuildsDir)) process.exit(0);

for (const entry of readdirSync(prebuildsDir)) {
  const helper = join(prebuildsDir, entry, 'spawn-helper');
  if (!existsSync(helper)) continue;
  const mode = statSync(helper).mode;
  const wantedMode = mode | 0o111;
  if (mode !== wantedMode) {
    chmodSync(helper, wantedMode);
    // eslint-disable-next-line no-console
    console.log(`[fix-pty-perms] chmod +x ${helper}`);
  }
}
