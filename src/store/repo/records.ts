/**
 * `records` repo — the central CRUD + query path for Kauri records.
 *
 * Responsibilities:
 *  - Insert: generate the next per-(scope, kind) counter atomically with
 *    the row insert (caller wraps the call in a transaction).
 *  - Update scalar fields with revision bump.
 *  - Pin / unpin (no revision bump).
 *  - Mark validated (sets last_validated, no revision bump).
 *  - Set status / link supersession.
 *  - Look up rows by ID.
 *  - Run filtered queries (status / tags / files / text / since).
 *  - Walk supersession chains.
 *  - Tiny aggregations for the `status` command.
 *
 * The repo holds references to `RecordTagsRepo` and `FilesRepo` so the
 * hydration path (`findById`, `query`) can return fully-formed
 * `KauriRecord`s without forcing the service layer to do the joins.
 *
 * Per the module-boundary rules, this file may import from `core/*`,
 * other files in `store/*`, and `bun:sqlite`.
 */
import type { Database, Statement } from 'bun:sqlite';

import { KIND_PREFIX } from '../../core/constants.ts';
import { KauriError } from '../../core/errors.ts';
import { buildFtsMatchQuery } from '../../core/fts.ts';
import { formatId, kindPrefix, parseId } from '../../core/ids.ts';
import type { KauriRecord, Kind, Scope, Status } from '../../core/types.ts';
import { pinnedToInt, type RecordRow, rowToRecord } from '../schema.ts';

import type { FilesRepo } from './files.ts';
import type { RecordLinksRepo } from './links.ts';
import type { RecordTagsRepo } from './tags.ts';

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

/** Everything the repo needs to insert a new row. */
export interface NewRecordInput {
  readonly kind: Kind;
  readonly scope: Scope;
  /** Project slug for project-scope inserts; ignored for user scope. */
  readonly slug: string;
  readonly status: Status;
  readonly title: string;
  readonly body: string;
  readonly source: string;
  readonly supersedes: string | null;
  readonly ttlDays: number | null;
  readonly pinned: boolean;
  readonly created: string;
  readonly lastModified: string;
  readonly lastValidated: string;
}

/**
 * Mutable scalar fields editable via `updateScalars`. Tags and files
 * are managed through their own repos and are not part of this patch.
 *
 * Use `undefined` to leave a field unchanged. Use `null` for `ttlDays`
 * to clear the override (callers fall back to the global default).
 */
export interface RecordScalarPatch {
  readonly title?: string | undefined;
  readonly body?: string | undefined;
  readonly ttlDays?: number | null | undefined;
}

/**
 * Filter shape for `query`. Every field is optional. Defaults:
 *  - `status` defaults to `'active'`. Pass `'any'` to include all.
 *  - `limit` defaults to `100`.
 *  - `offset` defaults to `0`.
 *  - `tags` and `files` are OR-style: a record matches if it has any
 *    one of the listed values.
 */
export interface QueryFilter {
  readonly status?: Status | 'any' | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly files?: readonly string[] | undefined;
  readonly text?: string | undefined;
  readonly since?: string | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}

export interface QueryResult {
  readonly records: readonly KauriRecord[];
  readonly total: number;
}

// ---------------------------------------------------------------------------
// RecordsRepo
// ---------------------------------------------------------------------------

interface CountRow {
  readonly n: number;
}

interface MaxRow {
  readonly max_n: number | null;
}

interface IdRow {
  readonly id: string;
}

export class RecordsRepo {
  // Statements that don't depend on dynamic SQL.
  private readonly findRowStmt: Statement<RecordRow, [string]>;
  private readonly insertStmt: Statement<
    unknown,
    [
      string, // id
      string, // kind
      string, // scope
      string, // status
      string, // title
      string, // body
      string, // source
      string | null, // supersedes
      number | null, // ttl_days
      number, // pinned (0/1)
      string, // created
      string, // last_modified
      string, // last_validated
    ]
  >;
  private readonly setPinnedStmt: Statement<unknown, [number, string, string]>;
  private readonly markValidatedStmt: Statement<unknown, [string, string, string]>;
  private readonly setStatusStmt: Statement<unknown, [string, string, string]>;
  private readonly linkSupersessionStmt: Statement<unknown, [string, string, string]>;
  private readonly countByStatusStmt: Statement<CountRow, [string]>;
  private readonly pinnedCountStmt: Statement<CountRow, []>;

