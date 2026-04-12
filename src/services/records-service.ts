/**
 * Records service — the primary orchestration layer for CRUD + lifecycle.
 *
 * Every operation that creates, modifies, or reads records flows through
 * here. The service coordinates between repos (records, tags, files),
 * core logic (ID generation, tag normalisation), and the service context
 * (scope resolution, clock, filesystem probes).
 *
 * File probes happen *outside* the SQLite transaction so the
 * synchronous I/O (stat + hash via readFileSync) doesn't hold the
 * writer lock longer than necessary.
 */
import { readFileSync } from 'node:fs';

import { KauriError } from '../core/errors.ts';
import { normalizeTag } from '../core/tags.ts';
import type {
  FileAssoc,
  KauriRecord,
  Kind,
  Scope,
  ScopeQuery,
  Status,
  Verdict,
  Warning,
} from '../core/types.ts';
import type { FsProbe } from '../fs/files.ts';
import type { QueryFilter, QueryResult, RecordScalarPatch } from '../store/repo/records.ts';

import {
  bundleForId,
  bundleForWrite,
  bundlesForRead,
  type ServiceContext,
  type StoreBundle,
} from './context.ts';

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateInput {
  readonly title: string;
  readonly body: string;
  readonly tags: readonly string[];
  readonly source: string;
  readonly status?: Status | undefined;
  readonly files?: readonly string[] | undefined;
  readonly supersedes?: string | undefined;
  readonly ttlDays?: number | null | undefined;
  readonly pinned?: boolean | undefined;
  readonly allowNewTags?: boolean | undefined;
  readonly scope?: Scope | undefined;
}

export interface CreateResult {
  readonly record: KauriRecord;
  readonly warnings: readonly Warning[];
}

export function createRecord(ctx: ServiceContext, input: CreateInput): CreateResult {
  const now = ctx.clock.nowIso();
  const bundle = bundleForWrite(ctx, input.scope);
  const slug = bundle.meta.getSlug() ?? 'unknown';
  const warnings: Warning[] = [];

  // Probe files BEFORE entering the transaction.
  const fileAssocs = input.files?.length
    ? probeFiles(input.files, ctx.fsProbe, warnings)
    : [];

  return bundle.store.tx(() => {
    // Tags: normalise, validate against taxonomy, optionally add new.
    const normalizedTags = ensureTags(bundle, input.tags, input.allowNewTags ?? false, now);

    // Supersession: validate the referenced record exists.
    if (input.supersedes !== undefined) {
      const old = bundle.records.findById(input.supersedes);
      if (old === null) {
        throw new KauriError('not_found', `supersedes target '${input.supersedes}' not found`);
      }
    }

    // Insert.
    const kind: Kind = 'decision';
    const id = bundle.records.insert({
      kind,
      scope: bundle.store.scope,
      slug,
      status: input.status ?? 'active',
      title: input.title,
      body: input.body,
      source: input.source,
      supersedes: input.supersedes ?? null,
      ttlDays: input.ttlDays ?? null,
      pinned: input.pinned ?? false,
      created: now,
      lastModified: now,
      lastValidated: now,
    });

    if (normalizedTags.length > 0) {
      bundle.tags.set(id, normalizedTags);
    }
    if (fileAssocs.length > 0) {
      bundle.files.replace(id, fileAssocs);
    }
    if (input.supersedes !== undefined) {
      bundle.records.linkSupersession(input.supersedes, id, now);
    }

    // Pin cap warning.
    if (input.pinned && bundle.records.pinnedCount() > bundle.meta.getPinSoftCap()) {
      warnings.push({
        code: 'pin_soft_cap_exceeded',
        message: `pinned count exceeds the soft cap of ${bundle.meta.getPinSoftCap()}`,
      });
    }

    const record = bundle.records.findById(id);
    if (record === null) {
      throw new KauriError('internal', `just-inserted record '${id}' not found`);
    }
    return { record, warnings };
  });
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export interface UpdateInput {
  readonly id: string;
  readonly source: string;
  readonly title?: string | undefined;
  readonly body?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly files?: readonly string[] | undefined;
  readonly ttlDays?: number | null | undefined;
  readonly pinned?: boolean | undefined;
  readonly allowNewTags?: boolean | undefined;
}

export interface UpdateResult {
  readonly record: KauriRecord;
  readonly warnings: readonly Warning[];
}

export function updateRecord(ctx: ServiceContext, input: UpdateInput): UpdateResult {
  const now = ctx.clock.nowIso();
  const bundle = bundleForId(ctx, input.id);
  const warnings: Warning[] = [];

  // Probe files before the transaction.
  const fileAssocs = input.files !== undefined
    ? probeFiles(input.files, ctx.fsProbe, warnings)
    : null;

  return bundle.store.tx(() => {
    const existing = bundle.records.findById(input.id);
    if (existing === null) {
      throw new KauriError('not_found', `record '${input.id}' not found`, { id: input.id });
    }

    // Update scalar fields + bump revision. Only include fields that
    // the caller actually provided (exactOptionalPropertyTypes prevents
    // passing `undefined` to an optional field).
    const patch: RecordScalarPatch = {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.ttlDays !== undefined ? { ttlDays: input.ttlDays } : {}),
    };
    bundle.records.updateScalars(input.id, patch, now);

    // Tags.
    if (input.tags !== undefined) {
      const normalizedTags = ensureTags(bundle, input.tags, input.allowNewTags ?? false, now);
      bundle.tags.set(input.id, normalizedTags);
    }

    // Files.
    if (fileAssocs !== null) {
      bundle.files.replace(input.id, fileAssocs);
    }

    // Pinned (separate from scalars — no revision bump).
    if (input.pinned !== undefined) {
      bundle.records.setPinned(input.id, input.pinned, now);
      if (input.pinned && bundle.records.pinnedCount() > bundle.meta.getPinSoftCap()) {
        warnings.push({
          code: 'pin_soft_cap_exceeded',
          message: `pinned count exceeds the soft cap of ${bundle.meta.getPinSoftCap()}`,
        });
      }
    }

    const record = bundle.records.findById(input.id);
    if (record === null) {
      throw new KauriError('internal', `just-updated record '${input.id}' not found`);
    }
    return { record, warnings };
  });
}

