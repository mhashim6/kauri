/**
 * Filesystem path resolution for Kauri stores.
 *
 * Two-store model (per the v0.1 spec § Scope):
 *
 *   - Project store: `<project_root>/.kauri/store.db`. The project root
 *     is found by walking upward from the current working directory
 *     until we find an existing `.kauri/store.db` (same convention as
 *     `.git`). The walk stops at the filesystem root if no store is
 *     found, returning `null`.
 *
 *   - User store: `~/.kauri/store.db`. Always lives in the user's home
 *     directory regardless of CWD. Created lazily on first
 *     user-scoped write.
 *
 * Per the module-boundary rules, this file imports nothing from
 * services, cli, or mcp. Filesystem APIs are imported from `node:*`,
 * which is allowed for the `store/*` layer.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** Directory name used for both project and user stores. */
export const KAURI_DIR = '.kauri';

/** Filename used for the SQLite database in both scopes. */
export const STORE_FILENAME = 'store.db';

/**
 * Walk upward from `startDir` looking for an existing
 * `<dir>/.kauri/store.db`. Returns the absolute path to the store
 * file when found, or `null` when the walk reaches the filesystem
 * root without a hit.
 */
export function findProjectStorePath(startDir: string): string | null {
  // The loop terminates because every filesystem walk eventually
  // reaches a directory that is its own parent (`/` on POSIX,
  // `C:\` on Windows).
  let current = resolve(startDir);
  for (;;) {
    const candidate = join(current, KAURI_DIR, STORE_FILENAME);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

/**
 * Construct the project store path for a given project root, without
 * checking whether the file exists. Used by `kauri init` to decide
 * where to create a new store.
 */
export function projectStorePathFor(projectRoot: string): string {
  return join(resolve(projectRoot), KAURI_DIR, STORE_FILENAME);
}

/**
 * Absolute path to the user-scope store. Resolves `~` once at call
 * time so tests can manipulate `HOME` to point at a temp directory.
 */
export function userStorePath(): string {
  return join(homedir(), KAURI_DIR, STORE_FILENAME);
}

/**
 * Ensure the parent directory of `filePath` exists, creating it
 * (and any intermediate directories) if necessary. Idempotent.
 *
 * Used immediately before opening or creating a store file so that
 * `bun:sqlite` doesn't fail on a missing `.kauri/` directory.
 */
export function ensureParentDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}
