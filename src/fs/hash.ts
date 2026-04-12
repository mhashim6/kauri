/**
 * SHA-256 streaming hasher.
 *
 * Uses `Bun.CryptoHasher('sha256')` over `Bun.file(path).stream()` so
 * we never load the whole file into memory. The hash is computed
 * lazily and only on demand by the staleness detector — the
 * mtime + size fast path in `core/staleness.ts` skips this entirely
 * for the common "nothing changed" case.
 *
 * NOT to be confused with `Bun.hash`, which is a fast non-cryptographic
 * Wyhash. We need cross-machine stability and no collision concerns,
 * so SHA-256 is the right primitive.
 *
 * Per the module-boundary rules, this file lives under `src/fs/` and
 * may use Bun runtime APIs. It must not import from `cli/`, `mcp/`,
 * `services/`, or `store/`.
 */

/**
 * Compute the SHA-256 of a file at `absPath`. Returns the digest as
 * a lowercase hex string.
 *
 * Streams the file content so the in-memory footprint is bounded by
 * the chunk size, not the file size. Re-throws any error from the
 * underlying file read so the caller can decide whether to surface
 * it or treat the file as missing.
 */
export async function sha256File(absPath: string): Promise<string> {
  const hasher = new Bun.CryptoHasher('sha256');
  const stream = Bun.file(absPath).stream();
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      hasher.update(value);
    }
  } finally {
    reader.releaseLock();
  }
  return hasher.digest('hex');
}

/**
 * Compute the SHA-256 of a string. Used by tests to compare against
 * `sha256File` without writing a real file.
 */
export function sha256String(data: string): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(data);
  return hasher.digest('hex');
}
