/**
 * Tag normalisation, validation, and the default taxonomy.
 *
 * Tags follow the same shape rules as slugs (lowercase, hyphenated)
 * minus the underscore allowance — see `kauri-spec.md` § Tag Taxonomy
 * and § Tag Normalization.
 *
 * The default taxonomy seeded at `kauri init` time is exposed here as a
 * compile-time constant from `core/constants.ts`. Service layers and
 * tests reference it directly rather than re-querying the database.
 */
import { DEFAULT_TAXONOMY, RESERVED_SLUGS_AND_TAGS } from './constants.ts';
import { KauriError } from './errors.ts';
import { asciiSlugify } from './normalize.ts';

export { DEFAULT_TAXONOMY };

/**
 * Normalise an arbitrary input string to a valid tag.
 *
 * Throws `KauriError('usage', ...)` when:
 *  - the input normalises to an empty string,
 *  - the normalised value is reserved (`usr` or a kind prefix like `dec`).
 */
export function normalizeTag(input: string): string {
  const result = asciiSlugify(input, { allowUnderscore: false });
  if (result.length === 0) {
    throw new KauriError(
      'usage',
      `tag normalises to empty string from input: ${JSON.stringify(input)}`,
    );
  }
  if (isReservedTag(result)) {
    throw new KauriError(
      'usage',
      `tag ${JSON.stringify(result)} is reserved (cannot collide with 'usr' or kind prefixes)`,
    );
  }
  return result;
}

/**
 * Pure check (does not throw). `true` when the value is in the reserved set.
 * Caller is responsible for ensuring the input is already normalised.
 */
export function isReservedTag(tag: string): boolean {
  return RESERVED_SLUGS_AND_TAGS.includes(tag);
}
