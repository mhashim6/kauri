/**
 * `record_files` repo — the storage side of file associations.
 *
 * This repo is intentionally narrow: it knows how to read, replace,
 * and patch the rows in the `record_files` junction table, and that's
 * it. It does NOT read the actual file contents, compute hashes, or
 * check for staleness. Those concerns live in `src/fs/` (probes) and
 * the staleness service (orchestration).
 *
 * The split exists for two reasons:
 *  1. Tests can drive the repo with synthetic `FileAssoc` values
 *     without ever touching the disk.
 *  2. The boundary between "what's stored" and "what's on disk" is
 *     where staleness lives — keeping them separate makes the
 *     comparison logic easy to reason about.
 *
 * Per the module-boundary rules, this file may import from `core/*`
 * and `bun:sqlite`.
 */
import type { Database, Statement } from 'bun:sqlite';

import type { FileAssoc } from '../../core/types.ts';
import { fileRowToAssoc, type RecordFileRow } from '../schema.ts';

interface RecordIdRow {
  readonly record_id: string;
}

export class FilesRepo {
  private readonly listStmt: Statement<RecordFileRow, [string]>;
  private readonly clearStmt: Statement<unknown, [string]>;
  private readonly insertStmt: Statement<unknown, [string, string, number, number, string | null]>;
  private readonly touchMtimeStmt: Statement<unknown, [number, string, string]>;
  private readonly idsByPathStmt: Statement<RecordIdRow, [string]>;

  constructor(db: Database) {
    this.listStmt = db.query<RecordFileRow, [string]>(
      'SELECT record_id, path, mtime, size, sha256 FROM record_files WHERE record_id = ? ORDER BY path ASC',
    );
    this.clearStmt = db.query<unknown, [string]>(
      'DELETE FROM record_files WHERE record_id = ?',
    );
    this.insertStmt = db.query<unknown, [string, string, number, number, string | null]>(
      'INSERT INTO record_files(record_id, path, mtime, size, sha256) VALUES (?, ?, ?, ?, ?)',
    );
    this.touchMtimeStmt = db.query<unknown, [number, string, string]>(
      'UPDATE record_files SET mtime = ? WHERE record_id = ? AND path = ?',
    );
    this.idsByPathStmt = db.query<RecordIdRow, [string]>(
      'SELECT DISTINCT record_id FROM record_files WHERE path = ?',
    );
  }

  /**
   * Return all file associations for a record, ordered by path so
   * the result is deterministic across runs (matters for snapshot
   * tests and projection output).
   */
  public list(recordId: string): readonly FileAssoc[] {
    return this.listStmt.all(recordId).map(fileRowToAssoc);
  }

  /**
   * Replace the file set for `recordId`. Deletes any existing rows,
   * then inserts the new ones. Caller must wrap in a transaction
   * when atomicity matters — the records repo's `insert` and
   * `update` paths already do this.
   *
   * Files are de-duplicated by path before insert (last writer wins
   * within the input array) and inserted in lexicographic path order
   * so the row layout is deterministic.
   */
  public replace(recordId: string, files: readonly FileAssoc[]): void {
    this.clearStmt.run(recordId);
    if (files.length === 0) {
      return;
    }
    const dedupedByPath = new Map<string, FileAssoc>();
    for (const f of files) {
      dedupedByPath.set(f.path, f);
    }
    const sorted = [...dedupedByPath.values()].sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    );
    for (const f of sorted) {
      this.insertStmt.run(recordId, f.path, f.mtime, f.size, f.sha256);
    }
  }

  /**
   * Update the stored mtime for one path under one record without
   * touching the size or hash. Used by the staleness fast-path drift
   * case (mtime changed, hash matched, so refresh the baseline mtime
   * to skip future hash work). No-op when the row doesn't exist.
   */
  public touchMtime(recordId: string, path: string, newMtime: number): void {
    this.touchMtimeStmt.run(newMtime, recordId, path);
  }

  /**
   * Return all record IDs that reference `path` in their file set.
   * Used by the records repo to apply file filters in `query`.
   */
  public idsByPath(path: string): readonly string[] {
    return this.idsByPathStmt.all(path).map((r) => r.record_id);
  }
}