  /**
   * One MAX(counter) statement per kind. The kind prefix is interpolated
   * into the SQL at construction time (safe — kinds come from a typed
   * enum in `core/constants.ts`, never from user input). Each statement
   * pulls the highest existing counter for its kind so the next insert
   * can use `max + 1`.
   *
   * The `INSTR(id, '-DEC-') + 5` trick works because:
   *   - the kind prefix appears exactly once in any well-formed ID,
   *   - slugs are lowercase, so the literal `-DEC-` (uppercase) cannot
   *     appear in a slug,
   *   - SUBSTR with no length argument returns everything from the
   *     given offset to the end of the string.
   */
  private readonly maxCounterStmts: Map<Kind, Statement<MaxRow, []>>;

  constructor(
    private readonly db: Database,
    private readonly tags: RecordTagsRepo,
    private readonly files: FilesRepo,
    private readonly links: RecordLinksRepo,
  ) {
    this.findRowStmt = db.query<RecordRow, [string]>(
      `SELECT id, kind, scope, status, title, body, source,
              supersedes, superseded_by, ttl_days, pinned, payload,
              revision, created, last_modified, last_validated
       FROM records WHERE id = ?`,
    );

    this.insertStmt = db.query(
      `INSERT INTO records (
         id, kind, scope, status, title, body, source,
         supersedes, superseded_by, ttl_days, pinned, payload,
         revision, created, last_modified, last_validated
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, 1, ?, ?, ?)`,
    );

    this.setPinnedStmt = db.query<unknown, [number, string, string]>(
      'UPDATE records SET pinned = ?, last_modified = ? WHERE id = ?',
    );

    this.markValidatedStmt = db.query<unknown, [string, string, string]>(
      'UPDATE records SET last_validated = ?, last_modified = ? WHERE id = ?',
    );

    this.setStatusStmt = db.query<unknown, [string, string, string]>(
      'UPDATE records SET status = ?, last_modified = ? WHERE id = ?',
    );

    this.linkSupersessionStmt = db.query<unknown, [string, string, string]>(
      `UPDATE records
         SET status = 'superseded',
             superseded_by = ?,
             last_modified = ?
       WHERE id = ?`,
    );

    this.countByStatusStmt = db.query<CountRow, [string]>(
      'SELECT COUNT(*) AS n FROM records WHERE status = ?',
    );

    this.pinnedCountStmt = db.query<CountRow, []>(
      'SELECT COUNT(*) AS n FROM records WHERE pinned = 1',
    );

    this.maxCounterStmts = new Map();
    for (const [kindKey, prefix] of Object.entries(KIND_PREFIX) as Array<[Kind, string]>) {
      const marker = `-${prefix}-`;
      const offset = marker.length + 1; // +1 because SQLite SUBSTR is 1-indexed
      const sql =
        `SELECT MAX(CAST(SUBSTR(id, INSTR(id, '${marker}') + ${offset}) AS INTEGER)) AS max_n ` +
        `FROM records WHERE kind = '${kindKey}'`;
      this.maxCounterStmts.set(kindKey, db.query<MaxRow, []>(sql));
    }
  }

  // -------------------------------------------------------------------------
  // Counter generation
  // -------------------------------------------------------------------------

  /**
   * Compute the next counter value for a given kind. Reads the
   * MAX(counter) from the records table — caller must hold a writer
   * lock (i.e. be inside `Store.tx`) to avoid two inserts racing for
   * the same value.
   */
  public nextCounter(kind: Kind): number {
    const stmt = this.maxCounterStmts.get(kind);
    if (stmt === undefined) {
      // Adding a kind without updating KIND_PREFIX is a programming error.
      throw new KauriError('internal', `no counter statement for kind '${kind}'`);
    }
    const row = stmt.get();
    return (row?.max_n ?? 0) + 1;
  }

  // -------------------------------------------------------------------------
  // Insert
  // -------------------------------------------------------------------------

  /**
   * Insert a new record. Returns the assigned ID. Caller must wrap
   * the call in a transaction (`Store.tx`) so the counter read and
   * the insert are atomic — and so any tag/file inserts the caller
   * does immediately afterwards roll back together with this row on
   * failure.
   */
  public insert(input: NewRecordInput): string {
    const n = this.nextCounter(input.kind);
    const id = formatId(input.scope, input.slug, input.kind, n);

    this.insertStmt.run(
      id,
      input.kind,
      input.scope,
      input.status,
      input.title,
      input.body,
      input.source,
      input.supersedes,
      input.ttlDays,
      pinnedToInt(input.pinned),
      input.created,
      input.lastModified,
      input.lastValidated,
    );

    return id;
  }

