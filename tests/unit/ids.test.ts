import { describe, expect, test } from 'bun:test';

import { KauriError } from '../../src/core/errors.ts';
import {
  formatCounter,
  formatId,
  kindFromPrefix,
  kindPrefix,
  nextCounter,
  parseId,
} from '../../src/core/ids.ts';

describe('kindPrefix', () => {
  test('decision -> DEC', () => {
    expect(kindPrefix('decision')).toBe('DEC');
  });
});

describe('kindFromPrefix', () => {
  test('DEC -> decision', () => {
    expect(kindFromPrefix('DEC')).toBe('decision');
  });

  test('unknown prefix returns null', () => {
    expect(kindFromPrefix('XYZ')).toBeNull();
    expect(kindFromPrefix('')).toBeNull();
  });

  test('case-sensitive (lowercase prefix is not recognised)', () => {
    expect(kindFromPrefix('dec')).toBeNull();
  });
});

describe('formatCounter', () => {
  test('zero-pads to 4 digits', () => {
    expect(formatCounter(1)).toBe('0001');
    expect(formatCounter(42)).toBe('0042');
    expect(formatCounter(999)).toBe('0999');
    expect(formatCounter(9999)).toBe('9999');
  });

  test('does not truncate counters wider than 4 digits', () => {
    expect(formatCounter(10000)).toBe('10000');
    expect(formatCounter(123456)).toBe('123456');
  });

  test('rejects 0', () => {
    expect(() => formatCounter(0)).toThrow(KauriError);
  });

  test('rejects negative integers', () => {
    expect(() => formatCounter(-1)).toThrow(KauriError);
    expect(() => formatCounter(-100)).toThrow(KauriError);
  });

  test('rejects non-integer numbers', () => {
    expect(() => formatCounter(1.5)).toThrow(KauriError);
    expect(() => formatCounter(Number.NaN)).toThrow(KauriError);
    expect(() => formatCounter(Number.POSITIVE_INFINITY)).toThrow(KauriError);
  });
});

describe('formatId', () => {
  test('project scope with simple slug', () => {
    expect(formatId('project', 'kauri', 'decision', 1)).toBe('kauri-DEC-0001');
  });

  test('project scope with hyphenated slug', () => {
    expect(formatId('project', 'my-cool-app', 'decision', 42)).toBe('my-cool-app-DEC-0042');
  });

  test('user scope ignores the supplied slug and uses usr', () => {
    expect(formatId('user', 'whatever', 'decision', 1)).toBe('usr-DEC-0001');
    expect(formatId('user', '', 'decision', 1)).toBe('usr-DEC-0001');
  });

  test('rejects empty slug for project scope', () => {
    expect(() => formatId('project', '', 'decision', 1)).toThrow(KauriError);
  });

  test('rejects bad counter through formatCounter', () => {
    expect(() => formatId('project', 'kauri', 'decision', 0)).toThrow(KauriError);
    expect(() => formatId('project', 'kauri', 'decision', -1)).toThrow(KauriError);
  });
});

describe('parseId — happy paths', () => {
  test('project scope with simple slug', () => {
    expect(parseId('kauri-DEC-0001')).toEqual({
      scope: 'project',
      slug: 'kauri',
      kind: 'decision',
      n: 1,
    });
  });

  test('project scope with hyphenated slug', () => {
    expect(parseId('my-cool-app-DEC-0042')).toEqual({
      scope: 'project',
      slug: 'my-cool-app',
      kind: 'decision',
      n: 42,
    });
  });

  test('project scope with deeply hyphenated slug', () => {
    expect(parseId('foo-bar-baz-qux-DEC-0007')).toEqual({
      scope: 'project',
      slug: 'foo-bar-baz-qux',
      kind: 'decision',
      n: 7,
    });
  });

  test('user scope', () => {
    expect(parseId('usr-DEC-0001')).toEqual({
      scope: 'user',
      slug: 'usr',
      kind: 'decision',
      n: 1,
    });
  });

  test('project scope with slug that starts with usr', () => {
    expect(parseId('usr-cool-DEC-0001')).toEqual({
      scope: 'project',
      slug: 'usr-cool',
      kind: 'decision',
      n: 1,
    });
  });

  test('counter wider than 4 digits', () => {
    expect(parseId('kauri-DEC-12345')).toEqual({
      scope: 'project',
      slug: 'kauri',
      kind: 'decision',
      n: 12345,
    });
  });

  test('counter without padding (legal but unusual)', () => {
    // The spec normalises new IDs to 4-digit padding, but we should still
    // accept hand-typed IDs without padding.
    expect(parseId('kauri-DEC-1').n).toBe(1);
  });
});

