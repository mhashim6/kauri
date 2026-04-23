/**
 * Pure type definitions for Kauri.
 *
 * This module is intentionally tiny and contains zero runtime values
 * (apart from the const-asserted `KINDS` array, which is used for
 * type-narrowing helpers in `core/ids.ts`). Anything that needs runtime
 * behaviour belongs elsewhere — usually `core/errors.ts`, `core/ids.ts`,
 * or `core/normalize.ts`.
 *
 * Per the module-boundary rules, this file imports nothing.
 */

/** Where a record physically lives. */
export type Scope = 'project' | 'user';

/** Like `Scope` but with the merged-read sentinel that callers may pass. */
export type ScopeQuery = Scope | 'both';

/** Lifecycle states. See `kauri-spec.md` § Status Lifecycle. */
export type Status = 'draft' | 'active' | 'superseded' | 'deprecated';

/**
 * Record kinds. v0.1 ships only `decision`. The `kind` discriminator and
 * the corresponding ID prefix table in `core/ids.ts` are forward-compatibility
 * hooks for additional kinds in v0.2+.
 */
export type Kind = 'decision';

/** Verdicts accepted by `kauri validate`. */
export type Verdict = 'still_valid' | 'deprecate';

/** A file associated with a record, plus the staleness baseline at validation time. */
export interface FileAssoc {
  /** Repo-relative path. */
  readonly path: string;
  /** Unix epoch seconds at the time we last observed this file. */
  readonly mtime: number;
  /** File size in bytes at the time we last observed this file. */
  readonly size: number;
  /**
   * sha256 hex digest at the time we last observed this file. `null` means
   * the file exceeded the configured size cap and is tracked for navigation
   * only — staleness based on hash is skipped for it.
   */
  readonly sha256: string | null;
}

/**
 * The full shape of a Kauri record, in the camelCase form used everywhere
 * outside the SQLite layer. Repo mappers in `src/store/schema.ts` translate
 * to/from snake_case rows.
 */
export interface KauriRecord {
  readonly id: string;
  readonly kind: Kind;
  readonly scope: Scope;
  readonly status: Status;
  readonly title: string;
  readonly body: string;
  readonly tags: readonly string[];
  readonly files: readonly FileAssoc[];
  /** IDs of related records (bidirectional — both directions are merged on read). */
  readonly links: readonly string[];
  readonly source: string;
  readonly supersedes: string | null;
  readonly supersededBy: string | null;
  /** `null` means "use the global default from `meta.default_ttl_days`". */
  readonly ttlDays: number | null;
  readonly pinned: boolean;
  /** Reserved for kind-specific fields in v0.2+. Always `null` in v0.1. */
  readonly payload: null;
  readonly revision: number;
  /** ISO 8601 UTC. */
  readonly created: string;
  /** ISO 8601 UTC. Bumped on every `update`, `validate`, `pin`, `unpin`. */
  readonly lastModified: string;
  /** ISO 8601 UTC. Set on `record` and updated by `validate still_valid`. */
  readonly lastValidated: string;
}

/** Non-fatal feedback returned alongside an operation result. */
export interface Warning {
  readonly code: string;
  readonly message: string;
}
