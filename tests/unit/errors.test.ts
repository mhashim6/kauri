import { describe, expect, test } from 'bun:test';

import {
  exitCodeFor,
  exitCodeForUnknown,
  isKauriError,
  KauriError,
  type ErrorCode,
} from '../../src/core/errors.ts';

describe('KauriError', () => {
  test('carries code, message, and details', () => {
    const e = new KauriError('not_found', 'no record', { id: 'kauri-DEC-0001' });
    expect(e.code).toBe('not_found');
    expect(e.message).toBe('no record');
    expect(e.details).toEqual({ id: 'kauri-DEC-0001' });
    expect(e.name).toBe('KauriError');
    expect(e).toBeInstanceOf(KauriError);
    expect(e).toBeInstanceOf(Error);
  });

  test('details defaults to undefined', () => {
    const e = new KauriError('usage', 'bad input');
    expect(e.details).toBeUndefined();
  });

  test('preserves stack trace', () => {
    const e = new KauriError('internal', 'oops');
    expect(typeof e.stack).toBe('string');
  });
});

describe('isKauriError', () => {
  test('returns true for a KauriError', () => {
    expect(isKauriError(new KauriError('usage', 'x'))).toBe(true);
  });

  test('returns false for a plain Error', () => {
    expect(isKauriError(new Error('plain'))).toBe(false);
  });

  test('returns false for non-error values', () => {
    expect(isKauriError(null)).toBe(false);
    expect(isKauriError(undefined)).toBe(false);
    expect(isKauriError('string')).toBe(false);
    expect(isKauriError(42)).toBe(false);
    expect(isKauriError({ code: 'usage' })).toBe(false);
  });
});

describe('exitCodeFor', () => {
  // Each documented mapping from kauri-spec.md § CLI › Exit Codes
  const cases: Array<[ErrorCode, number]> = [
    ['usage', 2],
    ['not_found', 3],
    ['stale_detected', 4],
    ['schema_behind', 5],
    ['schema_ahead', 6],
    ['invalid_input', 1],
    ['conflict', 1],
    ['corrupt_store', 1],
    ['io', 1],
    ['internal', 1],
  ];
  for (const [code, exit] of cases) {
    test(`${code} -> ${exit}`, () => {
      expect(exitCodeFor(new KauriError(code, ''))).toBe(exit);
    });
  }
});

describe('exitCodeForUnknown', () => {
  test('uses exitCodeFor for KauriError values', () => {
    expect(exitCodeForUnknown(new KauriError('not_found', ''))).toBe(3);
  });

  test('returns 1 for plain Error', () => {
    expect(exitCodeForUnknown(new Error('boom'))).toBe(1);
  });

  test('returns 1 for non-error values', () => {
    expect(exitCodeForUnknown(null)).toBe(1);
    expect(exitCodeForUnknown(undefined)).toBe(1);
    expect(exitCodeForUnknown('string')).toBe(1);
    expect(exitCodeForUnknown({})).toBe(1);
  });
});
