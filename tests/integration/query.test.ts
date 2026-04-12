/**
 * Integration tests for RecordsRepo.query — the SQL filter builder,
 * FTS5 hookup, and pagination.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { KauriError } from '../../src/core/errors.ts';
import { FilesRepo } from '../../src/store/repo/files.ts';
import {
  type NewRecordInput,
  RecordsRepo,
} from '../../src/store/repo/records.ts';
import { RecordTagsRepo, TaxonomyRepo } from '../../src/store/repo/tags.ts';
import { makeTmpStore, type TmpStore } from '../helpers/tmp-store.ts';

let tmp: TmpStore;
let records: RecordsRepo;
let tags: RecordTagsRepo;
let taxonomy: TaxonomyRepo;
let files: FilesRepo;

beforeEach(() => {
  tmp = makeTmpStore();
  taxonomy = new TaxonomyRepo(tmp.store.db);
  tags = new RecordTagsRepo(tmp.store.db);
  files = new FilesRepo(tmp.store.db);
  records = new RecordsRepo(tmp.store.db, tags, files);
  // Pre-seed taxonomy with the tags used across tests in this file.
  taxonomy.addMany(['api', 'security', 'data', 'testing'], '2026-01-01T00:00:00.000Z');
});

afterEach(() => {
  tmp?.cleanup();
});

function makeInput(overrides: Partial<NewRecordInput> = {}): NewRecordInput {
  return {
    kind: 'decision',
    scope: 'project',
    slug: 'kauri',
    status: 'active',
    title: 'Default title',
    body: 'default body',
    source: 'agent:test',
    supersedes: null,
    ttlDays: null,
    pinned: false,
    created: '2026-01-01T00:00:00.000Z',
    lastModified: '2026-01-01T00:00:00.000Z',
    lastValidated: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Insert a record + its tags + its files in one tx, returning the new ID. */
function makeRecord(args: {
  title?: string;
  body?: string;
  status?: NewRecordInput['status'];
  pinned?: boolean;
  created?: string;
  tags?: readonly string[];
  files?: readonly string[];
}): string {
  return tmp.store.tx(() => {
    const id = records.insert(
      makeInput({
        ...(args.title !== undefined ? { title: args.title } : {}),
        ...(args.body !== undefined ? { body: args.body } : {}),
        ...(args.status !== undefined ? { status: args.status } : {}),
        ...(args.pinned !== undefined ? { pinned: args.pinned } : {}),
        ...(args.created !== undefined ? { created: args.created } : {}),
      }),
    );
    if (args.tags && args.tags.length > 0) {
      tags.set(id, args.tags);
    }
    if (args.files && args.files.length > 0) {
      files.replace(
        id,
        args.files.map((path) => ({ path, mtime: 0, size: 0, sha256: null })),
      );
    }
    return id;
  });
}

// ---------------------------------------------------------------------------
// Status filter
// ---------------------------------------------------------------------------

