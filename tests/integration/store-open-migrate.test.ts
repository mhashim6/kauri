/**
 * Integration tests for the storage foundation:
 *  - Store.openAt creates the parent directory
 *  - Migration 0001 produces the expected schema (tables, indexes, FTS5,
 *    triggers, seed rows)
 *  - PRAGMA user_version is bumped and meta.schema_version is written
 *  - ensureMigrated is idempotent on a second open
 *  - schema_ahead detection rejects a store with a higher user_version
 *  - WAL mode is enabled
 *  - Store.tx commits and rolls back correctly
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { KauriError } from '../../src/core/errors.ts';
import {
  currentVersion,
  ensureMigrated,
  latestVersion,
  loadMigrations,
} from '../../src/store/migrations.ts';
import { Store } from '../../src/store/store.ts';
import { makeTmpStore, type TmpStore } from '../helpers/tmp-store.ts';

let tmp: TmpStore;

afterEach(() => {
  tmp?.cleanup();
});

// ---------------------------------------------------------------------------
// Schema creation
// ---------------------------------------------------------------------------

describe('Store.openAt + migration 0001', () => {
  beforeEach(() => {
    tmp = makeTmpStore();
  });

  test('creates the records table with expected columns', () => {
    const cols = tmp.store.db.query<{ name: string }, []>("PRAGMA table_info('records')").all();
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        'id',
        'kind',
        'scope',
        'status',
        'title',
        'body',
        'source',
        'supersedes',
        'superseded_by',
        'ttl_days',
        'pinned',
        'payload',
        'revision',
        'created',
        'last_modified',
        'last_validated',
      ].sort(),
    );
  });

  test('creates record_tags, record_files, taxonomy, and meta tables', () => {
    const tables = tmp.store.db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all()
      .map((r) => r.name);
    expect(tables).toContain('records');
    expect(tables).toContain('record_tags');
    expect(tables).toContain('record_files');
    expect(tables).toContain('record_links');
    expect(tables).toContain('taxonomy');
    expect(tables).toContain('meta');
    expect(tables).toContain('records_fts');
  });

  test('creates the expected indexes', () => {
    const indexes = tmp.store.db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'",
      )
      .all()
      .map((r) => r.name)
      .sort();
    expect(indexes).toEqual(
      [
        'idx_records_status',
        'idx_records_kind',
        'idx_records_pinned',
        'idx_record_tags_tag',
        'idx_record_files_path',
        'idx_record_links_to',
      ].sort(),
    );
  });

  test('creates the FTS5 sync triggers', () => {
    const triggers = tmp.store.db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='trigger'")
      .all()
      .map((r) => r.name)
      .sort();
    expect(triggers).toEqual(['records_ad', 'records_ai', 'records_au']);
  });

  test('seeds default meta values from the migration SQL', () => {
    const rows = tmp.store.db
      .query<{ key: string; value: string }, []>('SELECT key, value FROM meta')
      .all();
    const map = new Map(rows.map((r) => [r.key, r.value]));
    expect(map.get('default_ttl_days')).toBe('90');
    expect(map.get('pin_soft_cap')).toBe('10');
    expect(map.get('file_hash_size_cap_bytes')).toBe('1048576');
  });

  test('migration runner writes meta.schema_version', () => {
    const row = tmp.store.db
      .query<{ value: string }, [string]>('SELECT value FROM meta WHERE key = ?')
      .get('schema_version');
    expect(row?.value).toBe(String(latestVersion()));
  });

  test('PRAGMA user_version reflects the latest migration', () => {
    expect(currentVersion(tmp.store.db)).toBe(latestVersion());
  });

  test('records.scope CHECK constraint rejects bogus values', () => {
    expect(() => {
      tmp.store.db.exec(`
        INSERT INTO records (id, kind, scope, status, title, body, source, created, last_modified, last_validated)
        VALUES ('x-DEC-0001', 'decision', 'martian', 'active', 't', 'b', 'manual', '', '', '')
      `);
    }).toThrow();
  });

  test('records.status CHECK constraint rejects bogus values', () => {
    expect(() => {
      tmp.store.db.exec(`
        INSERT INTO records (id, kind, scope, status, title, body, source, created, last_modified, last_validated)
        VALUES ('x-DEC-0002', 'decision', 'project', 'pending', 't', 'b', 'manual', '', '', '')
      `);
    }).toThrow();
  });
});

// ---------------------------------------------------------------------------
// FTS5 round trip via the sync triggers
// ---------------------------------------------------------------------------

describe('records_fts triggers', () => {
  beforeEach(() => {
    tmp = makeTmpStore();
  });

  function insertRecord(id: string, title: string, body: string): void {
    tmp.store.db
      .query<unknown, [string, string, string]>(
        `INSERT INTO records
           (id, kind, scope, status, title, body, source, created, last_modified, last_validated)
         VALUES (?, 'decision', 'project', 'active', ?, ?, 'manual', '', '', '')`,
      )
      .run(id, title, body);
  }

  test('insert into records populates the FTS index', () => {
    insertRecord('kauri-DEC-0001', 'JWT refresh tokens', 'Use JWT with 15 minute access tokens.');
    const hits = tmp.store.db
      .query<{ id: string }, [string]>(
        `SELECT records.id FROM records JOIN records_fts ON records.rowid = records_fts.rowid
         WHERE records_fts MATCH ?`,
      )
      .all('JWT');
    expect(hits.map((h) => h.id)).toContain('kauri-DEC-0001');
  });

  test('update to body is reflected in the FTS index', () => {
    insertRecord('kauri-DEC-0002', 'Initial', 'old content');
    tmp.store.db
      .query<unknown, [string, string]>('UPDATE records SET body = ? WHERE id = ?')
      .run('rate limiting policy', 'kauri-DEC-0002');
    const hits = tmp.store.db
      .query<{ id: string }, [string]>(
        `SELECT records.id FROM records JOIN records_fts ON records.rowid = records_fts.rowid
         WHERE records_fts MATCH ?`,
      )
      .all('rate');
    expect(hits.map((h) => h.id)).toContain('kauri-DEC-0002');
  });

  test('delete from records removes the row from the FTS index', () => {
    insertRecord('kauri-DEC-0003', 'doomed', 'about to vanish');
    tmp.store.db.query<unknown, [string]>('DELETE FROM records WHERE id = ?').run('kauri-DEC-0003');
    const hits = tmp.store.db
      .query<{ id: string }, [string]>(
        `SELECT records.id FROM records JOIN records_fts ON records.rowid = records_fts.rowid
         WHERE records_fts MATCH ?`,
      )
      .all('vanish');
    expect(hits).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// On-disk store tests (real WAL files, real path)
// ---------------------------------------------------------------------------

describe('Store.openAt — on-disk', () => {
  beforeEach(() => {
    tmp = makeTmpStore({ inMemory: false });
  });

  test('creates the .kauri parent directory if missing', () => {
    expect(existsSync(join(tmp.dir, '.kauri'))).toBe(true);
    expect(existsSync(tmp.store.path)).toBe(true);
  });

  test('enables WAL journal mode', () => {
    const row = tmp.store.db.query<{ journal_mode: string }, []>('PRAGMA journal_mode').get();
    expect(row?.journal_mode).toBe('wal');
  });

  test('reopening an existing store is idempotent (no second migration)', () => {
    const path = tmp.store.path;
    tmp.store.close();
    const reopened = Store.openAt(path, 'project');
    try {
      expect(currentVersion(reopened.db)).toBe(latestVersion());
      // Seeds are still there from the original migration, not duplicated.
      const ttl = reopened.db
        .query<{ value: string }, [string]>('SELECT value FROM meta WHERE key = ?')
        .get('default_ttl_days');
      expect(ttl?.value).toBe('90');
    } finally {
      reopened.close();
    }
  });
});

// ---------------------------------------------------------------------------
// schema_ahead detection
// ---------------------------------------------------------------------------

describe('ensureMigrated — schema_ahead', () => {
  test('throws KauriError(schema_ahead) when user_version exceeds latest', () => {
    tmp = makeTmpStore();
    // Bump user_version past the latest migration we know about.
    const future = latestVersion() + 99;
    tmp.store.db.exec(`PRAGMA user_version = ${future}`);
    expect(() => ensureMigrated(tmp.store.db)).toThrow(KauriError);
    try {
      ensureMigrated(tmp.store.db);
    } catch (e) {
      expect((e as KauriError).code).toBe('schema_ahead');
    }
  });
});

// ---------------------------------------------------------------------------
// Migration rollback on failure
// ---------------------------------------------------------------------------

describe('ensureMigrated — rollback on failure', () => {
  test('rolls back when a migration SQL statement fails', () => {
    tmp = makeTmpStore();
    // Force a re-run of migration 1 by rewinding user_version.
    // The CREATE TABLE statements in 0001 will then fail because the
    // tables already exist, and the runner should ROLLBACK without
    // leaving the user_version bumped.
    tmp.store.db.exec('PRAGMA user_version = 0');
    expect(() => ensureMigrated(tmp.store.db)).toThrow();
    // After rollback, user_version is whatever it was before BEGIN.
    expect(currentVersion(tmp.store.db)).toBe(0);
    // Original tables (from the first run) are still present — they
    // were committed in a separate transaction, so the rollback of
    // the failed re-run can't touch them.
    const tables = tmp.store.db
      .query<
        { name: string },
        []
      >("SELECT name FROM sqlite_master WHERE type='table' AND name='records'")
      .all();
    expect(tables).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// loadMigrations / latestVersion sanity
// ---------------------------------------------------------------------------

describe('migration metadata', () => {
  test('loadMigrations returns at least one migration', () => {
    expect(loadMigrations().length).toBeGreaterThanOrEqual(1);
  });

  test('migrations are ordered ascending by version', () => {
    const versions = loadMigrations().map((m) => m.version);
    const sorted = [...versions].sort((a, b) => a - b);
    expect(versions).toEqual(sorted);
  });

  test('latestVersion matches the last entry in loadMigrations', () => {
    const list = loadMigrations();
    const lastVersion = list[list.length - 1]?.version ?? 0;
    expect(latestVersion()).toBe(lastVersion);
  });
});

// ---------------------------------------------------------------------------
// Store.tx
// ---------------------------------------------------------------------------

describe('Store.tx', () => {
  beforeEach(() => {
    tmp = makeTmpStore();
  });

  test('commits successful transactions', () => {
    tmp.store.tx(() => {
      tmp.store.db.exec(`INSERT INTO meta(key, value) VALUES ('test_commit', 'yes')`);
    });
    const row = tmp.store.db
      .query<{ value: string }, [string]>('SELECT value FROM meta WHERE key = ?')
      .get('test_commit');
    expect(row?.value).toBe('yes');
  });

  test('rolls back transactions that throw', () => {
    expect(() =>
      tmp.store.tx(() => {
        tmp.store.db.exec(`INSERT INTO meta(key, value) VALUES ('test_rollback', 'yes')`);
        throw new Error('intentional');
      }),
    ).toThrow('intentional');
    const row = tmp.store.db
      .query<{ value: string }, [string]>('SELECT value FROM meta WHERE key = ?')
      .get('test_rollback');
    expect(row).toBeNull();
  });

  test('returns the value produced by the callback', () => {
    const result = tmp.store.tx(() => 42);
    expect(result).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// Store.exec
// ---------------------------------------------------------------------------

describe('Store.exec', () => {
  test('runs raw SQL against the underlying connection', () => {
    tmp = makeTmpStore();
    tmp.store.exec(`INSERT INTO meta(key, value) VALUES ('exec_test', 'present')`);
    const row = tmp.store.db
      .query<{ value: string }, [string]>('SELECT value FROM meta WHERE key = ?')
      .get('exec_test');
    expect(row?.value).toBe('present');
  });
});

// ---------------------------------------------------------------------------
// Store.close idempotency
// ---------------------------------------------------------------------------

describe('Store.close', () => {
  test('is idempotent', () => {
    const t = makeTmpStore();
    t.store.close();
    expect(() => t.store.close()).not.toThrow();
    t.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Store.openInMemory factory
// ---------------------------------------------------------------------------

describe('Store.openInMemory', () => {
  test('creates a usable in-memory store with default scope', () => {
    const s = Store.openInMemory();
    try {
      expect(s.scope).toBe('project');
      expect(s.path).toBe(':memory:');
      expect(currentVersion(s.db)).toBe(latestVersion());
    } finally {
      s.close();
    }
  });

  test('accepts an explicit scope', () => {
    const s = Store.openInMemory('user');
    try {
      expect(s.scope).toBe('user');
    } finally {
      s.close();
    }
  });
});
