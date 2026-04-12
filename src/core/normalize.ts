/**
 * Shared text-normalisation primitive used by `slug.ts` and `tags.ts`.
 *
 * Both slugs and tags follow the same algorithm: lowercase, collapse runs
 * of disallowed characters into a single hyphen, strip leading and trailing
 * hyphens. The only difference is whether the underscore is permitted in
 * the output (slugs allow `_`, tags do not — see `kauri-spec.md` § Slug
 * Rules and § Tag Normalization).
 *
 * Keeping this primitive in one place is the DRY response to "the slug and
 * tag rules are nearly identical" without leaking the details into either
 * caller.
 *
 * This file imports nothing.
 */

export interface NormalizeOptions {
  /** When `true`, the underscore character is preserved. Used by slugs. */
  readonly allowUnderscore: boolean;
}

/**
 * Lowercase, collapse runs of disallowed characters to a single `-`,
 * and strip leading / trailing `-`. The result may be the empty string;
 * callers are responsible for rejecting that.
 *
 * Pure: same input always produces same output. No exceptions thrown.
 */
export function asciiSlugify(input: string, opts: NormalizeOptions): string {
  const lowered = input.toLowerCase();
  // Two character classes — picking one at compile time would let us inline
  // the regex, but the JIT optimises this fine and the explicit branch is
  // easier to follow than a regex factory.
  const disallowed = opts.allowUnderscore ? /[^a-z0-9_-]+/g : /[^a-z0-9-]+/g;
  const collapsed = lowered.replace(disallowed, '-');
  return collapsed.replace(/^-+|-+$/g, '');
}
