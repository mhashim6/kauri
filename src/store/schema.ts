/**
 * Row shapes and mappers between SQLite snake_case rows and the
 * camelCase domain types in `core/types.ts`.
 *
 * The repos in `src/store/repo/*` always traffic in the snake_case row
 * types and the mappers below convert at the edge. Anything outside
 * `src/store/**` should never see a snake_case field name.
 *
 * Per the module-boundary rules, this file imports from `core/*` and
 * nothing else.
 */
import type { FileAssoc, KauriRecord, Kind, Scope, Status } from '../core/types.ts';

// ---------------------------------------------------------------------------
// Raw row shapes
// ---------------------------------------------------------------------------

/** Exact column shape of one row in `records`. */
export interface RecordRow {
  readonly id: string;
  readonly kind: string;
  readonly scope: string;
  readonly status: string;
  readonly title: string;
  readonly body: string;
  readonly source: string;
  readonly supersedes: string | null;
  readonly superseded_by: string | null;
  readonly ttl_days: number | null;
  /** SQLite stores booleans as 0/1 integers. */
  readonly pinned: number;
  readonly payload: string | null;
  readonly revision: number;
  readonly created: string;
  readonly last_modified: string;
  readonly last_validated: string;
}

/** One row in `record_files`. */
export interface RecordFileRow {
  readonly record_id: string;
  readonly path: string;
  readonly mtime: number;
  readonly size: number;
  readonly sha256: string | null;
}

/** One row in `record_tags`. Used as a junction. */
export interface RecordTagRow {
  readonly record_id: string;
  readonly tag: string;
}

/** One row in `record_links`. */
export interface RecordLinkRow {
  readonly from_record_id: string;
  readonly to_record_id: string;
}

/** One row in `taxonomy`. */
export interface TaxonomyRow {
  readonly tag: string;
  readonly added: string;
}

// ---------------------------------------------------------------------------
// Row -> domain mappers
// ---------------------------------------------------------------------------

/**
 * Convert a `records` row plus its associated tags and files into a
 * domain `KauriRecord`. The narrowing of the string columns to their
 * union types is unchecked here — repos that fetch rows from this
 * table can only get values that the CHECK constraints allowed in,
 * so the cast is safe.
 */
export function rowToRecord(
  row: RecordRow,
  tags: readonly string[],
  files: readonly FileAssoc[],
  links: readonly string[] = [],
): KauriRecord {
  return {
    id: row.id,
    kind: row.kind as Kind,
    scope: row.scope as Scope,
    status: row.status as Status,
    title: row.title,
    body: row.body,
    tags,
    files,
    links,
    source: row.source,
    supersedes: row.supersedes,
    supersededBy: row.superseded_by,
    ttlDays: row.ttl_days,
    pinned: row.pinned === 1,
    // payload is reserved for v0.2+ — always null in v0.1
    payload: null,
    revision: row.revision,
    created: row.created,
    lastModified: row.last_modified,
    lastValidated: row.last_validated,
  };
}

/** Convert a `record_files` row to a `FileAssoc`. */
export function fileRowToAssoc(row: RecordFileRow): FileAssoc {
  return {
    path: row.path,
    mtime: row.mtime,
    size: row.size,
    sha256: row.sha256,
  };
}

// ---------------------------------------------------------------------------
// Domain -> row helpers
// ---------------------------------------------------------------------------

/**
 * Helper for the records repo's INSERT path: convert a `pinned` boolean
 * to its 0/1 SQLite integer form. Centralised so the conversion isn't
 * repeated across update and pin/unpin call sites.
 */
export function pinnedToInt(pinned: boolean): 0 | 1 {
  return pinned ? 1 : 0;
}
