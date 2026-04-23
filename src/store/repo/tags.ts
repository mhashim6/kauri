/**
 * Tag-related repos.
 *
 * Two related repos in one file because they share the same dependency
 * (the `taxonomy` table) and the same set of helper queries:
 *
 *   - `TaxonomyRepo` owns the controlled vocabulary itself: list,
 *     existence checks, and additions. It re-validates every input
 *     through `normalizeTag` so the database can never end up with a
 *     malformed or reserved tag.
 *
 *   - `RecordTagsRepo` owns the junction table that links records to
 *     tags. The repo only knows about already-validated tags — the
 *     service layer is responsible for normalising and (when
 *     `allow_new_tags` is set) adding new tags via `TaxonomyRepo`
 *     before calling `set`.
 *
 * Per the module-boundary rules, this file may import from `core/*`
 * and `bun:sqlite`.
 */
import type { Database, Statement } from 'bun:sqlite';

import { KauriError } from '../../core/errors.ts';
import { normalizeTag } from '../../core/tags.ts';

// ---------------------------------------------------------------------------
// TaxonomyRepo
// ---------------------------------------------------------------------------

interface TagRow {
  readonly tag: string;
}

export class TaxonomyRepo {
  private readonly listStmt: Statement<TagRow, []>;
  private readonly hasStmt: Statement<TagRow, [string]>;
  private readonly insertStmt: Statement<unknown, [string, string]>;

  constructor(db: Database) {
    this.listStmt = db.query<TagRow, []>('SELECT tag FROM taxonomy ORDER BY tag ASC');
    this.hasStmt = db.query<TagRow, [string]>('SELECT tag FROM taxonomy WHERE tag = ?');
    this.insertStmt = db.query<unknown, [string, string]>(
      'INSERT OR IGNORE INTO taxonomy(tag, added) VALUES (?, ?)',
    );
  }

  /** All known tags, alphabetically sorted. */
  public list(): readonly string[] {
    return this.listStmt.all().map((r) => r.tag);
  }

  /**
   * `true` when the tag exists in the taxonomy. The input is
   * normalised before lookup so callers don't need to.
   */
  public has(rawTag: string): boolean {
    const normalized = normalizeTag(rawTag);
    return this.hasStmt.get(normalized) !== null;
  }

  /**
   * Add `rawTag` to the taxonomy if it isn't already present.
   * Re-validates through `normalizeTag` (rejects reserved values and
   * empty results). Returns `true` when a row was inserted, `false`
   * when the tag already existed.
   *
   * `addedAt` is the ISO 8601 timestamp recorded against the new row.
   * Centralising this here lets the caller provide a single moment
   * for a batch insert (e.g. seeding the default taxonomy at init).
   */
  public add(rawTag: string, addedAt: string): boolean {
    const tag = normalizeTag(rawTag);
    const before = this.hasStmt.get(tag) !== null;
    this.insertStmt.run(tag, addedAt);
    return !before;
  }

  /**
   * Convenience for seeding many tags at once. Each tag is normalised
   * and any reserved value throws — the caller's transaction will
   * roll back. Returns the list of tags actually added (excluding
   * tags that already existed).
   */
  public addMany(rawTags: readonly string[], addedAt: string): readonly string[] {
    const added: string[] = [];
    for (const rawTag of rawTags) {
      if (this.add(rawTag, addedAt)) {
        added.push(normalizeTag(rawTag));
      }
    }
    return added;
  }
}

// ---------------------------------------------------------------------------
// RecordTagsRepo
// ---------------------------------------------------------------------------

interface RecordIdRow {
  readonly record_id: string;
}

export class RecordTagsRepo {
  private readonly tagsForStmt: Statement<TagRow, [string]>;
  private readonly clearStmt: Statement<unknown, [string]>;
  private readonly insertStmt: Statement<unknown, [string, string]>;
  private readonly idsByTagStmt: Statement<RecordIdRow, [string]>;

  constructor(db: Database) {
    this.tagsForStmt = db.query<TagRow, [string]>(
      'SELECT tag FROM record_tags WHERE record_id = ? ORDER BY tag ASC',
    );
    this.clearStmt = db.query<unknown, [string]>('DELETE FROM record_tags WHERE record_id = ?');
    this.insertStmt = db.query<unknown, [string, string]>(
      'INSERT INTO record_tags(record_id, tag) VALUES (?, ?)',
    );
    this.idsByTagStmt = db.query<RecordIdRow, [string]>(
      'SELECT DISTINCT record_id FROM record_tags WHERE tag = ?',
    );
  }

  /** All tags currently associated with `recordId`, alphabetically. */
  public tagsFor(recordId: string): readonly string[] {
    return this.tagsForStmt.all(recordId).map((r) => r.tag);
  }

  /**
   * Replace the tag set for `recordId`. The supplied tags MUST already
   * exist in the taxonomy — failure of the foreign key here indicates
   * a service-layer bug (the service should add unknown tags via
   * `TaxonomyRepo.add` before calling this method).
   *
   * Caller must wrap this in a transaction if atomicity matters.
   * The set is sorted and de-duplicated before insertion so the row
   * order in the junction is deterministic.
   */
  public set(recordId: string, tags: readonly string[]): void {
    this.clearStmt.run(recordId);
    if (tags.length === 0) {
      return;
    }
    // Sort + dedupe so output ordering is deterministic and we don't
    // hit the PRIMARY KEY (record_id, tag) constraint on duplicates.
    const unique = [...new Set(tags)].sort();
    for (const tag of unique) {
      try {
        this.insertStmt.run(recordId, tag);
      } catch (err) {
        throw new KauriError(
          'invalid_input',
          `failed to associate tag '${tag}' with record '${recordId}': tag is not in taxonomy`,
          { cause: err },
        );
      }
    }
  }

  /**
   * Return all record IDs that carry `tag`. Used by the records repo
   * to apply tag filters in `query`.
   */
  public idsByTag(tag: string): readonly string[] {
    return this.idsByTagStmt.all(tag).map((r) => r.record_id);
  }
}