describe('query — status filter', () => {
  beforeEach(() => {
    makeRecord({ title: 'active1', status: 'active' });
    makeRecord({ title: 'active2', status: 'active' });
    makeRecord({ title: 'draft1', status: 'draft' });
    makeRecord({ title: 'dep1', status: 'deprecated' });
    makeRecord({ title: 'sup1', status: 'superseded' });
  });

  test('default status is active', () => {
    const result = records.query({});
    expect(result.total).toBe(2);
    expect(result.records.every((r) => r.status === 'active')).toBe(true);
  });

  test('explicit status: draft', () => {
    const result = records.query({ status: 'draft' });
    expect(result.total).toBe(1);
    expect(result.records[0]?.title).toBe('draft1');
  });

  test('status: any returns everything', () => {
    const result = records.query({ status: 'any' });
    expect(result.total).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Tags filter
// ---------------------------------------------------------------------------

describe('query — tags filter', () => {
  beforeEach(() => {
    makeRecord({ title: 'api+sec', tags: ['api', 'security'] });
    makeRecord({ title: 'api only', tags: ['api'] });
    makeRecord({ title: 'data', tags: ['data'] });
    makeRecord({ title: 'no tags' });
  });

  test('single tag matches all records carrying it (OR semantics)', () => {
    const result = records.query({ tags: ['api'] });
    expect(result.total).toBe(2);
    expect(result.records.map((r) => r.title).sort()).toEqual(['api only', 'api+sec']);
  });

  test('multiple tags use OR semantics (records carrying any of them)', () => {
    const result = records.query({ tags: ['api', 'data'] });
    expect(result.total).toBe(3);
  });

  test('unknown tag returns empty', () => {
    const result = records.query({ tags: ['nope'] });
    expect(result.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Files filter
// ---------------------------------------------------------------------------

describe('query — files filter', () => {
  beforeEach(() => {
    makeRecord({ title: 'a', files: ['src/auth.ts'] });
    makeRecord({ title: 'b', files: ['src/auth.ts', 'src/util.ts'] });
    makeRecord({ title: 'c', files: ['src/util.ts'] });
    makeRecord({ title: 'd' });
  });

  test('single path matches all records referencing it', () => {
    const result = records.query({ files: ['src/auth.ts'] });
    expect(result.total).toBe(2);
  });

  test('multiple paths use OR semantics', () => {
    const result = records.query({ files: ['src/auth.ts', 'src/util.ts'] });
    expect(result.total).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// FTS5 text filter
// ---------------------------------------------------------------------------

describe('query — text filter (FTS5)', () => {
  beforeEach(() => {
    makeRecord({
      title: 'JWT refresh tokens',
      body: 'Use 15 minute access tokens.',
    });
    makeRecord({
      title: 'OAuth2 device flow',
      body: 'Used for headless devices.',
    });
    makeRecord({
      title: 'Rate limiting',
      body: 'Limit each client to 100 requests per minute.',
    });
  });

  test('matches words in the title', () => {
    const result = records.query({ text: 'JWT' });
    expect(result.total).toBe(1);
    expect(result.records[0]?.title).toBe('JWT refresh tokens');
  });

  test('matches words in the body', () => {
    const result = records.query({ text: 'rate' });
    expect(result.total).toBe(1);
  });

  test('phrase search "limit each"', () => {
    const result = records.query({ text: '"limit each"' });
    expect(result.total).toBe(1);
  });

  test('OR operator', () => {
    const result = records.query({ text: 'JWT OR OAuth2' });
    expect(result.total).toBe(2);
  });

  test('unsafe special characters do not crash the query', () => {
    expect(() => records.query({ text: 'foo:bar' })).not.toThrow();
    expect(() => records.query({ text: '*' })).not.toThrow();
    expect(() => records.query({ text: '"unbalanced' })).not.toThrow();
    expect(() => records.query({ text: '(((' })).not.toThrow();
  });

  test('unicode terms are searchable', () => {
    makeRecord({ title: 'Café decisions', body: 'we tested with utf8' });
    const result = records.query({ text: 'utf8' });
    expect(result.total).toBeGreaterThan(0);
  });

  test('empty text filter is treated as no filter', () => {
    const baseline = records.query({});
    const filtered = records.query({ text: '' });
    expect(filtered.total).toBe(baseline.total);
  });
});

// ---------------------------------------------------------------------------
// Since filter
// ---------------------------------------------------------------------------

describe('query — since filter', () => {
  beforeEach(() => {
    makeRecord({ title: 'old', created: '2026-01-01T00:00:00.000Z' });
    makeRecord({ title: 'recent', created: '2026-04-01T00:00:00.000Z' });
    makeRecord({ title: 'newest', created: '2026-04-10T00:00:00.000Z' });
  });

  test('returns records created on or after the cutoff', () => {
    const result = records.query({ since: '2026-03-01T00:00:00.000Z' });
    expect(result.total).toBe(2);
  });

  test('exact-equal cutoff matches', () => {
    const result = records.query({ since: '2026-04-01T00:00:00.000Z' });
    expect(result.records.map((r) => r.title).sort()).toEqual(['newest', 'recent']);
  });
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

describe('query — pagination', () => {
  beforeEach(() => {
    for (let i = 0; i < 12; i++) {
      makeRecord({
        title: `record ${i}`,
        created: `2026-04-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
      });
    }
  });

  test('limit caps the result count', () => {
    const result = records.query({ limit: 5 });
    expect(result.records).toHaveLength(5);
    expect(result.total).toBe(12);
  });

  test('offset skips records', () => {
    const result = records.query({ limit: 5, offset: 5 });
    expect(result.records).toHaveLength(5);
    expect(result.total).toBe(12);
  });

  test('default order is created DESC (newest first)', () => {
    const result = records.query({ limit: 3 });
    expect(result.records.map((r) => r.title)).toEqual([
      'record 11',
      'record 10',
      'record 9',
    ]);
  });

  test('total is the unpaged count', () => {
    const result = records.query({ limit: 1, offset: 0 });
    expect(result.records).toHaveLength(1);
    expect(result.total).toBe(12);
  });

  test('offset past the end returns empty records but correct total', () => {
    const result = records.query({ limit: 5, offset: 100 });
    expect(result.records).toHaveLength(0);
    expect(result.total).toBe(12);
  });

  test('rejects negative limit', () => {
    expect(() => records.query({ limit: -1 })).toThrow(KauriError);
  });

  test('rejects negative offset', () => {
    expect(() => records.query({ offset: -1 })).toThrow(KauriError);
  });
});

// ---------------------------------------------------------------------------
// Combined filters
// ---------------------------------------------------------------------------

describe('query — combined filters', () => {
  beforeEach(() => {
    makeRecord({
      title: 'JWT auth',
      body: 'JWT body',
      tags: ['api', 'security'],
      created: '2026-04-05T00:00:00.000Z',
    });
    makeRecord({
      title: 'JWT old',
      body: 'old jwt',
      tags: ['api'],
      created: '2026-01-01T00:00:00.000Z',
    });
    makeRecord({
      title: 'OAuth',
      body: 'oauth body',
      tags: ['security'],
      created: '2026-04-05T00:00:00.000Z',
    });
  });

  test('text + tag filter', () => {
    const result = records.query({ text: 'JWT', tags: ['security'] });
    expect(result.records.map((r) => r.title)).toEqual(['JWT auth']);
  });

  test('text + since filter', () => {
    const result = records.query({ text: 'JWT', since: '2026-04-01T00:00:00.000Z' });
    expect(result.records.map((r) => r.title)).toEqual(['JWT auth']);
  });

  test('all filters at once', () => {
    const result = records.query({
      text: 'JWT',
      tags: ['security'],
      since: '2026-04-01T00:00:00.000Z',
      status: 'active',
    });
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.title).toBe('JWT auth');
  });
});

// ---------------------------------------------------------------------------
// Empty result + edge cases
// ---------------------------------------------------------------------------

describe('query — empty result', () => {
  test('returns total 0 and empty records when no records exist', () => {
    const result = records.query({});
    expect(result.total).toBe(0);
    expect(result.records).toEqual([]);
  });
});
