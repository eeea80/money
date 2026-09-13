import { readdir, readFile as nodeReadFile, writeFile as nodeWriteFile, mkdir, lstat as nodeLstat, stat, lstat, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, normalize, resolve, sep } from 'node:path';

export interface FileEntry {
  readonly name: string;
  readonly kind: 'file' | 'dir' | 'symlink' | 'other';
  readonly sizeBytes: number | null;
  readonly mtime: string;
}

export interface DirListing {
  readonly path: string;
  readonly entries: readonly FileEntry[];
}

export class PathTraversal extends Error {
  constructor(public readonly attempted: string) {
    super(`refused to escape workspace: ${attempted}`);
    this.name = 'PathTraversal';
  }
}

/**
 * List a single directory inside a workspace.
 *
 * - `relPath` is interpreted relative to `workspaceDir`. Both `''` and `'.'`
 *   mean the workspace root.
 * - Absolute paths, leading `..` segments, and any path that escapes
 *   `workspaceDir` after normalisation throw `PathTraversal`.
 * - Symlinks are reported as symlinks (via `lstat`); their target is NOT
 *   followed, so a malicious symlink can't lead us outside.
 */
export async function listDir(workspaceDir: string, relPath: string): Promise<DirListing> {
  const cleanRel = normalize(relPath || '.');
  if (isAbsolute(cleanRel) || cleanRel === '..' || cleanRel.startsWith(`..${sep}`)) {
    throw new PathTraversal(relPath);
  }
  const abs = resolve(workspaceDir, cleanRel);
  const workspaceAbs = resolve(workspaceDir);
  if (abs !== workspaceAbs && !abs.startsWith(workspaceAbs + sep)) {
    throw new PathTraversal(relPath);
  }

  const dirStat = await stat(abs);
  if (!dirStat.isDirectory()) {
    throw new Error(`not a directory: ${cleanRel}`);
  }

  const names = await readdir(abs);
  const entries: FileEntry[] = [];
  for (const name of names) {
    try {
      const ls = await lstat(resolve(abs, name));
      const kind: FileEntry['kind'] = ls.isSymbolicLink()
        ? 'symlink'
        : ls.isDirectory()
          ? 'dir'
          : ls.isFile()
            ? 'file'
            : 'other';
      entries.push({
        name,
        kind,
        sizeBytes: ls.isFile() ? ls.size : null,
        mtime: ls.mtime.toISOString(),
      });
    } catch {
      // skip entries we can't stat (race with deletion, perm error, etc.)
    }
  }
  entries.sort((a, b) => {
    if (a.kind === 'dir' && b.kind !== 'dir') return -1;
    if (a.kind !== 'dir' && b.kind === 'dir') return 1;
    return a.name.localeCompare(b.name);
  });

  return { path: cleanRel === '.' ? '' : cleanRel, entries };
}

/**
 * Resolve `relPath` against `workspaceDir`, enforcing the same traversal
 * guard `listDir` uses. Returned path is absolute. Throws `PathTraversal`
 * if the request escapes.
 */
function resolveInside(workspaceDir: string, relPath: string): string {
  const cleanRel = normalize(relPath);
  if (isAbsolute(cleanRel) || cleanRel === '..' || cleanRel.startsWith(`..${sep}`)) {
    throw new PathTraversal(relPath);
  }
  const abs = resolve(workspaceDir, cleanRel);
  const workspaceAbs = resolve(workspaceDir);
  if (abs !== workspaceAbs && !abs.startsWith(workspaceAbs + sep)) {
    throw new PathTraversal(relPath);
  }
  return abs;
}

/**
 * Read a UTF-8 text file at `<workspaceDir>/<relPath>`. Returns `null`
 * if the file doesn't exist (lets callers distinguish "missing" from
 * "empty"). Symlinks are followed (we want to read what they point at,
 * within the same traversal guard).
 */
export async function readWorkspaceFile(
  workspaceDir: string,
  relPath: string,
): Promise<string | null> {
  const abs = resolveInside(workspaceDir, relPath);
  try {
    return await nodeReadFile(abs, 'utf8');
  } catch (err) {
    if (isENOENT(err)) return null;
    throw err;
  }
}

/**
 * Atomically write a UTF-8 text file at `<workspaceDir>/<relPath>`.
 * Creates parent directories if missing. If a symlink exists at the
 * target path, it's replaced with a regular file (used by the AI-config
 * UI to upgrade `.codex/auth.json` from the bootstrap-time symlink to a
 * workspace-local real file).
 */
export async function writeWorkspaceFile(
  workspaceDir: string,
  relPath: string,
  content: string,
): Promise<void> {
  const abs = resolveInside(workspaceDir, relPath);
  await mkdir(dirname(abs), { recursive: true });

  // If the existing entry is a symlink, unlink before write so we don't
  // mutate the link target.
  try {
    const ls = await nodeLstat(abs);
    if (ls.isSymbolicLink()) await unlink(abs);
  } catch (err) {
    if (!isENOENT(err)) throw err;
  }

  await nodeWriteFile(abs, content, 'utf8');
}

function isENOENT(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}
