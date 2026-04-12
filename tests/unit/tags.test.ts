import { describe, expect, test } from 'bun:test';

import { KauriError } from '../../src/core/errors.ts';
import { DEFAULT_TAXONOMY, isReservedTag, normalizeTag } from '../../src/core/tags.ts';

describe('normalizeTag — happy paths', () => {
  test('lowercase alphanumeric passes through', () => {
    expect(normalizeTag('api')).toBe('api');
    expect(normalizeTag('testing')).toBe('testing');
  });

  test('uppercase is lowercased', () => {
    expect(normalizeTag('API')).toBe('api');
    expect(normalizeTag('Testing')).toBe('testing');
  });

  test('hyphens are preserved', () => {
    expect(normalizeTag('user-experience')).toBe('user-experience');
  });

  test('digits are preserved', () => {
    expect(normalizeTag('http2')).toBe('http2');
    expect(normalizeTag('v1-2')).toBe('v1-2');
  });
});

describe('normalizeTag — normalisation', () => {
  test('spaces become hyphens', () => {
    expect(normalizeTag('user experience')).toBe('user-experience');
  });

  test('underscores are NOT preserved (tags differ from slugs here)', () => {
    expect(normalizeTag('user_experience')).toBe('user-experience');
    expect(normalizeTag('foo_bar_baz')).toBe('foo-bar-baz');
  });

  test('runs of disallowed characters collapse to a single hyphen', () => {
    expect(normalizeTag('foo!!!bar')).toBe('foo-bar');
    expect(normalizeTag('foo   bar')).toBe('foo-bar');
    expect(normalizeTag('foo___bar')).toBe('foo-bar');
  });

  test('leading and trailing disallowed characters are stripped', () => {
    expect(normalizeTag('  api  ')).toBe('api');
    expect(normalizeTag('!!!api!!!')).toBe('api');
    expect(normalizeTag('___api___')).toBe('api');
  });

  test('emoji are stripped', () => {
    expect(normalizeTag('hello🚀world')).toBe('hello-world');
  });

  test('unicode letters are stripped, not transliterated', () => {
    expect(normalizeTag('café')).toBe('caf');
  });
});

describe('normalizeTag — rejections', () => {
  test('empty input is rejected', () => {
    expect(() => normalizeTag('')).toThrow(KauriError);
  });

  test('whitespace-only input is rejected', () => {
    expect(() => normalizeTag('   ')).toThrow(KauriError);
  });

  test('input that normalises to empty is rejected', () => {
    expect(() => normalizeTag('!@#$%')).toThrow(KauriError);
    expect(() => normalizeTag('日本語')).toThrow(KauriError);
  });

  test('reserved value usr is rejected', () => {
    expect(() => normalizeTag('usr')).toThrow(KauriError);
    expect(() => normalizeTag('USR')).toThrow(KauriError);
  });

  test('reserved kind prefix dec is rejected', () => {
    expect(() => normalizeTag('dec')).toThrow(KauriError);
    expect(() => normalizeTag('DEC')).toThrow(KauriError);
  });

  test('rejection error has code "usage"', () => {
    try {
      normalizeTag('dec');
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(KauriError);
      expect((e as KauriError).code).toBe('usage');
    }
  });

  test('tags starting with reserved prefix are NOT rejected (only exact match)', () => {
    expect(normalizeTag('decision')).toBe('decision');
    expect(normalizeTag('user-thing')).toBe('user-thing');
  });
});

describe('isReservedTag', () => {
  test('returns true for reserved values', () => {
    expect(isReservedTag('usr')).toBe(true);
    expect(isReservedTag('dec')).toBe(true);
  });

  test('returns false for non-reserved values', () => {
    expect(isReservedTag('api')).toBe(false);
    expect(isReservedTag('decision')).toBe(false);
  });
});

describe('DEFAULT_TAXONOMY', () => {
  test('contains the 10 spec-defined tags', () => {
    expect(DEFAULT_TAXONOMY).toEqual([
      'api',
      'architecture',
      'boundary',
      'config',
      'convention',
      'data',
      'dependency',
      'security',
      'testing',
      'workflow',
    ]);
  });

  test('every default tag is itself a valid (idempotent) normalised tag', () => {
    for (const tag of DEFAULT_TAXONOMY) {
      expect(normalizeTag(tag)).toBe(tag);
    }
  });

  test('no default tag is reserved', () => {
    for (const tag of DEFAULT_TAXONOMY) {
      expect(isReservedTag(tag)).toBe(false);
    }
  });

  test('no duplicates', () => {
    const set = new Set(DEFAULT_TAXONOMY);
    expect(set.size).toBe(DEFAULT_TAXONOMY.length);
  });

  test('alphabetically sorted (matches seeded SQL order)', () => {
    const sorted = [...DEFAULT_TAXONOMY].sort();
    expect(DEFAULT_TAXONOMY).toEqual(sorted);
  });
});
