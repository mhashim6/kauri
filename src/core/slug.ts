/**
 * Project slug normalisation.
 *
 * The project slug is set at `kauri init` time and forms the prefix of
 * every project-scoped record ID (e.g. `kauri-DEC-0001`). Slugs must be
 * stable forever after init, so the normalisation rules are deliberately
 * narrow — see `kauri-spec.md` § Slug Rules.
 *
 * Slugs allow lowercase ASCII letters, digits, hyphens, and underscores.
 * Tags use the same algorithm but disallow underscores; the shared
 * primitive lives in `core/normalize.ts`.
 */
import { RESERVED_SLUGS_AND_TAGS } from './constants.ts';
import { KauriError } from './errors.ts';
import { asciiSlugify } from './normalize.ts';

/**
 * Normalise an arbitrary input string to a valid Kauri project slug.
 *
 * Throws `KauriError('usage', ...)` when:
 *  - the input normalises to an empty string (e.g. `"!@#"` or `""`),
 *  - the normalised value is reserved (`usr` or any kind prefix like `dec`).
 *
 * The reserved-value check is performed *after* normalisation so that input
 * like `"USR"` or `"  usr  "` is also rejected.
 */
export function normalizeSlug(input: string): string {
  const result = asciiSlugify(input, { allowUnderscore: true });
  if (result.length === 0) {
    throw new KauriError(
      'usage',
      `slug normalises to empty string from input: ${JSON.stringify(input)}`,
    );
  }
  if (isReservedSlug(result)) {
    throw new KauriError(
      'usage',
      `slug ${JSON.stringify(result)} is reserved (cannot collide with 'usr' or kind prefixes)`,
    );
  }
  return result;
}

/**
 * Pure check (does not throw). `true` when the value is in the reserved set.
 * Caller is responsible for ensuring the input is already normalised.
 */
export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS_AND_TAGS.includes(slug);
}
