import { describe, expect, test } from 'bun:test';

import { compareFile, isTimeStale, type StoredFileState } from '../../src/core/staleness.ts';

// ---------------------------------------------------------------------------
// isTimeStale
// ---------------------------------------------------------------------------

describe('isTimeStale', () => {
  const jan1 = new Date('2026-01-01T00:00:00.000Z');

  test('returns false when effectiveTtl is null (disabled)', () => {
    expect(isTimeStale(jan1, '2025-01-01T00:00:00.000Z', null, null)).toBe(false);
  });

  test('returns false when effectiveTtl is negative (disabled)', () => {
    expect(isTimeStale(jan1, '2025-01-01T00:00:00.000Z', -1, null)).toBe(false);
  });

  test('uses recordTtl when provided', () => {
    // Record TTL = 30 days. Last validated 60 days ago. Stale.
    const nov2 = '2025-11-02T00:00:00.000Z'; // 60 days before jan1
    expect(isTimeStale(jan1, nov2, 30, 365)).toBe(true);
  });

  test('falls back to globalTtl when recordTtl is null', () => {
    const dec15 = '2025-12-15T00:00:00.000Z'; // 17 days before jan1
    // No record TTL, global = 30 days. 17 < 30 → not stale.
    expect(isTimeStale(jan1, dec15, null, 30)).toBe(false);
  });

  test('TTL = 0 means always stale', () => {
    // Last validated 1 second ago — but TTL is 0, so it's stale.
    const justNow = '2025-12-31T23:59:59.000Z';
    expect(isTimeStale(jan1, justNow, 0, null)).toBe(true);
  });

  test('not stale when within TTL', () => {
    const dec20 = '2025-12-20T00:00:00.000Z'; // 12 days before jan1
    expect(isTimeStale(jan1, dec20, null, 90)).toBe(false);
  });

  test('stale when exactly at boundary (> not >=)', () => {
    // TTL = 10 days, last validated exactly 10 days + 1 second ago.
    const validated = '2025-12-21T23:59:59.000Z';
    expect(isTimeStale(jan1, validated, 10, null)).toBe(true);
  });

  test('returns true for malformed lastValidated timestamp', () => {
    expect(isTimeStale(jan1, 'not-a-date', null, 90)).toBe(true);
    expect(isTimeStale(jan1, '', null, 90)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// compareFile
// ---------------------------------------------------------------------------

describe('compareFile', () => {
  const stored: StoredFileState = { mtime: 1000, size: 42, sha256: 'abc123' };

  test('returns unchanged when mtime + size both match', () => {
    const result = compareFile(stored, { mtime: 1000, size: 42 }, () => 'nope');
    expect(result).toEqual({ kind: 'unchanged' });
  });

  test('returns missing when freshStat is null', () => {
    expect(compareFile(stored, null, () => 'x')).toEqual({ kind: 'missing' });
  });

  test('returns over_cap when stored sha256 is null', () => {
    const overCap: StoredFileState = { mtime: 1000, size: 42, sha256: null };
    const result = compareFile(overCap, { mtime: 1001, size: 42 }, () => 'x');
    expect(result).toEqual({ kind: 'over_cap' });
  });

  test('returns touched_only when hash matches despite mtime change', () => {
    const result = compareFile(stored, { mtime: 2000, size: 42 }, () => 'abc123');
    expect(result).toEqual({ kind: 'touched_only', newMtime: 2000 });
  });

  test('returns touched_only when hash matches despite size change', () => {
    // Unusual: size changed but hash is the same. Could happen with
    // different encodings of the same content. We trust the hash.
    const result = compareFile(stored, { mtime: 1000, size: 50 }, () => 'abc123');
    expect(result).toEqual({ kind: 'touched_only', newMtime: 1000 });
  });

  test('returns changed when hash differs', () => {
    const result = compareFile(stored, { mtime: 2000, size: 50 }, () => 'different');
    expect(result).toEqual({ kind: 'changed' });
  });

  test('hash thunk is NOT called when mtime + size match (fast path)', () => {
    let called = false;
    compareFile(stored, { mtime: 1000, size: 42 }, () => {
      called = true;
      return 'x';
    });
    expect(called).toBe(false);
  });

  test('hash thunk IS called when mtime differs', () => {
    let called = false;
    compareFile(stored, { mtime: 2000, size: 42 }, () => {
      called = true;
      return 'abc123';
    });
    expect(called).toBe(true);
  });

  test('hash thunk is NOT called when file is missing', () => {
    let called = false;
    compareFile(stored, null, () => {
      called = true;
      return 'x';
    });
    expect(called).toBe(false);
  });

  test('hash thunk is NOT called when sha256 is null (over_cap)', () => {
    let called = false;
    const overCap: StoredFileState = { mtime: 1000, size: 42, sha256: null };
    compareFile(overCap, { mtime: 2000, size: 42 }, () => {
      called = true;
      return 'x';
    });
    expect(called).toBe(false);
  });
});
