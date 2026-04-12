/**
 * `Store` — the single object that owns a `bun:sqlite` connection.
 *
 * Every higher-level repo and service receives a `Store` rather than a
 * raw `Database`. The `Store` is responsible for:
 *
 *   - applying the same PRAGMAs on every open (WAL, foreign keys,
 *     synchronous = NORMAL, busy_timeout),
 *   - running `ensureMigrated` so the schema is current before any
 *     repo runs a query,
 *   - exposing a `tx<T>` helper that wraps a callback in a
 *     `BEGIN IMMEDIATE` writer transaction (the spec's chosen
 *     concurrency model — see `kauri-spec.md` § Implementation Notes ›
 *     Concurrency).
 *
 * The `Store` does *not* know which scope it represents in the source
 * of truth sense — `scope` is a tag carried alongside the connection so
 * the merge logic in `multi-store.ts` (Phase C) can label rows
 * correctly when reading from both project and user stores.
 *
 * Per the module-boundary rules, this file may import `bun:sqlite`
 * because it lives under `src/store/**`. CLI/MCP code must go through
 * services, not Store directly.
 */
import { Database } from 'bun:sqlite';

import type { Scope } from '../core/types.ts';

import { ensureMigrated } from './migrations.ts';
import { ensureParentDir } from './paths.ts';

export class Store {
  /** Underlying bun:sqlite handle. Exposed to repo classes only. */
  public readonly db: Database;
  /** Which scope this store represents. Tag, not enforcement. */
  public readonly scope: Scope;
  /** Absolute path to the SQLite file. `:memory:` for in-memory stores. */
  public readonly path: string;

  private closed = false;

  private constructor(db: Database, scope: Scope, path: string) {
    this.db = db;
    this.scope = scope;
    this.path = path;
  }

  /**
   * Open (or create) the store at `path`, applying our standard
   * PRAGMAs and running any pending migrations. The parent directory
   * is created if it doesn't exist.
   *
   * For an in-memory store, pass `':memory:'` as the path. The parent
   * directory step is skipped.
   */
  public static openAt(path: string, scope: Scope): Store {
    if (path !== ':memory:') {
      ensureParentDir(path);
    }
    const db = new Database(path, { create: true });
    applyPragmas(db);
    ensureMigrated(db);
    return new Store(db, scope, path);
  }

  /** Convenience: open an in-memory store. Used by tests. */
  public static openInMemory(scope: Scope = 'project'): Store {
    return Store.openAt(':memory:', scope);
  }

  /**
   * Close the underlying connection. Idempotent — calling close on an
   * already-closed store is a no-op so callers don't need to track
   * lifecycle state.
   */
  public close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.db.close();
  }

  /** Run an arbitrary SQL string with no parameters. Mostly for tests and migrations. */
  public exec(sql: string): void {
    this.db.exec(sql);
  }

  /**
   * Run `fn` inside a `BEGIN IMMEDIATE` transaction. The IMMEDIATE
   * variant takes the writer lock up front, which is what we want for
   * counter-read-then-insert sequences (see `RecordsRepo.insert`,
   * Phase C). Returns the value produced by `fn`. Re-throws on error,
   * after rolling back.
   *
   * Nesting is not supported in v0.1 — call sites should compose by
   * passing the existing transaction context as a parameter rather
   * than nesting `tx` calls.
   */
  public tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}

/**
 * Set the PRAGMAs we want on every connection. Kept in a top-level
 * function so the migration runner's tests can spin up a bare
 * `Database` with the same setup if they need to.
 */
function applyPragmas(db: Database): void {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
}
