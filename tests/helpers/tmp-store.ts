/**
 * Per-test temp store helper.
 *
 * Layer-2 (integration) tests need a fresh, fully-migrated SQLite store
 * with no shared state. `makeTmpStore` returns a Store backed by a unique
 * temp directory plus a `cleanup` callback to call from `afterEach`.
 *
 * The implementation prefers in-memory SQLite for speed when the test
 * doesn't care about a real path; pass `{ inMemory: false }` if you need
 * an on-disk file (e.g. for concurrency / WAL tests).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Store } from '../../src/store/store.ts';
import type { Scope } from '../../src/core/types.ts';

export interface TmpStore {
  readonly store: Store;
  readonly dir: string;
  /** Closes the store and removes its temp directory. Idempotent. */
  readonly cleanup: () => void;
}

export interface TmpStoreOptions {
  /** Defaults to `'project'`. */
  readonly scope?: Scope;
  /**
   * When `true` (the default), uses an in-memory SQLite database for
   * speed. When `false`, creates a real `.db` file under the temp dir
   * — needed for tests exercising WAL files, mtime probes, or
   * cross-process concurrency.
   */
  readonly inMemory?: boolean;
}

/**
 * Build a fresh temp store. The caller MUST invoke `cleanup` (typically
 * from `afterEach`) to free the SQLite handle and remove the temp dir.
 *
 * Each call returns a unique temp directory under `os.tmpdir()/kauri-test-*`
 * so tests are safe to parallelise.
 */
export function makeTmpStore(opts: TmpStoreOptions = {}): TmpStore {
  const scope: Scope = opts.scope ?? 'project';
  const inMemory = opts.inMemory ?? true;

  const dir = mkdtempSync(join(tmpdir(), 'kauri-test-'));
  const path = inMemory ? ':memory:' : join(dir, '.kauri', 'store.db');
  const store = Store.openAt(path, scope);

  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    try {
      store.close();
    } catch {
      // Already closed; ignore.
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; tmp dirs get GC'd by the OS eventually.
    }
  };

  return { store, dir, cleanup };
}
