/**
 * `record_links` repo — general-purpose "related to" links between records.
 *
 * Links are stored directionally (from → to) but read bidirectionally:
 * if record A links to record B, querying links for B also returns A.
 * This avoids requiring callers to create symmetric rows manually.
 *
 * The pattern follows `RecordTagsRepo` and `FilesRepo`: clear + insert
 * on set, sorted and de-duplicated for deterministic row order.
 *
 * Per the module-boundary rules, this file may import from `core/*`
 * and `bun:sqlite`.
 */
import type { Database, Statement } from 'bun:sqlite';

interface IdRow {
  readonly id: string;
}

export class RecordLinksRepo {
  private readonly linksFromStmt: Statement<IdRow, [string]>;
  private readonly linksToStmt: Statement<IdRow, [string]>;
  private readonly clearStmt: Statement<unknown, [string]>;
  private readonly insertStmt: Statement<unknown, [string, string]>;

  constructor(db: Database) {
    this.linksFromStmt = db.query<IdRow, [string]>(
      'SELECT to_record_id AS id FROM record_links WHERE from_record_id = ? ORDER BY to_record_id ASC',
    );
    this.linksToStmt = db.query<IdRow, [string]>(
      'SELECT from_record_id AS id FROM record_links WHERE to_record_id = ? ORDER BY from_record_id ASC',
    );
    this.clearStmt = db.query<unknown, [string]>(
      'DELETE FROM record_links WHERE from_record_id = ?',
    );
    this.insertStmt = db.query<unknown, [string, string]>(
      'INSERT OR IGNORE INTO record_links(from_record_id, to_record_id) VALUES (?, ?)',
    );
  }

  /** IDs this record links TO (outgoing only). */
  public linksFrom(recordId: string): readonly string[] {
    return this.linksFromStmt.all(recordId).map((r) => r.id);
  }

  /** IDs that link TO this record (incoming only). */
  public linksTo(recordId: string): readonly string[] {
    return this.linksToStmt.all(recordId).map((r) => r.id);
  }

  /**
   * All linked record IDs — union of outgoing and incoming links,
   * de-duplicated and sorted. This is the method used by hydration
   * so that links appear bidirectional to consumers.
   */
  public allLinks(recordId: string): readonly string[] {
    const from = this.linksFromStmt.all(recordId).map((r) => r.id);
    const to = this.linksToStmt.all(recordId).map((r) => r.id);
    return [...new Set([...from, ...to])].sort();
  }

  /**
   * Replace the outgoing link set for `recordId`. Only clears and
   * re-inserts outgoing links (from_record_id = recordId). Incoming
   * links from other records are not touched.
   *
   * Caller must wrap this in a transaction if atomicity matters.
   */
  public set(recordId: string, linkedIds: readonly string[]): void {
    this.clearStmt.run(recordId);
    if (linkedIds.length === 0) {
      return;
    }
    const unique = [...new Set(linkedIds)].sort();
    for (const toId of unique) {
      this.insertStmt.run(recordId, toId);
    }
  }
}
