/**
 * Migration runner.
 *
 * Each Kauri store carries its current schema version in `PRAGMA
 * user_version`. On every store open, `ensureMigrated` compares that
 * value against the highest version known to this binary and applies
 * any pending migrations in order, each in its own BEGIN IMMEDIATE
 * transaction. Migrations are forward-only — there is no automatic
 * rollback path. Users restoring a corrupted store should restore from
 * a backup.
 *
 * The full migration list lives in `migrations-data.ts`, which is
 * generated from `migrations/*.sql` by `scripts/embed-migrations.ts`.
 * That keeps the SQL files as the source of truth and lets
 * `bun build --compile` embed them into the standalone binary via
 * text imports.
 */
import type { Database } from 'bun:sqlite';

import { KauriError } from '../core/errors.ts';

import { MIGRATIONS, type Migration } from './migrations-data.ts';

/** Returns the embedded migration list, ordered by version ascending. */
export function loadMigrations(): readonly Migration[] {
  return MIGRATIONS;
}

/**
 * Returns the highest schema version known to this binary. The
 * codegen guarantees MIGRATIONS is non-empty for any shipped build,
 * so the optional-chain fallback to 0 is just defensive — it would
 * only matter if `embed-migrations.ts` were re-run with no SQL files.
 */
export function latestVersion(): number {
  return MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0;
}

/**
 * Read the current `PRAGMA user_version` value. A fresh database
 * returns 0, indicating no migrations have been applied.
 */
export function currentVersion(db: Database): number {
  // bun:sqlite returns rows as objects keyed by the column name.
  const row = db.query('PRAGMA user_version').get() as { user_version: number } | null;
  if (row === null || typeof row.user_version !== 'number') {
    return 0;
  }
  return row.user_version;
}

/**
 * Compare the store's schema version against the binary's expected
 * version and apply any pending migrations. Throws on a store that's
 * newer than this binary supports — the user must upgrade Kauri.
 *
 * Idempotent: calling this on an up-to-date store is a no-op.
 */
export function ensureMigrated(db: Database): void {
  const current = currentVersion(db);
  const latest = latestVersion();

  if (current === latest) {
    return;
  }
  if (current > latest) {
    throw new KauriError(
      'schema_ahead',
      `store schema is at version ${current} but this binary supports up to ${latest}; please upgrade Kauri`,
      { storeVersion: current, binaryVersion: latest },
    );
  }

  const pending = MIGRATIONS.filter((m) => m.version > current);
  for (const migration of pending) {
    applyMigration(db, migration);
  }
}

/**
 * Apply a single migration inside a BEGIN IMMEDIATE transaction.
 *
 * The transaction does three things atomically:
 *  1. Run the migration SQL.
 *  2. Bump `PRAGMA user_version` to the migration's version.
 *  3. Write `meta.schema_version` (belt-and-suspenders for debugging
 *     and so the version is visible to plain SELECTs).
 *
 * On failure, ROLLBACK leaves the store in its prior state and the
 * thrown error propagates to the caller.
 */
function applyMigration(db: Database, migration: Migration): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(migration.sql);
    // PRAGMA does not accept bound parameters; the version number is
    // an integer from our own constants table, so this is not an
    // injection vector.
    db.exec(`PRAGMA user_version = ${migration.version}`);
    db.query('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)').run(
      'schema_version',
      String(migration.version),
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
