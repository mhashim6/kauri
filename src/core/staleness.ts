/**
 * Pure staleness comparison logic.
 *
 * These functions answer "is this record stale?" given a set of probes.
 * They don't touch the filesystem or the database — the caller supplies
 * the stored state, the fresh state, and optionally a lazy hash thunk.
 *
 * Two independent mechanisms (see `kauri-spec.md` § Staleness):
 *
 *   1. **Time-based** — `isTimeStale`. Always applicable. Fires when
 *      `now - lastValidated > ttlDays`.
 *
 *   2. **File-based** — `compareFile`. Only applicable for records with
 *      file associations. Uses a mtime+size fast path to skip hashing
 *      when nothing has changed.
 *
 * A record is stale if *either* mechanism fires.
 *
 * Per the module-boundary rules, this file imports nothing outside `core/`.
 */

// ---------------------------------------------------------------------------
// Time-based staleness
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the time since last validation exceeds the
 * effective TTL.
 *
 * @param now            The current instant.
 * @param lastValidated  ISO 8601 timestamp of last validation.
 * @param recordTtl      Per-record TTL override (null = use global).
 * @param globalTtl      Global default TTL from meta (null = time-based
 *                       staleness disabled entirely).
 *
 * Resolution order:
 *   1. If `recordTtl` is a number, use it.
 *   2. Else if `globalTtl` is a number, use it.
 *   3. Else time-based staleness is disabled → return false.
 *
 * A TTL of 0 means "always stale" (every check fires). Negative TTLs
 * are treated the same as null (disabled) — defensive, not enforced.
 */
export function isTimeStale(
  now: Date,
  lastValidated: string,
  recordTtl: number | null,
  globalTtl: number | null,
): boolean {
  const effectiveTtl = recordTtl ?? globalTtl;
  if (effectiveTtl === null || effectiveTtl < 0) {
    return false;
  }
  const validatedMs = new Date(lastValidated).getTime();
  if (Number.isNaN(validatedMs)) {
    // Malformed timestamp — safer to flag as stale than to silently pass.
    return true;
  }
  const elapsedDays = (now.getTime() - validatedMs) / (1000 * 60 * 60 * 24);
  return elapsedDays > effectiveTtl;
}

// ---------------------------------------------------------------------------
// File-based staleness
// ---------------------------------------------------------------------------

/** What we stored at the time of the last validation. */
export interface StoredFileState {
  readonly mtime: number;
  readonly size: number;
  /** `null` means the file exceeded the size cap — only mtime+size are tracked. */
  readonly sha256: string | null;
}

/** What the filesystem reports right now. */
export interface FreshFileStat {
  readonly mtime: number;
  readonly size: number;
}

/**
 * Result of comparing a single file's stored baseline against the
 * fresh filesystem state. The caller uses this to decide what to do:
 *
 *   - `unchanged` — nothing changed. No action needed.
 *   - `touched_only` — mtime (or size) changed but hash matches.
 *     Caller should call `FilesRepo.touchMtime` to update the stored
 *     baseline so future checks skip the hash.
 *   - `changed` — content actually changed. Record is file-stale.
 *   - `missing` — file no longer exists on disk. Treated as stale.
 *   - `over_cap` — file was not hashed at validation time (sha256 is
 *     null). Cannot determine file staleness. Not treated as stale.
 */
export type FileCheckResult =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'touched_only'; readonly newMtime: number }
  | { readonly kind: 'changed' }
  | { readonly kind: 'missing' }
  | { readonly kind: 'over_cap' };

/**
 * Compare one file's stored baseline against its current filesystem
 * state. The `freshHash` thunk is called *only* when the fast path
 * (mtime+size) detects a change and the file was hashed at validation
 * time — so in the common "nothing changed" case, no I/O is done.
 *
 * @param stored     The baseline from `record_files`.
 * @param freshStat  `null` when the file no longer exists on disk.
 * @param freshHash  Lazy thunk that computes the SHA-256 hex digest.
 *                   Only called when needed. May be async.
 */
export function compareFile(
  stored: StoredFileState,
  freshStat: FreshFileStat | null,
  freshHash: () => string,
): FileCheckResult {
  // File disappeared from disk.
  if (freshStat === null) {
    return { kind: 'missing' };
  }

  // File was not hashed at validation time (exceeded size cap).
  // We can't compare content, so we can't flag staleness.
  if (stored.sha256 === null) {
    return { kind: 'over_cap' };
  }

  // Fast path: mtime AND size both match → file unchanged.
  if (stored.mtime === freshStat.mtime && stored.size === freshStat.size) {
    return { kind: 'unchanged' };
  }

  // Something moved. Hash to confirm.
  const currentHash = freshHash();
  if (currentHash === stored.sha256) {
    // Content is the same — mtime drift (format-on-save, git checkout).
    // Caller should update the stored mtime to skip future hash work.
    return { kind: 'touched_only', newMtime: freshStat.mtime };
  }

  // Content has genuinely changed.
  return { kind: 'changed' };
}