  // -------------------------------------------------------------------------
  // Updates
  // -------------------------------------------------------------------------

  /**
   * Apply a scalar patch and bump the revision counter. Throws
   * `KauriError('not_found')` if the record doesn't exist.
   *
   * Tags and files are managed via their own repos and are NOT part
   * of this patch — the service layer coordinates their updates
   * inside the same transaction.
   */
  public updateScalars(id: string, patch: RecordScalarPatch, lastModified: string): void {
    const sets: string[] = [];
    const params: Array<string | number | null> = [];

    if (patch.title !== undefined) {
      sets.push('title = ?');
      params.push(patch.title);
    }
    if (patch.body !== undefined) {
      sets.push('body = ?');
      params.push(patch.body);
    }
    if (patch.ttlDays !== undefined) {
      sets.push('ttl_days = ?');
      params.push(patch.ttlDays);
    }

    // Always bump revision and last_modified.
    sets.push('revision = revision + 1');
    sets.push('last_modified = ?');
    params.push(lastModified);

    params.push(id);

    const sql = `UPDATE records SET ${sets.join(', ')} WHERE id = ?`;
    const result = this.db.query(sql).run(...(params as never[]));
    if (result.changes === 0) {
      throw new KauriError('not_found', `record '${id}' does not exist`, { id });
    }
  }

  /**
   * Pin or unpin a record. Bumps `last_modified` but does NOT bump
   * `revision` — pinning is a presentation hint, not a content
   * change.
   */
  public setPinned(id: string, pinned: boolean, lastModified: string): void {
    const result = this.setPinnedStmt.run(pinnedToInt(pinned), lastModified, id);
    if (result.changes === 0) {
      throw new KauriError('not_found', `record '${id}' does not exist`, { id });
    }
  }

  /**
   * Set the `last_validated` and `last_modified` timestamps. Used by
   * the `validate still_valid` path. Does NOT bump revision.
   */
  public markValidated(id: string, validatedAt: string, lastModified: string): void {
    const result = this.markValidatedStmt.run(validatedAt, lastModified, id);
    if (result.changes === 0) {
      throw new KauriError('not_found', `record '${id}' does not exist`, { id });
    }
  }

  /**
   * Change a record's status (e.g. `validate deprecate`). Does NOT
   * bump revision. Use `linkSupersession` for the supersession path,
   * which also writes `superseded_by`.
   */
  public setStatus(id: string, status: Status, lastModified: string): void {
    const result = this.setStatusStmt.run(status, lastModified, id);
    if (result.changes === 0) {
      throw new KauriError('not_found', `record '${id}' does not exist`, { id });
    }
  }

