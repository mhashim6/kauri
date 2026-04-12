/**
 * Service context — the glue between opened stores and service methods.
 *
 * A `StoreBundle` wraps a single `Store` plus all its repo instances
 * (constructed once, cached for the lifetime of the bundle). A
 * `ServiceContext` holds up to two bundles (project + user) plus shared
 * resources (clock, filesystem probe). Services receive a context and
 * use the helpers below to select the right bundle(s) for each
 * operation.
 *
 * **Why not a single "Service" class?** Because the services are
 * independent: `init` doesn't need the same context as `query`. Passing
 * a flat context keeps each service's signature honest about what it
 * touches, and makes testing trivial (construct a context with one
 * in-memory store, call the service, assert).
 */
import type { Clock } from '../core/clock.ts';
import { KauriError } from '../core/errors.ts';
import { parseId } from '../core/ids.ts';
import type { Scope, ScopeQuery } from '../core/types.ts';
import type { FsProbe } from '../fs/files.ts';
import { FilesRepo } from '../store/repo/files.ts';
import { MetaRepo } from '../store/repo/meta.ts';
import { RecordsRepo } from '../store/repo/records.ts';
import { RecordTagsRepo, TaxonomyRepo } from '../store/repo/tags.ts';
import type { Store } from '../store/store.ts';

// ---------------------------------------------------------------------------
// StoreBundle
// ---------------------------------------------------------------------------

/** A Store + all its repo instances. One per opened scope. */
export interface StoreBundle {
  readonly store: Store;
  readonly records: RecordsRepo;
  readonly tags: RecordTagsRepo;
  readonly taxonomy: TaxonomyRepo;
  readonly files: FilesRepo;
  readonly meta: MetaRepo;
}

/** Construct a StoreBundle from an opened Store. Repos are cached. */
export function makeStoreBundle(store: Store): StoreBundle {
  const taxonomy = new TaxonomyRepo(store.db);
  const tags = new RecordTagsRepo(store.db);
  const files = new FilesRepo(store.db);
  const records = new RecordsRepo(store.db, tags, files);
  const meta = new MetaRepo(store.db);
  return { store, records, tags, taxonomy, files, meta };
}

// ---------------------------------------------------------------------------
// ServiceContext
// ---------------------------------------------------------------------------

/**
 * Everything a service method needs. Built once per CLI invocation or
 * MCP session, passed to every service call.
 */
export interface ServiceContext {
  /** Bundle for the project store. `null` when not inside a project tree. */
  readonly projectBundle: StoreBundle | null;
  /** Bundle for the user store. `null` when user scope is not requested. */
  readonly userBundle: StoreBundle | null;
  readonly clock: Clock;
  readonly fsProbe: FsProbe;
}

// ---------------------------------------------------------------------------
// Scope resolution helpers
// ---------------------------------------------------------------------------

/**
 * Return all bundles the caller should iterate over for a read
 * operation. Empty array when neither scope is available — callers
 * should handle that as "no records".
 */
export function bundlesForRead(ctx: ServiceContext, scope: ScopeQuery): readonly StoreBundle[] {
  switch (scope) {
    case 'project':
      return ctx.projectBundle !== null ? [ctx.projectBundle] : [];
    case 'user':
      return ctx.userBundle !== null ? [ctx.userBundle] : [];
    case 'both': {
      const bundles: StoreBundle[] = [];
      if (ctx.projectBundle !== null) bundles.push(ctx.projectBundle);
      if (ctx.userBundle !== null) bundles.push(ctx.userBundle);
      return bundles;
    }
  }
}

/**
 * Return the single bundle to use for a write operation. The `scope`
 * parameter defaults: when inside a project tree, writes go to the
 * project store; otherwise they go to the user store. Throws when
 * the target scope is not available.
 */
export function bundleForWrite(ctx: ServiceContext, scope?: Scope): StoreBundle {
  const effective: Scope =
    scope ?? (ctx.projectBundle !== null ? 'project' : 'user');
  if (effective === 'project') {
    if (ctx.projectBundle === null) {
      throw new KauriError(
        'usage',
        'not inside a kauri project (no .kauri/store.db found in any ancestor directory)',
      );
    }
    return ctx.projectBundle;
  }
  if (ctx.userBundle === null) {
    throw new KauriError('usage', 'user-scope store is not available');
  }
  return ctx.userBundle;
}

/**
 * Given a record ID, determine which bundle owns it. IDs starting with
 * `usr-` belong to the user bundle; everything else belongs to the
 * project bundle. Throws when the owning bundle is not available.
 */
export function bundleForId(ctx: ServiceContext, id: string): StoreBundle {
  const parsed = parseId(id);
  return bundleForWrite(ctx, parsed.scope);
}
