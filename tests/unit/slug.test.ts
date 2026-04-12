import { describe, expect, test } from 'bun:test';

import { KauriError } from '../../src/core/errors.ts';
import { isReservedSlug, normalizeSlug } from '../../src/core/slug.ts';

describe('normalizeSlug — happy paths', () => {
  test('lowercase alphanumeric passes through', () => {
    expect(normalizeSlug('kauri')).toBe('kauri');
    expect(normalizeSlug('myapp42')).toBe('myapp42');
  });

  test('uppercase is lowercased', () => {
    expect(normalizeSlug('KAURI')).toBe('kauri');
    expect(normalizeSlug('MyCoolApp')).toBe('mycoolapp');
  });

  test('hyphens are preserved', () => {
    expect(normalizeSlug('my-cool-app')).toBe('my-cool-app');
  });

  test('underscores are preserved (slugs allow them)', () => {
    expect(normalizeSlug('my_cool_app')).toBe('my_cool_app');
    expect(normalizeSlug('mix_of-both')).toBe('mix_of-both');
  });

  test('digits are preserved', () => {
    expect(normalizeSlug('app2')).toBe('app2');
    expect(normalizeSlug('v1-2-3')).toBe('v1-2-3');
  });
});

describe('normalizeSlug — normalisation', () => {
  test('spaces become hyphens', () => {
    expect(normalizeSlug('my cool app')).toBe('my-cool-app');
  });

  test('runs of disallowed characters collapse to a single hyphen', () => {
    expect(normalizeSlug('my!!!app')).toBe('my-app');
    expect(normalizeSlug('my   app')).toBe('my-app');
    expect(normalizeSlug('my...app')).toBe('my-app');
  });

  test('leading and trailing disallowed characters are stripped', () => {
    expect(normalizeSlug('   kauri   ')).toBe('kauri');
    expect(normalizeSlug('!!!kauri!!!')).toBe('kauri');
    expect(normalizeSlug('---kauri---')).toBe('kauri');
  });

  test('mixed whitespace and punctuation', () => {
    expect(normalizeSlug('  My Cool App!  ')).toBe('my-cool-app');
  });

  test('unicode letters are stripped, not transliterated', () => {
    // ASCII core preserved: 'café' -> 'caf'
    expect(normalizeSlug('café')).toBe('caf');
  });

  test('all-non-ASCII input normalises to empty (and is rejected)', () => {
    expect(() => normalizeSlug('日本語')).toThrow(KauriError);
  });

  test('emoji are stripped', () => {
    expect(normalizeSlug('hello🚀world')).toBe('hello-world');
  });

  test('paths and slashes become hyphens', () => {
    expect(normalizeSlug('foo/bar/baz')).toBe('foo-bar-baz');
  });
});

describe('normalizeSlug — rejections', () => {
  test('empty input is rejected', () => {
    expect(() => normalizeSlug('')).toThrow(KauriError);
  });

  test('whitespace-only input is rejected', () => {
    expect(() => normalizeSlug('   ')).toThrow(KauriError);
  });

  test('input that normalises to empty is rejected', () => {
    expect(() => normalizeSlug('!@#$%')).toThrow(KauriError);
    expect(() => normalizeSlug('日本語')).toThrow(KauriError);
  });

  test('reserved value usr is rejected', () => {
    expect(() => normalizeSlug('usr')).toThrow(KauriError);
    expect(() => normalizeSlug('USR')).toThrow(KauriError);
    expect(() => normalizeSlug('  Usr  ')).toThrow(KauriError);
  });

  test('reserved kind prefix dec is rejected', () => {
    expect(() => normalizeSlug('dec')).toThrow(KauriError);
    expect(() => normalizeSlug('DEC')).toThrow(KauriError);
  });

  test('rejection error has code "usage"', () => {
    try {
      normalizeSlug('usr');
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(KauriError);
      expect((e as KauriError).code).toBe('usage');
    }
  });

  test('slugs starting with reserved prefix are NOT rejected (only exact match)', () => {
    // 'usr-cool-app' contains 'usr' but is not literally 'usr', so it's fine.
    expect(normalizeSlug('usr-cool-app')).toBe('usr-cool-app');
    expect(normalizeSlug('decisive')).toBe('decisive');
  });
});

describe('isReservedSlug', () => {
  test('returns true for reserved values', () => {
    expect(isReservedSlug('usr')).toBe(true);
    expect(isReservedSlug('dec')).toBe(true);
  });

  test('returns false for non-reserved values', () => {
    expect(isReservedSlug('kauri')).toBe(false);
    expect(isReservedSlug('usr-cool')).toBe(false);
    expect(isReservedSlug('decision')).toBe(false);
  });

  test('case-sensitive — uppercase reserved values are NOT flagged (caller must normalise first)', () => {
    expect(isReservedSlug('USR')).toBe(false);
    expect(isReservedSlug('DEC')).toBe(false);
  });
});