  /**
   * Mark `supersededId` as superseded by `supersedingId`. Sets the
   * status to `'superseded'` and writes the back-link. The forward
   * link (`supersedes`) on the new record is set at insert time by
   * the caller via `NewRecordInput.supersedes`.
   */
  public linkSupersession(
    supersededId: string,
    supersedingId: string,
    lastModified: string,
  ): void {
    const result = this.linkSupersessionStmt.run(supersedingId, lastModified, supersededId);
    if (result.changes === 0) {
      throw new KauriError('not_found', `record '${supersededId}' does not exist`, {
        id: supersededId,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /** Look up the raw row for an ID. Returns null when missing. */
  public findRowById(id: string): RecordRow | null {
    return this.findRowStmt.get(id);
  }

  /**
   * Look up a hydrated record (row + tags + files). Returns null
   * when the record does not exist.
   */
  public findById(id: string): KauriRecord | null {
    const row = this.findRowStmt.get(id);
    if (row === null) {
      return null;
    }
    return rowToRecord(row, this.tags.tagsFor(id), this.files.list(id), this.links.allLinks(id));
  }

  /**
   * Walk the supersession chain containing `id`. Returns the chain in
   * ancestor-to-descendant order (the original record at index 0,
   * the latest at the end). Throws `KauriError('not_found')` when
   * `id` doesn't exist.
   */
  public walkChain(id: string): readonly KauriRecord[] {
    const start = this.findById(id);
    if (start === null) {
      throw new KauriError('not_found', `record '${id}' does not exist`, { id });
    }
    // Walk to the earliest ancestor first.
    let oldest = start;
    while (oldest.supersedes !== null) {
      const prev = this.findById(oldest.supersedes);
      if (prev === null) {
        // Dangling supersedes pointer — best-effort: stop walking.
        break;
      }
      oldest = prev;
    }
    // Now walk forward to the latest descendant, building the chain
    // in order.
    const chain: KauriRecord[] = [oldest];
    let current = oldest;
    while (current.supersededBy !== null) {
      const next = this.findById(current.supersededBy);
      if (next === null) {
        break;
      }
      chain.push(next);
      current = next;
    }
    return chain;
  }

  /**
   * Run a filtered query and return the matching records. The
   * `total` field is the count of records matching the filter
   * *before* `limit` and `offset` are applied — useful for
   * pagination.
   */
  public query(filter: QueryFilter): QueryResult {
    const { whereSql, params } = buildWhere(filter);

    const countSql = `SELECT COUNT(*) AS n FROM records ${whereSql}`;
    const countRow = this.db.query<CountRow, never[]>(countSql).get(...(params as never[]));
    const total = countRow?.n ?? 0;

    const limit = filter.limit ?? DEFAULT_LIMIT;
    const offset = filter.offset ?? 0;
    requireNonNegativeInt(limit, 'limit');
    requireNonNegativeInt(offset, 'offset');

    const idsSql = `SELECT id FROM records ${whereSql} ORDER BY created DESC LIMIT ? OFFSET ?`;
    const idRows = this.db
      .query<IdRow, never[]>(idsSql)
      .all(...([...params, limit, offset] as never[]));

    const records = idRows.map((r) => {
      const hydrated = this.findById(r.id);
      // findById can theoretically return null between the count
      // and the fetch under concurrent writes; treat that as "drop
      // this row from the result" rather than throwing.
      return hydrated;
    });

    const filtered = records.filter((r): r is KauriRecord => r !== null);
    return { records: filtered, total };
  }

  /** Aggregations used by `kauri status`. */
  public countByStatus(status: Status): number {
    return this.countByStatusStmt.get(status)?.n ?? 0;
  }

  public pinnedCount(): number {
    return this.pinnedCountStmt.get()?.n ?? 0;
  }

  // -------------------------------------------------------------------------
  // Service-layer convenience
  // -------------------------------------------------------------------------

  /**
   * Parse a record ID and verify the kind matches what we expect.
   * Re-exported here so callers don't have to import from core/ids
   * separately when they already have a repo handle.
   */
  public parseRecordId(id: string): { scope: Scope; slug: string; kind: Kind; n: number } {
    return parseId(id);
  }

  /** Convenience wrapper around `core/ids.kindPrefix`. */
  public prefixForKind(kind: Kind): string {
    return kindPrefix(kind);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default page size when the caller doesn't specify a limit. */
const DEFAULT_LIMIT = 100;

interface BuiltWhere {
  readonly whereSql: string;
  readonly params: ReadonlyArray<string | number>;
}

/**
 * Build the SQL WHERE clause and bound parameter list from a query
 * filter. Uses subqueries for tag / file / FTS filters so we don't
 * have to fight with DISTINCT after multi-row joins.
 */
function buildWhere(filter: QueryFilter): BuiltWhere {
  const params: Array<string | number> = [];
  const where: string[] = [];

  // Status default: 'active'. 'any' skips the filter entirely.
  if (filter.status === undefined) {
    where.push("records.status = 'active'");
  } else if (filter.status !== 'any') {
    where.push('records.status = ?');
    params.push(filter.status);
  }

  // Tags filter (OR semantics).
  if (filter.tags !== undefined && filter.tags.length > 0) {
    const placeholders = filter.tags.map(() => '?').join(', ');
    where.push(
      `records.id IN (SELECT record_id FROM record_tags WHERE tag IN (${placeholders}))`,
    );
    params.push(...filter.tags);
  }

  // Files filter (OR semantics).
  if (filter.files !== undefined && filter.files.length > 0) {
    const placeholders = filter.files.map(() => '?').join(', ');
    where.push(
      `records.id IN (SELECT record_id FROM record_files WHERE path IN (${placeholders}))`,
    );
    params.push(...filter.files);
  }

  // Text filter via FTS5.
  if (filter.text !== undefined && filter.text.trim().length > 0) {
    const ftsExpr = buildFtsMatchQuery(filter.text);
    if (ftsExpr.length > 0) {
      where.push(
        'records.rowid IN (SELECT rowid FROM records_fts WHERE records_fts MATCH ?)',
      );
      params.push(ftsExpr);
    }
  }

  // Since (created >= ISO 8601).
  if (filter.since !== undefined) {
    where.push('records.created >= ?');
    params.push(filter.since);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  return { whereSql, params };
}

function requireNonNegativeInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new KauriError(
      'invalid_input',
      `${label} must be a non-negative integer, got ${String(value)}`,
    );
  }
}