describe('parseId — rejections', () => {
  test('empty string', () => {
    expect(() => parseId('')).toThrow(KauriError);
  });

  test('not a string at all', () => {
    expect(() => parseId(undefined as unknown as string)).toThrow(KauriError);
    expect(() => parseId(null as unknown as string)).toThrow(KauriError);
    expect(() => parseId(42 as unknown as string)).toThrow(KauriError);
  });

  test('too few segments', () => {
    expect(() => parseId('kauri')).toThrow(KauriError);
    expect(() => parseId('kauri-DEC')).toThrow(KauriError);
  });

  test('non-numeric counter', () => {
    expect(() => parseId('kauri-DEC-abcd')).toThrow(KauriError);
    expect(() => parseId('kauri-DEC-1a')).toThrow(KauriError);
  });

  test('counter is zero', () => {
    expect(() => parseId('kauri-DEC-0000')).toThrow(KauriError);
  });

  test('unknown kind prefix', () => {
    expect(() => parseId('kauri-XYZ-0001')).toThrow(KauriError);
  });

  test('lowercase kind prefix is not recognised', () => {
    expect(() => parseId('kauri-dec-0001')).toThrow(KauriError);
  });

  test('empty slug prefix', () => {
    expect(() => parseId('-DEC-0001')).toThrow(KauriError);
  });
});

describe('parseId / formatId round trip', () => {
  const cases: ReadonlyArray<readonly [string, string, 'decision', number]> = [
    ['kauri', 'project', 'decision', 1],
    ['my-cool-app', 'project', 'decision', 42],
    ['foo-bar-baz', 'project', 'decision', 12345],
    ['usr-cool', 'project', 'decision', 7],
  ];
  for (const [slug, scope, kind, n] of cases) {
    test(`format -> parse: ${scope}/${slug}/${n}`, () => {
      const id = formatId(scope as 'project', slug, kind, n);
      const parsed = parseId(id);
      expect(parsed.scope).toBe(scope as 'project');
      expect(parsed.slug).toBe(slug);
      expect(parsed.kind).toBe(kind);
      expect(parsed.n).toBe(n);
    });
  }

  test('user scope round trip', () => {
    const id = formatId('user', 'ignored', 'decision', 99);
    const parsed = parseId(id);
    expect(parsed.scope).toBe('user');
    expect(parsed.slug).toBe('usr');
    expect(parsed.kind).toBe('decision');
    expect(parsed.n).toBe(99);
    // And formatting back from the parsed pieces yields the original.
    expect(formatId(parsed.scope, parsed.slug, parsed.kind, parsed.n)).toBe(id);
  });
});

describe('nextCounter', () => {
  test('0 -> 1', () => {
    expect(nextCounter(0)).toBe(1);
  });

  test('41 -> 42', () => {
    expect(nextCounter(41)).toBe(42);
  });

  test('rejects negative', () => {
    expect(() => nextCounter(-1)).toThrow(KauriError);
  });

  test('rejects non-integer', () => {
    expect(() => nextCounter(1.5)).toThrow(KauriError);
    expect(() => nextCounter(Number.NaN)).toThrow(KauriError);
  });
});
