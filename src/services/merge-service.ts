/**
 * Three-way SQLite merge for `kauri merge-driver`.
 *
 * Git calls this when two branches both modified `.kauri/store.db`.
 * The merge receives three copies:
 *   - base:   the common ancestor
 *   - ours:   the current branch's version
 *   - theirs: the other branch's version
 *
 * The algorithm:
 *   1. Diff records by ID across the three versions.
 *   2. Records in theirs but not in base → new from their branch → INSERT.
 *   3. Records in ours but not in base → already present → KEEP.
 *   4. Records in both ours and theirs, both changed from base →
 *      last-writer-wins (later `last_modified` timestamp wins).
 *   5. Records only changed in theirs (ours == base) → take theirs.
 *   6. Records deleted in one side → take the deletion (deprecated).
 *   7. Taxonomy → union of both.
 *   8. Meta → prefer ours (project config stays with current branch).
 *   9. record_tags and record_files follow their parent record.
 *
 * The result is written to the "ours" path (git convention: the merge
 * driver overwrites %A with the merged result).
 *
 * Counter numbering: after merge, the next counter is MAX of both
 * sides + 1. IDs are never renumbered — both sides' IDs coexist.
 */
import { Database } from 'bun:sqlite';

import type { RecordRow } from '../store/schema.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TagRow {
  readonly record_id: string;
  readonly tag: string;
}

interface FileRow {
  readonly record_id: string;
  readonly path: string;
  readonly mtime: number;
  readonly size: number;
  readonly sha256: string | null;
}

interface LinkRow {
  readonly from_record_id: string;
  readonly to_record_id: string;
}

interface TaxRow {
  readonly tag: string;
  readonly added: string;
}

export interface MergeResult {
  readonly insertedFromTheirs: number;
  readonly updatedFromTheirs: number;
  readonly renamedIds: readonly RenamedId[];
  readonly taxonomyAdded: number;
}

