/**
 * CLI output helpers — text vs JSON, error rendering, exit codes.
 */
import { exitCodeForUnknown, isKauriError } from '../core/errors.ts';

/**
 * Print a result in either JSON or text mode. When JSON, the value is
 * serialised with 2-space indent. When text, the caller supplies a
 * pre-formatted string.
 */
export function printResult(value: unknown, text: string, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
  } else {
    console.log(text);
  }
}

/** Print a JSON result only (when there's no meaningful text form). */
export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

/** Print a plain text line. */
export function printText(text: string): void {
  console.log(text);
}

/**
 * Handle a thrown error: print it to stderr and exit with the correct
 * code. In JSON mode, the error is serialised as `{ error: { ... } }`.
 */
export function handleError(err: unknown, json: boolean): never {
  if (isKauriError(err)) {
    if (json) {
      console.error(
        JSON.stringify(
          { error: { code: err.code, message: err.message, details: err.details } },
          null,
          2,
        ),
      );
    } else {
      console.error(`error: ${err.message}`);
    }
  } else if (err instanceof Error) {
    if (json) {
      console.error(JSON.stringify({ error: { code: 'internal', message: err.message } }, null, 2));
    } else {
      console.error(`error: ${err.message}`);
    }
  } else {
    console.error('error: unknown failure');
  }
  process.exit(exitCodeForUnknown(err));
}
