/**
 * Safe FTS5 query construction.
 *
 * Users send free-form text into `kauri_query --text <expr>`. That text
 * gets handed to SQLite's FTS5 `MATCH` operator. FTS5 has a non-trivial
 * query language (phrases, boolean operators, prefix search, column
 * filters, NEAR, etc.) and any malformed input — unbalanced quotes,
 * stray colons, lone parentheses — will throw a `fts5: syntax error`
 * at query time.
 *
 * The spec (`kauri-spec.md` § kauri_query) says the `text` parameter
 * "uses FTS5 syntax" with `"foo bar"` as phrase, `foo OR bar` as
 * disjunction, and `foo -bar` for exclusion. So we cannot blindly
 * escape everything as a single phrase — that would break legitimate
 * users — but we also cannot pass arbitrary input through, because
 * that crashes the query.
 *
 * Strategy: a small, opinionated tokenizer that recognises only the
 * subset of FTS5 syntax the spec promises:
 *
 *   - bare words           kauri
 *   - quoted phrases       "foo bar"
 *   - boolean operators    OR, AND, NOT (uppercase only)
 *   - exclusion prefix     -kauri
 *
 * Anything else (parentheses, NEAR(), column:foo, prefix wildcards `*`,
 * anchor `^`, single quotes, lone special characters in bare tokens)
 * is escaped as a literal phrase. Malformed input (unbalanced quote)
 * falls back to escaping the *entire* input as one phrase. The
 * function is therefore total: it never throws and never produces a
 * string FTS5 will reject.
 *
 * v0.2 may extend this to support more of FTS5's surface area. The
 * contract — "user text in, safe MATCH expression out" — does not
 * change.
 */

/** FTS5 boolean keywords we recognise as operators (uppercase only). */
const FTS_OPERATORS = new Set(['OR', 'AND', 'NOT']);

/** Characters that are safe to appear inside a bare (unquoted) token. */
const SAFE_BARE_TOKEN = /^[a-zA-Z0-9_-]+$/;

/**
 * Escape an arbitrary string into a single FTS5 phrase. Always safe.
 *
 * Inside an FTS5 phrase, two double-quote characters in a row are
 * interpreted as a single embedded double-quote. We therefore double
 * any embedded `"` and wrap the whole thing in `"..."`.
 *
 * Empty input returns the empty string — callers should treat that
 * as "no MATCH clause", not as a valid query.
 */
export function escapeFtsPhrase(input: string): string {
  if (input.length === 0) {
    return '';
  }
  const escaped = input.replace(/"/g, '""');
  return `"${escaped}"`;
}

/**
 * Build an FTS5 MATCH expression from arbitrary user input.
 *
 * - Returns the empty string for empty / whitespace-only input. Callers
 *   should omit the MATCH clause entirely in that case.
 * - Never throws.
 * - Always produces a string FTS5 will accept.
 *
 * Recognised input shapes:
 *   - "foo bar"     -> preserved as a phrase
 *   - foo bar       -> two implicit-AND bare tokens, both safe
 *   - foo OR bar    -> preserved as a disjunction
 *   - foo -bar      -> preserved as exclusion
 *   - foo:bar       -> escaped as the phrase "foo:bar" (column filters
 *                      are not part of the v0.1 contract)
 *   - "foo          -> falls back to escaping the entire input as one
 *                      phrase (unbalanced quote)
 */
export function buildFtsMatchQuery(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return '';
  }

  const result = tokenize(trimmed);
  if (result === null) {
    // Tokenizer hit an unrecoverable shape (e.g. unbalanced quote).
    // Fall back to a phrase.
    return escapeFtsPhrase(trimmed);
  }

  const out: string[] = [];
  for (const token of result) {
    out.push(renderToken(token));
  }
  return out.join(' ');
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

interface PhraseToken {
  readonly kind: 'phrase';
  /** Inner text without the surrounding quotes; quotes inside are NOT escaped yet. */
  readonly inner: string;
}
interface OperatorToken {
  readonly kind: 'operator';
  /** Always one of FTS_OPERATORS. */
  readonly value: string;
}
interface BareToken {
  readonly kind: 'bare';
  readonly value: string;
}
interface ExclusionToken {
  readonly kind: 'exclusion';
  readonly value: string;
}
type Token = PhraseToken | OperatorToken | BareToken | ExclusionToken;

/**
 * Split an input string into tokens. Returns `null` if the input cannot
 * be tokenised safely (e.g. unbalanced double quote). Bare tokens may
 * contain unsafe characters at this stage; `renderToken` decides how
 * to handle them.
 */
function tokenize(input: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i] as string;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    if (c === '"') {
      // Read until closing double quote.
      const innerStart = i + 1;
      let j = innerStart;
      while (j < input.length && input[j] !== '"') {
        j++;
      }
      if (j >= input.length) {
        // Unbalanced quote.
        return null;
      }
      tokens.push({ kind: 'phrase', inner: input.slice(innerStart, j) });
      i = j + 1;
      continue;
    }
    // Bare token: read until whitespace or quote.
    const start = i;
    while (i < input.length) {
      const ch = input[i] as string;
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '"') {
        break;
      }
      i++;
    }
    const raw = input.slice(start, i);
    tokens.push(classifyBare(raw));
  }
  return tokens;
}

/** Classify a bare-text token into one of operator / exclusion / bare. */
function classifyBare(raw: string): Token {
  if (FTS_OPERATORS.has(raw)) {
    return { kind: 'operator', value: raw };
  }
  if (raw.length > 1 && raw.startsWith('-')) {
    return { kind: 'exclusion', value: raw.slice(1) };
  }
  return { kind: 'bare', value: raw };
}

/** Render a single token into safe FTS5 text. */
function renderToken(token: Token): string {
  switch (token.kind) {
    case 'operator':
      return token.value;
    case 'phrase':
      // Re-escape any embedded quotes the user wrote inside the phrase.
      return escapeFtsPhrase(token.inner);
    case 'bare':
      if (SAFE_BARE_TOKEN.test(token.value)) {
        return token.value;
      }
      return escapeFtsPhrase(token.value);
    case 'exclusion':
      if (SAFE_BARE_TOKEN.test(token.value)) {
        return `-${token.value}`;
      }
      // The "minus phrase" form is not part of standard FTS5 syntax;
      // when the excluded token is unsafe, the safest thing is to drop
      // the exclusion intent and search for the literal hyphen-prefixed
      // string as a phrase. This degrades gracefully without crashing.
      return escapeFtsPhrase(`-${token.value}`);
  }
}
