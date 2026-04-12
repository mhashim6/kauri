/**
 * Typed accessor for the `meta` key/value table.
 *
 * The `meta` table is a tiny SQLite key/value store that holds the few
 * scalar settings Kauri needs: schema version, project slug, init
 * timestamp, and the three configurable defaults (TTL, pin soft cap,
 * file hash size cap). The raw rows are always `(TEXT, TEXT)` because
 * SQLite doesn't enforce shape on a key/value pair, so the typed
 * accessors below own the marshalling.
 *
 * Conventions:
 *  - "missing key" and "empty string" are *both* treated as "no value
 *    set" for the typed accessors. This matters for `default_ttl_days`,
 *    where the spec defines `null` as "time-based staleness disabled".
 *  - Numeric accessors that have a sensible default fall back to
 *    `META_DEFAULTS` from `core/constants.ts` rather than throwing.
 *  - The `slug` setter re-runs `normalizeSlug` so a malformed slug
 *    cannot reach the database even if a caller skipped validation.
 *
 * Per the module-boundary rules, this file may import from `core/*`
 * (for validation and defaults) and `bun:sqlite`.
 */
import type { Database, Statement } from 'bun:sqlite';

import { META_DEFAULTS } from '../../core/constants.ts';
import { normalizeSlug } from '../../core/slug.ts';

/** Known meta keys. Centralised so callers don't sprinkle string literals. */
export const META_KEYS = {
  schemaVersion: 'schema_version',
  slug: 'slug',
  createdAt: 'created_at',
  defaultTtlDays: 'default_ttl_days',
  pinSoftCap: 'pin_soft_cap',
  fileHashSizeCapBytes: 'file_hash_size_cap_bytes',
} as const;

interface MetaRow {
  readonly value: string;
}

export class MetaRepo {
  private readonly getStmt: Statement<MetaRow, [string]>;
  private readonly setStmt: Statement<unknown, [string, string]>;

  constructor(db: Database) {
    this.getStmt = db.query<MetaRow, [string]>('SELECT value FROM meta WHERE key = ?');
    this.setStmt = db.query<unknown, [string, string]>(
      'INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)',
    );
  }

  // -------------------------------------------------------------------------
  // Generic key/value access
  // -------------------------------------------------------------------------

  /**
   * Read the raw string value for `key`. Returns `null` for both
   * missing keys and empty-string values, so callers don't have to
   * distinguish (they almost never want to).
   */
  public get(key: string): string | null {
    const row = this.getStmt.get(key);
    if (row === null || row.value === '') {
      return null;
    }
    return row.value;
  }

  /** Read the raw row, treating empty string as a present-but-empty value. */
  public getRaw(key: string): string | null {
    const row = this.getStmt.get(key);
    return row === null ? null : row.value;
  }

  /** Insert or replace the value for `key`. */
  public set(key: string, value: string): void {
    this.setStmt.run(key, value);
  }

  /**
   * Convenience: store all entries from `pairs` in a single call. The
   * caller is responsible for wrapping in a transaction if atomicity
   * is required (the meta repo doesn't take a `Store`, only a `Database`).
   */
  public setMany(pairs: Readonly<Record<string, string>>): void {
    for (const [key, value] of Object.entries(pairs)) {
      this.set(key, value);
    }
  }

  // -------------------------------------------------------------------------
  // Typed accessors
  // -------------------------------------------------------------------------

  public getSchemaVersion(): number | null {
    return this.getInt(META_KEYS.schemaVersion);
  }

  public setSchemaVersion(version: number): void {
    requireNonNegativeInt(version, 'schema_version');
    this.set(META_KEYS.schemaVersion, String(version));
  }

  public getSlug(): string | null {
    return this.get(META_KEYS.slug);
  }

  /**
   * Set the project slug, re-validating through `normalizeSlug`.
   * Throws `KauriError('usage')` if the input cannot be normalised.
   */
  public setSlug(rawSlug: string): void {
    const normalized = normalizeSlug(rawSlug);
    this.set(META_KEYS.slug, normalized);
  }

  public getCreatedAt(): string | null {
    return this.get(META_KEYS.createdAt);
  }

  public setCreatedAt(iso: string): void {
    this.set(META_KEYS.createdAt, iso);
  }

  /**
   * Default TTL for time-based staleness. Returns `null` when the
   * value is empty or missing — the spec interprets that as "time-based
   * staleness disabled at the global level". Callers wanting an
   * effective number with the seeded fallback should use
   * `getDefaultTtlDaysOrFallback`.
   */
  public getDefaultTtlDays(): number | null {
    return this.getInt(META_KEYS.defaultTtlDays);
  }

  public getDefaultTtlDaysOrFallback(): number | null {
    const value = this.getDefaultTtlDays();
    if (value !== null) {
      return value;
    }
    // The seeded default is non-null; we return it directly.
    return META_DEFAULTS.defaultTtlDays;
  }

  /**
   * Setting `null` clears the TTL (stored as empty string), which the
   * getter then reports as `null` and time-based staleness becomes a
   * no-op.
   */
  public setDefaultTtlDays(days: number | null): void {
    if (days === null) {
      this.set(META_KEYS.defaultTtlDays, '');
      return;
    }
    requireNonNegativeInt(days, 'default_ttl_days');
    this.set(META_KEYS.defaultTtlDays, String(days));
  }

  public getPinSoftCap(): number {
    return this.getInt(META_KEYS.pinSoftCap) ?? META_DEFAULTS.pinSoftCap;
  }

  public setPinSoftCap(cap: number): void {
    requireNonNegativeInt(cap, 'pin_soft_cap');
    this.set(META_KEYS.pinSoftCap, String(cap));
  }

  public getFileHashSizeCapBytes(): number {
    return this.getInt(META_KEYS.fileHashSizeCapBytes) ?? META_DEFAULTS.fileHashSizeCapBytes;
  }

  public setFileHashSizeCapBytes(bytes: number): void {
    requireNonNegativeInt(bytes, 'file_hash_size_cap_bytes');
    this.set(META_KEYS.fileHashSizeCapBytes, String(bytes));
  }

  // -------------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------------

  /**
   * Read a meta value and parse it as a non-negative integer. Returns
   * `null` for missing, empty, or unparseable values. Defensive on
   * input — corruption shouldn't crash the process, just degrade to
   * the default.
   */
  private getInt(key: string): number | null {
    const value = this.get(key);
    if (value === null) {
      return null;
    }
    const n = Number.parseInt(value, 10);
    if (!Number.isInteger(n) || n < 0) {
      return null;
    }
    return n;
  }
}

function requireNonNegativeInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer, got ${String(value)}`);
  }
}