/** When two branches create the same counter, we re-ID the incoming record. */
export interface RenamedId {
  readonly originalId: string;
  readonly newId: string;
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/**
 * Perform the three-way merge. Reads from all three databases, writes
 * the result into `oursPath` (overwriting it).
 *
 * Precondition: all three files must be valid Kauri stores (migrated
 * to the same schema version).
 */
export function mergeStores(
  basePath: string,
  oursPath: string,
  theirsPath: string,
): MergeResult {
  // Open all three databases read-write. Even though we only READ from
  // base and theirs, we can't use readonly because the .db files carry
  // a WAL journal_mode header from their original store. SQLite in
  // readonly mode can't create the companion WAL file → SQLITE_CANTOPEN.
  // These are git temp files so write access is harmless.
  const base = new Database(basePath);
  base.exec('PRAGMA journal_mode = DELETE');
  const theirs = new Database(theirsPath);
  theirs.exec('PRAGMA journal_mode = DELETE');
  const ours = new Database(oursPath);
  ours.exec('PRAGMA journal_mode = DELETE');
  ours.exec('PRAGMA foreign_keys = ON');

  try {
    return mergeInto(base, ours, theirs);
  } finally {
    base.close();
    theirs.close();
    ours.close();
  }
}

function mergeInto(base: Database, ours: Database, theirs: Database): MergeResult {
  let insertedFromTheirs = 0;
  let updatedFromTheirs = 0;
  const renamedIds: RenamedId[] = [];

  // Index records from each side.
  const baseRecords = allRecords(base);
  const oursRecords = allRecords(ours);
  const theirsRecords = allRecords(theirs);

  const baseIds = new Set(baseRecords.map((r) => r.id));
  const oursIds = new Set(oursRecords.map((r) => r.id));
  const oursMap = new Map(oursRecords.map((r) => [r.id, r]));
  const baseMap = new Map(baseRecords.map((r) => [r.id, r]));

  ours.exec('BEGIN IMMEDIATE');
  try {
    for (const theirRec of theirsRecords) {
      const inBase = baseIds.has(theirRec.id);
      const inOurs = oursIds.has(theirRec.id);

      if (!inBase && !inOurs) {
        // New record from their branch, no conflict → INSERT.
        insertRecord(ours, theirRec);
        copyRecordTags(theirs, ours, theirRec.id);
        copyRecordFiles(theirs, ours, theirRec.id);
        copyRecordLinks(theirs, ours, theirRec.id);
        insertedFromTheirs++;
      } else if (!inBase && inOurs) {
        // **ID collision**: both branches created a record with the same
        // counter from the same base. Re-ID theirs with the next
        // available counter so both records are preserved.
        const newId = nextAvailableId(ours, theirRec);
        const renamedRec = { ...theirRec, id: newId };
        insertRecord(ours, renamedRec);
        // Copy tags/files/links using the ORIGINAL id from theirs DB,
        // but insert them under the NEW id in ours.
        copyRecordTagsRenamed(theirs, ours, theirRec.id, newId);
        copyRecordFilesRenamed(theirs, ours, theirRec.id, newId);
        copyRecordLinksRenamed(theirs, ours, theirRec.id, newId);
        renamedIds.push({ originalId: theirRec.id, newId });
        insertedFromTheirs++;
      } else if (inBase && inOurs) {
        // Record exists in all three — check if theirs is newer.
        const oursRec = oursMap.get(theirRec.id)!;
        const baseRec = baseMap.get(theirRec.id)!;
        if (
          theirRec.last_modified !== baseRec.last_modified &&
          theirRec.last_modified > oursRec.last_modified
        ) {
          replaceRecord(ours, theirRec);
          replaceRecordTags(theirs, ours, theirRec.id);
          replaceRecordFiles(theirs, ours, theirRec.id);
          replaceRecordLinks(theirs, ours, theirRec.id);
          updatedFromTheirs++;
        }
      }
      // inBase && !inOurs: we deleted it → respect our deletion.
      // !inBase && !inOurs with collision handled above.
    }

    // Fix supersedes/superseded_by and link references to renamed IDs.
    for (const rename of renamedIds) {
      fixSupersessionRefs(ours, rename.originalId, rename.newId);
      fixLinkRefs(ours, rename.originalId, rename.newId);
    }

    // Merge taxonomy: union of both sides.
    const taxonomyAdded = mergeTaxonomy(theirs, ours);

    // Rebuild the FTS index for any new/updated records.
    rebuildFts(ours);

    ours.exec('COMMIT');
    return { insertedFromTheirs, updatedFromTheirs, renamedIds, taxonomyAdded };
  } catch (err) {
    ours.exec('ROLLBACK');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Record operations
// ---------------------------------------------------------------------------

function allRecords(db: Database): RecordRow[] {
  return db
    .query<RecordRow, []>(
      `SELECT id, kind, scope, status, title, body, source,
              supersedes, superseded_by, ttl_days, pinned, payload,
              revision, created, last_modified, last_validated
       FROM records`,
    )
    .all();
}

function insertRecord(target: Database, rec: RecordRow): void {
  target
    .query(
      `INSERT OR IGNORE INTO records (
         id, kind, scope, status, title, body, source,
         supersedes, superseded_by, ttl_days, pinned, payload,
         revision, created, last_modified, last_validated
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      rec.id,
      rec.kind,
      rec.scope,
      rec.status,
      rec.title,
      rec.body,
      rec.source,
      rec.supersedes,
      rec.superseded_by,
      rec.ttl_days,
      rec.pinned,
      rec.payload,
      rec.revision,
      rec.created,
      rec.last_modified,
      rec.last_validated,
    );
}

function replaceRecord(target: Database, rec: RecordRow): void {
  target
    .query(
      `UPDATE records SET
         status = ?, title = ?, body = ?, source = ?,
         supersedes = ?, superseded_by = ?, ttl_days = ?, pinned = ?,
         payload = ?, revision = ?, last_modified = ?, last_validated = ?
       WHERE id = ?`,
    )
    .run(
      rec.status,
      rec.title,
      rec.body,
      rec.source,
      rec.supersedes,
      rec.superseded_by,
      rec.ttl_days,
      rec.pinned,
      rec.payload,
      rec.revision,
      rec.last_modified,
      rec.last_validated,
      rec.id,
    );
}

// ---------------------------------------------------------------------------
// ID reassignment for counter collisions
// ---------------------------------------------------------------------------

/**
 * Find the next available ID for a record by scanning the max counter
 * in the target DB. Uses the same INSTR+SUBSTR trick as RecordsRepo.
 */
function nextAvailableId(target: Database, rec: RecordRow): string {
  // Extract the prefix (everything before the last -NNNN).
  const lastDash = rec.id.lastIndexOf('-');
  const prefix = rec.id.slice(0, lastDash); // e.g. "merge-test-DEC"

  // Find the max counter for this prefix pattern.
  const rows = target
    .query<{ id: string }, []>('SELECT id FROM records')
    .all();
  let max = 0;
  for (const row of rows) {
    const rowLastDash = row.id.lastIndexOf('-');
    const rowPrefix = row.id.slice(0, rowLastDash);
    if (rowPrefix === prefix) {
      const n = Number.parseInt(row.id.slice(rowLastDash + 1), 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
  }
  const next = max + 1;
  return `${prefix}-${next.toString().padStart(4, '0')}`;
}

/**
 * After renaming an incoming record's ID, fix any supersedes/superseded_by
 * references that point to the old ID.
 */
function fixSupersessionRefs(db: Database, oldId: string, newId: string): void {
  db.query('UPDATE records SET supersedes = ? WHERE supersedes = ?').run(newId, oldId);
  db.query('UPDATE records SET superseded_by = ? WHERE superseded_by = ?').run(newId, oldId);
}

// ---------------------------------------------------------------------------
// Tags + files
// ---------------------------------------------------------------------------

function copyRecordTags(source: Database, target: Database, recordId: string): void {
  const rows = source
    .query<TagRow, [string]>('SELECT record_id, tag FROM record_tags WHERE record_id = ?')
    .all(recordId);
  for (const row of rows) {
    target
      .query('INSERT OR IGNORE INTO record_tags(record_id, tag) VALUES (?, ?)')
      .run(row.record_id, row.tag);
  }
}

function replaceRecordTags(source: Database, target: Database, recordId: string): void {
  target.query('DELETE FROM record_tags WHERE record_id = ?').run(recordId);
  copyRecordTags(source, target, recordId);
}

function copyRecordFiles(source: Database, target: Database, recordId: string): void {
  const rows = source
    .query<FileRow, [string]>(
      'SELECT record_id, path, mtime, size, sha256 FROM record_files WHERE record_id = ?',
    )
    .all(recordId);
  for (const row of rows) {
    target
      .query(
        'INSERT OR IGNORE INTO record_files(record_id, path, mtime, size, sha256) VALUES (?, ?, ?, ?, ?)',
      )
      .run(row.record_id, row.path, row.mtime, row.size, row.sha256);
  }
}

function replaceRecordFiles(source: Database, target: Database, recordId: string): void {
  target.query('DELETE FROM record_files WHERE record_id = ?').run(recordId);
  copyRecordFiles(source, target, recordId);
}

/** Copy tags from source record to target under a different record ID. */
function copyRecordTagsRenamed(
  source: Database,
  target: Database,
  sourceRecordId: string,
  targetRecordId: string,
): void {
  const rows = source
    .query<TagRow, [string]>('SELECT record_id, tag FROM record_tags WHERE record_id = ?')
    .all(sourceRecordId);
  for (const row of rows) {
    target
      .query('INSERT OR IGNORE INTO record_tags(record_id, tag) VALUES (?, ?)')
      .run(targetRecordId, row.tag);
  }
}

/** Copy files from source record to target under a different record ID. */
function copyRecordFilesRenamed(
  source: Database,
  target: Database,
  sourceRecordId: string,
  targetRecordId: string,
): void {
  const rows = source
    .query<FileRow, [string]>(
      'SELECT record_id, path, mtime, size, sha256 FROM record_files WHERE record_id = ?',
    )
    .all(sourceRecordId);
  for (const row of rows) {
    target
      .query(
        'INSERT OR IGNORE INTO record_files(record_id, path, mtime, size, sha256) VALUES (?, ?, ?, ?, ?)',
      )
      .run(targetRecordId, row.path, row.mtime, row.size, row.sha256);
  }
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

function copyRecordLinks(source: Database, target: Database, recordId: string): void {
  const rows = source
    .query<LinkRow, [string]>(
      'SELECT from_record_id, to_record_id FROM record_links WHERE from_record_id = ?',
    )
    .all(recordId);
  for (const row of rows) {
    target
      .query('INSERT OR IGNORE INTO record_links(from_record_id, to_record_id) VALUES (?, ?)')
      .run(row.from_record_id, row.to_record_id);
  }
}

function replaceRecordLinks(source: Database, target: Database, recordId: string): void {
  target.query('DELETE FROM record_links WHERE from_record_id = ?').run(recordId);
  copyRecordLinks(source, target, recordId);
}

function copyRecordLinksRenamed(
  source: Database,
  target: Database,
  sourceRecordId: string,
  targetRecordId: string,
): void {
  const rows = source
    .query<LinkRow, [string]>(
      'SELECT from_record_id, to_record_id FROM record_links WHERE from_record_id = ?',
    )
    .all(sourceRecordId);
  for (const row of rows) {
    target
      .query('INSERT OR IGNORE INTO record_links(from_record_id, to_record_id) VALUES (?, ?)')
      .run(targetRecordId, row.to_record_id);
  }
}

/**
 * After renaming an incoming record's ID, fix any link references that
 * point to the old ID (as a target).
 */
function fixLinkRefs(db: Database, oldId: string, newId: string): void {
  db.query('UPDATE record_links SET to_record_id = ? WHERE to_record_id = ?').run(newId, oldId);
  db.query('UPDATE record_links SET from_record_id = ? WHERE from_record_id = ?').run(newId, oldId);
}

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

function mergeTaxonomy(source: Database, target: Database): number {
  const sourceTags = source.query<TaxRow, []>('SELECT tag, added FROM taxonomy').all();
  let added = 0;
  for (const row of sourceTags) {
    const exists = target
      .query<{ tag: string }, [string]>('SELECT tag FROM taxonomy WHERE tag = ?')
      .get(row.tag);
    if (exists === null) {
      target.query('INSERT INTO taxonomy(tag, added) VALUES (?, ?)').run(row.tag, row.added);
      added++;
    }
  }
  return added;
}

// ---------------------------------------------------------------------------
// FTS rebuild
// ---------------------------------------------------------------------------

/**
 * Rebuild the FTS5 index by deleting all entries and re-inserting from
 * the records table. This is the safest approach after a merge — the
 * triggers only fire on INSERT/UPDATE/DELETE against records, and our
 * merge uses INSERT OR IGNORE / UPDATE which may not trigger correctly
 * for the FTS external-content table.
 */
function rebuildFts(db: Database): void {
  // The 'rebuild' command is a special FTS5 feature that reconstructs
  // the index from the content table.
  db.exec("INSERT INTO records_fts(records_fts) VALUES('rebuild')");
}
