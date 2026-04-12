/**
 * `kauri init` — create and seed a new store.
 *
 * 1. Create the `.kauri/` directory (or `~/.kauri/` for user scope).
 * 2. Open the store (which runs pending migrations).
 * 3. Seed `meta` with the project slug and init timestamp.
 * 4. Seed `taxonomy` with the default tag vocabulary.
 *
 * Refuses to re-init if a store already exists at the target path.
 */
import { existsSync } from 'node:fs';

import type { Clock } from '../core/clock.ts';
import { DEFAULT_TAXONOMY } from '../core/constants.ts';
import { KauriError } from '../core/errors.ts';
import { normalizeSlug } from '../core/slug.ts';
import type { Scope } from '../core/types.ts';
import { MetaRepo } from '../store/repo/meta.ts';
import { TaxonomyRepo } from '../store/repo/tags.ts';
import { Store } from '../store/store.ts';

export interface InitInput {
  /** Where to create the store. Absolute path to the `.db` file. */
  readonly storePath: string;
  /** Which scope this store represents. */
  readonly scope: Scope;
  /**
   * Project slug. Required for project scope; ignored for user scope.
   * May be the raw directory name — will be normalised and validated.
   */
  readonly slug?: string | undefined;
  readonly clock: Clock;
}

export interface InitResult {
  /** Absolute path to the created store file. */
  readonly storePath: string;
  readonly scope: Scope;
  /** The normalised slug (project scope) or `'usr'` (user scope). */
  readonly slug: string;
  readonly createdAt: string;
}

/**
 * Create and seed a new Kauri store. Throws if a store already exists
 * at the given path (use `Store.openAt` to open an existing store).
 */
export function initStore(input: InitInput): InitResult {
  if (existsSync(input.storePath)) {
    throw new KauriError(
      'conflict',
      `a store already exists at ${input.storePath}; use 'kauri serve' or 'kauri record' to interact with it`,
      { path: input.storePath },
    );
  }

  const scope = input.scope;
  const slug =
    scope === 'project'
      ? normalizeSlug(input.slug ?? '')
      : 'usr';

  const now = input.clock.nowIso();
  const store = Store.openAt(input.storePath, scope);

  try {
    store.tx(() => {
      const meta = new MetaRepo(store.db);
      // For user scope, the slug is the literal 'usr' which is a reserved
      // value for normalizeSlug. We bypass re-validation and write directly.
      if (scope === 'user') {
        meta.set('slug', slug);
      } else {
        meta.setSlug(slug);
      }
      meta.setCreatedAt(now);

      const taxonomy = new TaxonomyRepo(store.db);
      taxonomy.addMany(DEFAULT_TAXONOMY, now);
    });
  } catch (err) {
    store.close();
    throw err;
  }

  store.close();

  return {
    storePath: input.storePath,
    scope,
    slug,
    createdAt: now,
  };
}
