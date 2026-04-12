/**
 * Structured errors for Kauri.
 *
 * Every recoverable failure inside Kauri throws a `KauriError` carrying an
 * `ErrorCode`. The CLI layer maps codes to process exit codes via
 * `exitCodeFor` (see `kauri-spec.md` § CLI › Exit Codes). The MCP layer
 * uses the same codes to produce structured tool errors.
 *
 * Anything that's not a `KauriError` is treated by the CLI as exit code 1
 * ("generic failure") — those represent bugs and should never be the
 * planned-for failure mode of any code path.
 */

/**
 * Discriminated error categories.
 *
 * Mapping to CLI exit codes:
 *   usage          -> 2  (flag parsing, body input rules, missing required args)
 *   not_found      -> 3  (record id, tag, file association, etc.)
 *   stale_detected -> 4  (only emitted by `kauri check --strict`)
 *   schema_behind  -> 5  (store needs migration before binary can use it)
 *   schema_ahead   -> 6  (store was written by a newer Kauri; user should upgrade)
 *
 * Everything else collapses to exit code 1:
 *   invalid_input  (rejected by service-layer validation)
 *   conflict       (e.g. supersede across scopes, edit forbidden field)
 *   corrupt_store  (sqlite reports corruption / unexpected schema state)
 *   io             (filesystem / spawn failures we surface verbatim)
 *   internal       (assertions, "this should never happen" guards)
 */
export type ErrorCode =
  | 'usage'
  | 'not_found'
  | 'stale_detected'
  | 'schema_behind'
  | 'schema_ahead'
  | 'invalid_input'
  | 'conflict'
  | 'corrupt_store'
  | 'io'
  | 'internal';

/**
 * The one error class Kauri throws on purpose. Always carries a code so the
 * CLI / MCP layers can decide how to surface it.
 *
 * Use the `details` field for structured context that the CLI's `--json`
 * mode can echo back to a programmatic caller.
 */
export class KauriError extends Error {
  public readonly code: ErrorCode;
  public readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'KauriError';
    this.code = code;
    this.details = details;
    // Preserve the prototype chain across `extends Error` (TS / V8 quirk).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Type guard. */
export function isKauriError(e: unknown): e is KauriError {
  return e instanceof KauriError;
}

/**
 * Map a `KauriError` to its CLI exit code. Codes not in the explicit table
 * fall through to 1 ("generic failure"). Non-`KauriError` thrown values
 * should be mapped by the caller using `exitCodeForUnknown`.
 */
export function exitCodeFor(e: KauriError): number {
  switch (e.code) {
    case 'usage':
      return 2;
    case 'not_found':
      return 3;
    case 'stale_detected':
      return 4;
    case 'schema_behind':
      return 5;
    case 'schema_ahead':
      return 6;
    case 'invalid_input':
    case 'conflict':
    case 'corrupt_store':
    case 'io':
    case 'internal':
      return 1;
  }
}

/**
 * Map any thrown value to a CLI exit code. Used by the top-level CLI
 * error handler — see `src/cli/main.ts` (Phase D).
 */
export function exitCodeForUnknown(e: unknown): number {
  if (isKauriError(e)) {
    return exitCodeFor(e);
  }
  return 1;
}
