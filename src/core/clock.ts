/**
 * Injectable clock.
 *
 * Every service that needs to know "now" takes a `Clock` rather than calling
 * `Date.now()` directly. This makes time-sensitive logic (TTL staleness,
 * `last_validated` updates, projection sort order) deterministic in tests
 * and prevents the kind of flaky-by-microsecond bug we'd otherwise hit.
 *
 * Use `systemClock` in production wiring (CLI / MCP entry points). Use
 * `fixedClock(iso)` in unit tests where you need a deterministic timestamp.
 *
 * Per the module-boundary rules, this file imports nothing.
 */

export interface Clock {
  /** Returns a fresh `Date` representing "now". */
  now(): Date;
  /** Returns the current time as an ISO 8601 UTC string. */
  nowIso(): string;
}

/** Real wall-clock time. Used by production wiring. */
export const systemClock: Clock = {
  now: () => new Date(),
  nowIso: () => new Date().toISOString(),
};

/**
 * A clock that always returns the same instant.
 *
 * @param iso ISO 8601 UTC timestamp. Validated eagerly so tests fail fast
 *            on a bad fixture rather than producing garbage timestamps.
 */
export function fixedClock(iso: string): Clock {
  const fixed = new Date(iso);
  if (Number.isNaN(fixed.getTime())) {
    throw new TypeError(`fixedClock: invalid ISO 8601 timestamp: ${iso}`);
  }
  // Re-render to a canonical form so callers get the exact same string back.
  const canonical = fixed.toISOString();
  return {
    now: () => new Date(canonical),
    nowIso: () => canonical,
  };
}
