/**
 * Taxonomy service — list and add tags across scopes.
 */
import type { ScopeQuery, Scope } from '../core/types.ts';
import type { Clock } from '../core/clock.ts';

import { bundleForWrite, bundlesForRead, type ServiceContext } from './context.ts';

/**
 * List all tags visible at `scope`. When scope is `'both'`, merges and
 * de-duplicates tags from both stores.
 */
export function listTags(ctx: ServiceContext, scope: ScopeQuery): readonly string[] {
  const bundles = bundlesForRead(ctx, scope);
  if (bundles.length === 0) {
    return [];
  }
  if (bundles.length === 1) {
    return (bundles[0] as (typeof bundles)[0]).taxonomy.list();
  }
  // Merge and dedupe.
  const merged = new Set<string>();
  for (const b of bundles) {
    for (const tag of b.taxonomy.list()) {
      merged.add(tag);
    }
  }
  return [...merged].sort();
}

/**
 * Add a tag to the taxonomy of the target scope. Returns `true` when
 * the tag was newly added, `false` if it already existed.
 */
export function addTag(
  ctx: ServiceContext,
  rawTag: string,
  scope: Scope | undefined,
  clock: Clock,
): boolean {
  const bundle = bundleForWrite(ctx, scope);
  return bundle.taxonomy.add(rawTag, clock.nowIso());
}
