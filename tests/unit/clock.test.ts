import { describe, expect, test } from 'bun:test';

import { fixedClock, systemClock } from '../../src/core/clock.ts';

describe('systemClock', () => {
  test('nowIso returns an ISO 8601 string', () => {
    const iso = systemClock.nowIso();
    expect(typeof iso).toBe('string');
    // Round trip through Date should preserve the value
    expect(new Date(iso).toISOString()).toBe(iso);
  });

  test('now returns a Date', () => {
    expect(systemClock.now()).toBeInstanceOf(Date);
  });

  test('two consecutive nowIso calls are monotonic (or equal)', () => {
    const a = systemClock.nowIso();
    const b = systemClock.nowIso();
    expect(b >= a).toBe(true);
  });
});

describe('fixedClock', () => {
  test('returns the same iso every time', () => {
    const c = fixedClock('2026-04-11T10:30:00.000Z');
    expect(c.nowIso()).toBe('2026-04-11T10:30:00.000Z');
    expect(c.nowIso()).toBe('2026-04-11T10:30:00.000Z');
  });

  test('returns equivalent Date instances', () => {
    const c = fixedClock('2026-04-11T10:30:00.000Z');
    const d1 = c.now();
    const d2 = c.now();
    expect(d1.toISOString()).toBe(d2.toISOString());
    // Distinct Date instances so callers can mutate without affecting the clock
    expect(d1).not.toBe(d2);
  });

  test('canonicalises the input ISO string', () => {
    // Input without milliseconds should be normalised to a canonical ISO
    const c = fixedClock('2026-04-11T10:30:00Z');
    expect(c.nowIso()).toBe('2026-04-11T10:30:00.000Z');
  });

  test('throws on a malformed ISO string', () => {
    expect(() => fixedClock('not-a-date')).toThrow(TypeError);
  });

  test('throws on an empty string', () => {
    expect(() => fixedClock('')).toThrow(TypeError);
  });
});
