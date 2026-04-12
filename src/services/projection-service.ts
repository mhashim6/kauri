/**
 * Projection service — assembles the input for `core/projection.ts`
 * from one or both stores.
 *
 * The projection is what `kauri project` emits: an index of all
 * active records (with full bodies for pinned records) plus computed
 * staleness annotations. This service does the data assembly; the
 * actual text/JSON rendering lives in `core/projection.ts`.
 */
import {
  type ProjectionInput,
  type ProjectionJson,
  renderJson,
  renderText,
} from '../core/projection.ts';
import type { KauriRecord, ScopeQuery } from '../core/types.ts';

import { bundlesForRead, type ServiceContext, type StoreBundle } from './context.ts';
import { computeStaleIds } from './check-service.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectInput {
  readonly scope: ScopeQuery;
  readonly tags?: readonly string[] | undefined;
  readonly includeDrafts?: boolean | undefined;
  readonly full?: boolean | undefined;
  readonly format?: 'text' | 'json' | undefined;
}

export interface ProjectResult {
  readonly text?: string;
  readonly json?: ProjectionJson;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function projectRecords(ctx: ServiceContext, input: ProjectInput): ProjectResult {
  const bundles = bundlesForRead(ctx, input.scope);
  const staleIds = computeStaleIds(ctx, input.scope);

  // Collect records from all bundles.
  const pinned: KauriRecord[] = [];
  const indexed: KauriRecord[] = [];
  let activeCount = 0;
  let pinnedCount = 0;
  let draftCount = 0;

  for (const bundle of bundles) {
    collectRecords(bundle, input, pinned, indexed, {
      onActive: () => activeCount++,
      onPinned: () => pinnedCount++,
      onDraft: () => draftCount++,
    });
  }

  // Sort both sets by created desc.
  const sortDesc = (a: KauriRecord, b: KauriRecord): number =>
    b.created > a.created ? 1 : b.created < a.created ? -1 : 0;
  pinned.sort(sortDesc);
  indexed.sort(sortDesc);

  // Build the slug label for the title.
  const slugLabel = buildSlugLabel(bundles, input.scope);

  const projInput: ProjectionInput = {
    slugLabel,
    counts: { active: activeCount, pinned: pinnedCount, drafts: draftCount },
    pinned,
    indexed,
    staleIds,
    full: input.full ?? false,
    includeDrafts: input.includeDrafts ?? false,
  };

  const format = input.format ?? 'text';
  if (format === 'json') {
    return { json: renderJson(projInput) };
  }
  return { text: renderText(projInput) };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface Counters {
  onActive: () => void;
  onPinned: () => void;
  onDraft: () => void;
}

function collectRecords(
  bundle: StoreBundle,
  input: ProjectInput,
  pinned: KauriRecord[],
  indexed: KauriRecord[],
  counters: Counters,
): void {
  // Active records. Build filter conditionally (exactOptionalPropertyTypes).
  const tagFilter = input.tags !== undefined ? { tags: input.tags } : {};
  const { records: active } = bundle.records.query({
    status: 'active',
    ...tagFilter,
    limit: 100000,
    offset: 0,
  });
  for (const r of active) {
    counters.onActive();
    if (r.pinned) {
      counters.onPinned();
      pinned.push(r);
    } else {
      indexed.push(r);
    }
  }

  // Drafts (if requested).
  if (input.includeDrafts) {
    const { records: drafts } = bundle.records.query({
      status: 'draft',
      ...tagFilter,
      limit: 100000,
      offset: 0,
    });
    for (const d of drafts) {
      counters.onDraft();
      if (d.pinned) {
        counters.onPinned();
        pinned.push(d);
      } else {
        indexed.push(d);
      }
    }
  }
}

function buildSlugLabel(bundles: readonly StoreBundle[], scope: ScopeQuery): string {
  if (scope === 'both' && bundles.length === 2) {
    return 'both';
  }
  if (bundles.length === 1) {
    const b = bundles[0] as StoreBundle;
    return b.meta.getSlug() ?? b.store.scope;
  }
  if (bundles.length === 0) {
    return scope === 'user' ? 'usr' : 'unknown';
  }
  return 'both';
}
