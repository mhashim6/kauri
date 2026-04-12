/**
 * Filesystem probe for staleness detection.
 *
 * Wraps the small set of filesystem operations the staleness detector
 * needs into a swappable interface so tests can supply a fake probe
 * (e.g. an in-memory file table) without touching the real disk. The
 * production implementation `systemFsProbe` uses Bun's APIs.
 *
 * The contract:
 *
 *   - `stat(absPath)` returns `{ mtime, size }` for an existing file
 *     or `null` when the file is missing. Errors other than ENOENT
 *     should bubble up to the caller.
 *
 *   - `hash(absPath)` returns the SHA-256 hex digest of the file's
 *     contents. The caller is responsible for checking the size cap
 *     before calling this — the probe does NOT enforce a cap.
 *
 *   - `sizeCap` is a number used by the caller (typically the staleness
 *     service) to decide whether to call `hash`. Files larger than the
 *     cap are tracked for navigation but not hashed.
 *
 * Per the module-boundary rules, this file lives under `src/fs/` and
 * may use Node and Bun runtime APIs. It must not import from `cli/`,
 * `mcp/`, `services/`, or `store/`.
 */
import { statSync } from 'node:fs';

import { META_DEFAULTS } from '../core/constants.ts';

import { sha256File } from './hash.ts';

/** A fast probe of file metadata: enough to power the mtime+size fast path. */
export interface FileStat {
  /** Unix epoch *seconds* — matches the storage format in `record_files`. */
  readonly mtime: number;
  /** File size in bytes. */
  readonly size: number;
}

export interface FsProbe {
  /** Returns metadata for the file or `null` if it doesn't exist. */
  stat(absPath: string): FileStat | null;
  /** Returns the SHA-256 hex digest of the file's contents. */
  hash(absPath: string): Promise<string>;
  /**
   * Configured maximum file size eligible for hashing. Files larger
   * than this are tracked but not hashed (their `sha256` baseline is
   * stored as `null`). Defaults to `META_DEFAULTS.fileHashSizeCapBytes`
   * (1 MiB) when the production probe is constructed without an
   * override.
   */
  readonly sizeCap: number;
}

/**
 * Production filesystem probe. Uses synchronous `node:fs.statSync`
 * (because the staleness detector runs in a tight loop and the async
 * cost dominates) and the streaming `sha256File` from `hash.ts`.
 */
export function systemFsProbe(opts: { sizeCap?: number } = {}): FsProbe {
  const sizeCap = opts.sizeCap ?? META_DEFAULTS.fileHashSizeCapBytes;
  return {
    sizeCap,
    stat(absPath: string): FileStat | null {
      try {
        const s = statSync(absPath);
        return {
          // statSync mtime is in milliseconds. We store seconds for
          // SQLite compactness and to match the spec's "unix epoch
          // seconds" requirement.
          mtime: Math.floor(s.mtimeMs / 1000),
          size: s.size,
        };
      } catch (err) {
        if (isMissingFileError(err)) {
          return null;
        }
        throw err;
      }
    },
    hash(absPath: string): Promise<string> {
      return sha256File(absPath);
    },
  };
}

/**
 * Recognise the various error shapes Node uses for "file not found"
 * across platforms. ENOENT is the common case; ENOTDIR happens when
 * a path component along the way is a file rather than a directory.
 * Both indicate "this path doesn't exist as a file".
 */
function isMissingFileError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const code = (err as { code?: unknown }).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}
