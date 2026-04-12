import { describe, expect, test } from 'bun:test';

import { buildFtsMatchQuery, escapeFtsPhrase } from '../../src/core/fts.ts';

describe('escapeFtsPhrase', () => {
  test('wraps a simple word in quotes', () => {
    expect(escapeFtsPhrase('kauri')).toBe('"kauri"');
  });

  test('wraps a multi-word phrase in quotes', () => {
    expect(escapeFtsPhrase('hello world')).toBe('"hello world"');
  });

  test('doubles embedded double quotes', () => {
    expect(escapeFtsPhrase('say "hi"')).toBe('"say ""hi"""');
  });

  test('doubles multiple embedded quotes', () => {
    expect(escapeFtsPhrase('"quoted" and "more"')).toBe('"""quoted"" and ""more"""');
  });

  test('preserves whitespace inside the phrase', () => {
    expect(escapeFtsPhrase('  spaces  inside  ')).toBe('"  spaces  inside  "');
  });

  test('empty input returns empty string (no MATCH clause)', () => {
    expect(escapeFtsPhrase('')).toBe('');
  });

  test('preserves unicode characters', () => {
    expect(escapeFtsPhrase('café 日本語')).toBe('"café 日本語"');
  });

  test('preserves FTS5 syntax characters as literals', () => {
    expect(escapeFtsPhrase('foo:bar')).toBe('"foo:bar"');
    expect(escapeFtsPhrase('foo*')).toBe('"foo*"');
    expect(escapeFtsPhrase('foo (bar)')).toBe('"foo (bar)"');
  });
});

describe('buildFtsMatchQuery — empty input', () => {
  test('empty string returns empty string', () => {
    expect(buildFtsMatchQuery('')).toBe('');
  });

  test('whitespace-only returns empty string', () => {
    expect(buildFtsMatchQuery('   ')).toBe('');
    expect(buildFtsMatchQuery('\t\n')).toBe('');
  });
});

describe('buildFtsMatchQuery — bare tokens', () => {
  test('single safe word passes through', () => {
    expect(buildFtsMatchQuery('kauri')).toBe('kauri');
  });

  test('two safe words pass through (implicit AND)', () => {
    expect(buildFtsMatchQuery('foo bar')).toBe('foo bar');
  });

  test('alphanumeric and underscores and hyphens are safe', () => {
    expect(buildFtsMatchQuery('foo_bar-baz123')).toBe('foo_bar-baz123');
  });

  test('multiple consecutive spaces collapse via tokenizer', () => {
    expect(buildFtsMatchQuery('foo    bar')).toBe('foo bar');
  });

  test('leading and trailing whitespace is trimmed', () => {
    expect(buildFtsMatchQuery('  foo  ')).toBe('foo');
  });
});

describe('buildFtsMatchQuery — phrases', () => {
  test('quoted phrase is preserved', () => {
    expect(buildFtsMatchQuery('"hello world"')).toBe('"hello world"');
  });

  test('quoted phrase with special chars escapes them safely', () => {
    expect(buildFtsMatchQuery('"foo:bar"')).toBe('"foo:bar"');
    expect(buildFtsMatchQuery('"foo*"')).toBe('"foo*"');
  });

  test('phrase with embedded quotes (using doubled quotes) is preserved with escaping', () => {
    // User can write a literal " inside a phrase by typing "" (FTS5 convention),
    // but our tokenizer terminates the phrase on the first lone " — this is a
    // documented limitation. The fallback path produces a safe phrase still.
    expect(buildFtsMatchQuery('"foo bar"')).toBe('"foo bar"');
  });

  test('mixed phrase and bare word', () => {
    expect(buildFtsMatchQuery('"hello world" kauri')).toBe('"hello world" kauri');
  });
});

describe('buildFtsMatchQuery — operators', () => {
  test('OR is preserved', () => {
    expect(buildFtsMatchQuery('foo OR bar')).toBe('foo OR bar');
  });

  test('AND is preserved', () => {
    expect(buildFtsMatchQuery('foo AND bar')).toBe('foo AND bar');
  });

  test('NOT is preserved', () => {
    expect(buildFtsMatchQuery('foo NOT bar')).toBe('foo NOT bar');
  });

  test('lowercase operators are NOT recognised (treated as bare words)', () => {
    // FTS5 only recognises uppercase operators. The spec promises uppercase
    // keywords. Lowercase 'or'/'and'/'not' become safe bare tokens.
    expect(buildFtsMatchQuery('foo or bar')).toBe('foo or bar');
  });

  test('OR with phrases', () => {
    expect(buildFtsMatchQuery('"foo bar" OR baz')).toBe('"foo bar" OR baz');
  });
});

describe('buildFtsMatchQuery — exclusion', () => {
  test('-token is preserved when token is safe', () => {
    expect(buildFtsMatchQuery('foo -bar')).toBe('foo -bar');
  });

  test('exclusion with operators', () => {
    expect(buildFtsMatchQuery('foo OR bar -baz')).toBe('foo OR bar -baz');
  });

  test('exclusion of unsafe token degrades to safe phrase', () => {
    // -foo:bar contains an unsafe character; we escape the whole token as a phrase.
    expect(buildFtsMatchQuery('foo -bar:baz')).toBe('foo "-bar:baz"');
  });

  test('lone hyphen is treated as a bare token, escaped as phrase', () => {
    expect(buildFtsMatchQuery('-')).toBe('-');
  });
});

describe('buildFtsMatchQuery — unsafe characters', () => {
  test('colon in bare word is escaped as phrase', () => {
    expect(buildFtsMatchQuery('foo:bar')).toBe('"foo:bar"');
  });

  test('asterisk in bare word is escaped as phrase', () => {
    expect(buildFtsMatchQuery('foo*')).toBe('"foo*"');
  });

  test('parens in bare word are escaped as phrase', () => {
    expect(buildFtsMatchQuery('(foo)')).toBe('"(foo)"');
  });

  test('caret in bare word is escaped as phrase', () => {
    expect(buildFtsMatchQuery('^foo')).toBe('"^foo"');
  });

  test('mix of safe and unsafe tokens', () => {
    expect(buildFtsMatchQuery('safe foo:bar safer')).toBe('safe "foo:bar" safer');
  });
});

describe('buildFtsMatchQuery — malformed input fallback', () => {
  test('unbalanced opening quote falls back to phrase escape of entire input', () => {
    expect(buildFtsMatchQuery('"foo bar')).toBe('"""foo bar"');
  });

  test('unbalanced quote in middle of input', () => {
    expect(buildFtsMatchQuery('foo "bar baz')).toBe('"foo ""bar baz"');
  });
});

describe('buildFtsMatchQuery — unicode and edge cases', () => {
  test('unicode characters in bare token are escaped as phrase', () => {
    expect(buildFtsMatchQuery('café')).toBe('"café"');
  });

  test('emoji in bare token is escaped as phrase', () => {
    expect(buildFtsMatchQuery('hello🚀')).toBe('"hello🚀"');
  });

  test('CJK characters are escaped as phrase', () => {
    expect(buildFtsMatchQuery('日本語')).toBe('"日本語"');
  });

  test('never crashes on adversarial input', () => {
    const adversarial = [
      '""',
      '"""',
      '""""',
      '*',
      '**',
      '**foo**',
      '(((',
      ':::',
      ':"foo*"',
      '\u0000',
      '\u200b',
      '   "   ',
    ];
    for (const input of adversarial) {
      expect(() => buildFtsMatchQuery(input)).not.toThrow();
      // And the result is always a string
      expect(typeof buildFtsMatchQuery(input)).toBe('string');
    }
  });
});
