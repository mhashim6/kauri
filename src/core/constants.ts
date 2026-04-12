/**
 * Compile-time constants shared across the `core/*` module.
 *
 * Centralising the kind prefix table here lets `ids.ts`, `slug.ts`, and
 * `tags.ts` agree on what values are reserved without forming a circular
 * dependency between the three. Anything that lives in `meta` and is
 * configurable per-store should still have its *default* expressed here.
 *
 * Per the module-boundary rules, this file only imports types.
 */
import type { Kind } from './types.ts';

/**
 * Three-letter uppercase prefix used in record IDs, per kind.
 * Adding a new kind in v0.2+ is a one-line change here.
 */
export const KIND_PREFIX: Record<Kind, string> = {
  decision: 'DEC',
};

/** All known kind prefixes, in their canonical uppercase form. */
export const KIND_PREFIXES: readonly string[] = Object.values(KIND_PREFIX);

/** The same prefixes lowercased, used to populate reserved-value lists. */
export const KIND_PREFIXES_LOWER: readonly string[] = KIND_PREFIXES.map((p) => p.toLowerCase());

/** The literal prefix used in user-scope IDs (e.g. `usr-DEC-0001`). */
export const USER_SCOPE_PREFIX = 'usr';

/**
 * Slug and tag values that the normaliser must reject. A user choosing
 * "usr" as their project slug would collide with user-scope IDs; a tag
 * named "dec" would collide with the kind prefix.
 */
export const RESERVED_SLUGS_AND_TAGS: readonly string[] = [
  USER_SCOPE_PREFIX,
  ...KIND_PREFIXES_LOWER,
];

/**
 * Default values seeded into the `meta` table at `kauri init` time. These
 * are *initial* values; the user can change them per store. They live here
 * so unit tests can reference the same numbers without round-tripping
 * through the database.
 */
export const META_DEFAULTS = {
  /** Days before time-based staleness fires. Set to `null` in meta to disable. */
  defaultTtlDays: 90,
  /** Soft cap on the number of pinned records. */
  pinSoftCap: 10,
  /** Maximum file size eligible for sha256 hashing during staleness checks. */
  fileHashSizeCapBytes: 1024 * 1024,
} as const;

/** Schema version this binary expects. Bump in lockstep with new migrations. */
export const SCHEMA_VERSION = 1;

/**
 * Default tag taxonomy seeded at `kauri init` time. From `kauri-spec.md`
 * § Tag Taxonomy. Order is alphabetical to match the seeded order.
 */
export const DEFAULT_TAXONOMY: readonly string[] = [
  'api',
  'architecture',
  'boundary',
  'config',
  'convention',
  'data',
  'dependency',
  'security',
  'testing',
  'workflow',
];
