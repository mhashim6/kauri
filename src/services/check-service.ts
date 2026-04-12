/**
 * Staleness check service — scans active records and flags stale ones.
 *
 * Two mechanisms per `kauri-spec.md` § Staleness:
 *   1. Time-based: `now - last_validated > ttl_days`.
 *   2. File-based: mtime+size fast path → SHA-256 confirmation.
 *
 * A record is stale if *either* mechanism fires. The service computes
 * the stale set and returns it as a structured report. It does NOT
 * mutate any records — staleness is a signal, not a state.
 */
import { readFileSync } from 'node:fs';

import { compareFile, isTimeStale, type FreshFileStat, type StoredFileState } from '../core/staleness.ts';
import type { FileAssoc, KauriRecord, ScopeQuery } from '../core/types.ts';
import type { FsProbe } from '../fs/files.ts';

import { bundlesForRead, type ServiceContext, type StoreBundle } from './context.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StaleRecord {
  readonly record: KauriRecord;
  readonly reasons: readonly StaleReason[];
}

export type StaleReason =
  | { readonly kind: 'time'; readonly daysSinceValidation: number; readonly ttlDays: number }
  | { readonly kind: 'file_changed'; readonly path: string }
  | { readonly kind: 'file_missing'; readonly path: string };

export interface CheckResult {
  readonly checked: number;
  readonly staleRecords: readonly StaleRecord[];
  /** Set of stale record IDs — convenient for projection rendering. */
  readonly staleIds: ReadonlySet<string>;
}

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------

/**
 * Run a full staleness scan across all active records in the given
 * scope. Records without file associations are only checked for
 * time-based staleness. Files on records are probed synchronously —
 * this is the hot path that `kauri check` and session-end hooks call.
 */
export function checkStaleness(ctx: ServiceContext, scope: ScopeQuery): CheckResult {
  const bundles = bundlesForRead(ctx, scope);
  const now = ctx.clock.now();
  const staleRecords: StaleRecord[] = [];
  const staleIds = new Set<string>();
  let checked = 0;

  for (const bundle of bundles) {
    const result = checkBundle(bundle, now, ctx.fsProbe);
    checked += result.checked;
    for (const sr of result.stale) {
      staleRecords.push(sr);
      staleIds.add(sr.record.id);
    }
  }

  return { checked, staleRecords, staleIds };
}

/**
 * Compute stale IDs only — lighter weight than the full report. Used
 * by the projection service to annotate records with `[STALE]`.
 */
export function computeStaleIds(ctx: ServiceContext, scope: ScopeQuery): ReadonlySet<string> {
  return checkStaleness(ctx, scope).staleIds;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface BundleCheckResult {
  readonly checked: number;
  readonly stale: readonly StaleRecord[];
}

function checkBundle(
  bundle: StoreBundle,
  now: Date,
  probe: FsProbe,
): BundleCheckResult {
  // Fetch all active records from this store.
  const { records: activeRecords } = bundle.records.query({
    status: 'active',
    limit: 100000,
    offset: 0,
  });
  // Also include drafts (they can go stale too, though less commonly queried).
  const { records: draftRecords } = bundle.records.query({
    status: 'draft',
    limit: 100000,
    offset: 0,
  });
  const allRecords = [...activeRecords, ...draftRecords];

  const globalTtl = bundle.meta.getDefaultTtlDays();
  const stale: StaleRecord[] = [];

  for (const record of allRecords) {
    const reasons = checkRecord(record, now, globalTtl, probe, bundle);
    if (reasons.length > 0) {
      stale.push({ record, reasons });
    }
  }

  return { checked: allRecords.length, stale };
}

function checkRecord(
  record: KauriRecord,
  now: Date,
  globalTtl: number | null,
  probe: FsProbe,
  bundle: StoreBundle,
): StaleReason[] {
  const reasons: StaleReason[] = [];

  // Time-based check (always on).
  if (isTimeStale(now, record.lastValidated, record.ttlDays, globalTtl)) {
    const validatedMs = new Date(record.lastValidated).getTime();
    const daysSince = Math.floor((now.getTime() - validatedMs) / (1000 * 60 * 60 * 24));
    const effectiveTtl = record.ttlDays ?? globalTtl ?? 0;
    reasons.push({ kind: 'time', daysSinceValidation: daysSince, ttlDays: effectiveTtl });
  }

  // File-based check (opt-in per record).
  for (const file of record.files) {
    const result = checkFileAssoc(file, probe, bundle, record.id);
    if (result !== null) {
      reasons.push(result);
    }
  }

  return reasons;
}

function checkFileAssoc(
  file: FileAssoc,
  probe: FsProbe,
  bundle: StoreBundle,
  recordId: string,
): StaleReason | null {
  const stored: StoredFileState = {
    mtime: file.mtime,
    size: file.size,
    sha256: file.sha256,
  };

  const freshStat: FreshFileStat | null = probe.stat(file.path);

  const result = compareFile(stored, freshStat, () => {
    // Lazy hash thunk — only called when mtime+size changed.
    try {
      const bytes = readFileSync(file.path);
      const hasher = new Bun.CryptoHasher('sha256');
      hasher.update(bytes);
      return hasher.digest('hex');
    } catch {
      // If we can't read the file at this point, treat as changed.
      return '';
    }
  });

  switch (result.kind) {
    case 'unchanged':
    case 'over_cap':
      return null;
    case 'touched_only':
      // Mtime drift — update the baseline to skip future hash work.
      bundle.files.touchMtime(recordId, file.path, result.newMtime);
      return null;
    case 'changed':
      return { kind: 'file_changed', path: file.path };
    case 'missing':
      return { kind: 'file_missing', path: file.path };
  }
}
