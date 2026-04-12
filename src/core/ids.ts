/**
 * Record ID formatting and parsing.
 *
 * IDs follow the format `<prefix>-<KIND>-<NNNN>` where:
 *  - `<prefix>` is the project slug for project-scoped records, or the
 *    literal `usr` for user-scoped records,
 *  - `<KIND>` is the three-letter uppercase prefix for the record kind
 *    (e.g. `DEC` for `decision`),
 *  - `<NNNN>` is a zero-padded counter, minimum width 4 digits, monotonic
 *    per (scope, kind) tuple.
 *
 * Examples:
 *   `kauri-DEC-0001`     project scope, slug `kauri`, decision #1
 *   `usr-DEC-0042`       user scope, decision #42
 *   `my-cool-app-DEC-0003`  hyphenated slug — note that we always parse
 *                           kind and counter from the *right*, so a slug
 *                           may legally contain hyphens.
 *
 * See `kauri-spec.md` § ID Format and § Slug Rules.
 */
import { KIND_PREFIX, USER_SCOPE_PREFIX } from './constants.ts';
import { KauriError } from './errors.ts';
import type { Kind, Scope } from './types.ts';

/** Minimum number of digits used when zero-padding the counter. */
const COUNTER_MIN_WIDTH = 4;

/**
 * The structured pieces of a parsed record ID.
 *
 * For project-scope IDs, `slug` is the actual project slug. For user-scope
 * IDs, `slug` is the literal `'usr'` (matching `USER_SCOPE_PREFIX`) so the
 * round trip `formatId(parseId(id))` is always identity.
 */
export interface ParsedId {
  readonly scope: Scope;
  readonly slug: string;
  readonly kind: Kind;
  readonly n: number;
}

/** Returns the canonical uppercase prefix for a kind. */
export function kindPrefix(kind: Kind): string {
  return KIND_PREFIX[kind];
}

/**
 * Reverse lookup: prefix string -> kind. Returns `null` for unknown
 * prefixes (so callers can decide whether to throw or fall back).
 *
 * Implemented as a linear scan because the table has one entry today and
 * is expected to stay tiny. Promote to a Map if it ever exceeds ~10 kinds.
 */
export function kindFromPrefix(prefix: string): Kind | null {
  const entries = Object.entries(KIND_PREFIX) as Array<[Kind, string]>;
  for (const [kind, p] of entries) {
    if (p === prefix) {
      return kind;
    }
  }
  return null;
}

/**
 * Format the counter portion of an ID. Pads to at least
 * `COUNTER_MIN_WIDTH` digits but does not truncate larger numbers — a
 * project that legitimately has 12345 records will produce IDs like
 * `kauri-DEC-12345`, which is wider than 4 but still valid.
 *
 * Throws `KauriError('invalid_input', ...)` for non-positive integers.
 */
export function formatCounter(n: number): string {
  if (!Number.isInteger(n) || n < 1) {
    throw new KauriError(
      'invalid_input',
      `record counter must be a positive integer, got ${String(n)}`,
    );
  }
  return n.toString().padStart(COUNTER_MIN_WIDTH, '0');
}

/**
 * Format a record ID from its components.
 *
 * The `slug` argument is only consulted for project-scope records; for
 * user-scope records the literal `usr` prefix is always used regardless
 * of what's passed (though we still accept the param for API symmetry).
 */
export function formatId(scope: Scope, slug: string, kind: Kind, n: number): string {
  const prefix = scope === 'user' ? USER_SCOPE_PREFIX : slug;
  if (prefix.length === 0) {
    throw new KauriError('invalid_input', 'cannot format an id with an empty slug prefix');
  }
  return `${prefix}-${kindPrefix(kind)}-${formatCounter(n)}`;
}

/**
 * Parse a record ID into its components.
 *
 * Slugs may legally contain hyphens (e.g. `my-cool-app`), so we split on
 * `-` and treat the *last two* segments as `<KIND>` and `<NNNN>`. Anything
 * before that is rejoined to form the slug. The kind segment is matched
 * against `KIND_PREFIXES` (case-sensitive — kind prefixes are uppercase).
 *
 * Throws `KauriError('invalid_input', ...)` on every malformed shape with
 * an explanatory message naming the offending input.
 */
export function parseId(id: string): ParsedId {
  if (typeof id !== 'string' || id.length === 0) {
    throw new KauriError('invalid_input', `id must be a non-empty string, got ${JSON.stringify(id)}`);
  }
  const parts = id.split('-');
  if (parts.length < 3) {
    throw new KauriError(
      'invalid_input',
      `id ${JSON.stringify(id)} does not match '<slug>-<KIND>-<NNNN>' shape`,
    );
  }
  const counterStr = parts[parts.length - 1] as string;
  const kindStr = parts[parts.length - 2] as string;
  const slugParts = parts.slice(0, -2);
  const slug = slugParts.join('-');

  if (slug.length === 0) {
    throw new KauriError('invalid_input', `id ${JSON.stringify(id)} has empty slug prefix`);
  }
  if (!/^\d+$/.test(counterStr)) {
    throw new KauriError(
      'invalid_input',
      `id ${JSON.stringify(id)} has non-numeric counter ${JSON.stringify(counterStr)}`,
    );
  }
  const n = Number.parseInt(counterStr, 10);
  if (n < 1) {
    throw new KauriError(
      'invalid_input',
      `id ${JSON.stringify(id)} has counter < 1 (${counterStr})`,
    );
  }
  const kind = kindFromPrefix(kindStr);
  if (kind === null) {
    throw new KauriError(
      'invalid_input',
      `id ${JSON.stringify(id)} has unknown kind prefix ${JSON.stringify(kindStr)}`,
    );
  }
  const scope: Scope = slug === USER_SCOPE_PREFIX ? 'user' : 'project';

  return { scope, slug, kind, n };
}

/**
 * Compute the next counter value given the current maximum for a
 * (scope, kind) pair. Returns `1` when there are no existing records
 * (`existingMax === 0`).
 *
 * This function is intentionally trivial; it lives here so the rule
 * "next = max + 1" is testable in isolation, separate from the storage
 * layer that supplies the max.
 */
export function nextCounter(existingMax: number): number {
  if (!Number.isInteger(existingMax) || existingMax < 0) {
    throw new KauriError(
      'invalid_input',
      `existingMax must be a non-negative integer, got ${String(existingMax)}`,
    );
  }
  return existingMax + 1;
}