// ---------------------------------------------------------------------------
// Show / Query / History
// ---------------------------------------------------------------------------

export function showRecord(ctx: ServiceContext, id: string): KauriRecord {
  const bundle = bundleForId(ctx, id);
  const record = bundle.records.findById(id);
  if (record === null) {
    throw new KauriError('not_found', `record '${id}' not found`, { id });
  }
  return record;
}

export function queryRecords(
  ctx: ServiceContext,
  filter: QueryFilter,
  scope: ScopeQuery = 'both',
): QueryResult {
  const bundles = bundlesForRead(ctx, scope);
  if (bundles.length === 0) {
    return { records: [], total: 0 };
  }
  if (bundles.length === 1) {
    return (bundles[0] as StoreBundle).records.query(filter);
  }
  // Merge results from both stores.
  const allRecords: KauriRecord[] = [];
  let total = 0;
  for (const b of bundles) {
    const result = b.records.query({ ...filter, limit: 10000, offset: 0 });
    allRecords.push(...result.records);
    total += result.total;
  }
  allRecords.sort((a, b) => (b.created > a.created ? 1 : b.created < a.created ? -1 : 0));
  const limit = filter.limit ?? 100;
  const offset = filter.offset ?? 0;
  return { records: allRecords.slice(offset, offset + limit), total };
}

export function historyOf(ctx: ServiceContext, id: string): readonly KauriRecord[] {
  const bundle = bundleForId(ctx, id);
  return bundle.records.walkChain(id);
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

export interface ValidateResult {
  readonly record: KauriRecord;
}

export function validateRecord(
  ctx: ServiceContext,
  id: string,
  verdict: Verdict,
  _source: string,
): ValidateResult {
  const now = ctx.clock.nowIso();
  const bundle = bundleForId(ctx, id);
  const warnings: Warning[] = [];

  // For still_valid: refresh file baselines before the tx.
  let freshFileAssocs: FileAssoc[] | null = null;
  if (verdict === 'still_valid') {
    const existing = bundle.records.findById(id);
    if (existing !== null && existing.files.length > 0) {
      freshFileAssocs = probeFiles(
        existing.files.map((f) => f.path),
        ctx.fsProbe,
        warnings,
      );
    }
  }

  return bundle.store.tx(() => {
    const existing = bundle.records.findById(id);
    if (existing === null) {
      throw new KauriError('not_found', `record '${id}' not found`, { id });
    }

    if (verdict === 'deprecate') {
      bundle.records.setStatus(id, 'deprecated', now);
    } else {
      bundle.records.markValidated(id, now, now);
      if (existing.status === 'draft') {
        bundle.records.setStatus(id, 'active', now);
      }
      if (freshFileAssocs !== null) {
        bundle.files.replace(id, freshFileAssocs);
      }
    }

    const record = bundle.records.findById(id);
    if (record === null) {
      throw new KauriError('internal', `just-validated record '${id}' not found`);
    }
    return { record };
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalise tags, validate against the taxonomy, optionally add new
 * ones. Returns the normalised list.
 */
function ensureTags(
  bundle: StoreBundle,
  rawTags: readonly string[],
  allowNewTags: boolean,
  now: string,
): string[] {
  const normalized = rawTags.map(normalizeTag);
  for (const tag of normalized) {
    if (!bundle.taxonomy.has(tag)) {
      if (allowNewTags) {
        bundle.taxonomy.add(tag, now);
      } else {
        throw new KauriError(
          'invalid_input',
          `tag '${tag}' is not in the taxonomy; add it first or pass allow_new_tags`,
          { tag, taxonomy: bundle.taxonomy.list() },
        );
      }
    }
  }
  return normalized;
}

/**
 * Probe a list of file paths and build FileAssoc records. Emits
 * warnings for files over the size cap or files that don't exist.
 *
 * Hashing is done synchronously via `readFileSync` + `Bun.CryptoHasher`
 * so callers can use the results inside a SQLite transaction without
 * awaiting. Only files under the size cap are hashed.
 */
function probeFiles(
  paths: readonly string[],
  probe: FsProbe,
  warnings: Warning[],
): FileAssoc[] {
  const assocs: FileAssoc[] = [];
  for (const p of paths) {
    const stat = probe.stat(p);
    if (stat === null) {
      warnings.push({
        code: 'file_not_found',
        message: `file '${p}' does not exist on disk; tracked for navigation only`,
      });
      assocs.push({ path: p, mtime: 0, size: 0, sha256: null });
      continue;
    }
    if (stat.size > probe.sizeCap) {
      warnings.push({
        code: 'file_over_size_cap',
        message: `file '${p}' exceeds ${probe.sizeCap} bytes; tracked for navigation only`,
      });
      assocs.push({ path: p, mtime: stat.mtime, size: stat.size, sha256: null });
      continue;
    }
    // Synchronous hash — files are already known to be under the cap.
    const bytes = readFileSync(p);
    const hasher = new Bun.CryptoHasher('sha256');
    hasher.update(bytes);
    const sha256 = hasher.digest('hex');
    assocs.push({ path: p, mtime: stat.mtime, size: stat.size, sha256 });
  }
  return assocs;
}
