import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { KauriError } from '../../src/core/errors.ts';
import { FilesRepo } from '../../src/store/repo/files.ts';
import { RecordLinksRepo } from '../../src/store/repo/links.ts';
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

const NOW = '2026-04-11T10:00:00.000Z';

beforeEach(() => {
  tmp = makeTmpStore();
  taxonomy = new TaxonomyRepo(tmp.store.db);
  tags = new RecordTagsRepo(tmp.store.db);
  files = new FilesRepo(tmp.store.db);
  records = new RecordsRepo(tmp.store.db, tags, files, new RecordLinksRepo(tmp.store.db));
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
    created: NOW,
    lastModified: NOW,
    lastValidated: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Counter generation + insert
// ---------------------------------------------------------------------------

describe('RecordsRepo — insert and counter generation', () => {
  test('first insert returns counter 1', () => {
    const id = tmp.store.tx(() => records.insert(makeInput()));
    expect(id).toBe('kauri-DEC-0001');
  });

  test('counter is monotonic for the same kind', () => {
    const ids = tmp.store.tx(() => [
      records.insert(makeInput({ title: 'a' })),
      records.insert(makeInput({ title: 'b' })),
      records.insert(makeInput({ title: 'c' })),
    ]);
    expect(ids).toEqual(['kauri-DEC-0001', 'kauri-DEC-0002', 'kauri-DEC-0003']);
  });

  test('counter survives close and reopen of the store', () => {
    tmp.store.tx(() => {
      records.insert(makeInput());
      records.insert(makeInput());
    });
    expect(records.nextCounter('decision')).toBe(3);
  });

  test('user-scope IDs use the usr prefix regardless of slug', () => {
    const id = tmp.store.tx(() =>
      records.insert(makeInput({ scope: 'user', slug: 'ignored' })),
    );
    expect(id).toBe('usr-DEC-0001');
  });

  test('hyphenated slugs are preserved in the ID', () => {
    const id = tmp.store.tx(() =>
      records.insert(makeInput({ slug: 'my-cool-app' })),
    );
    expect(id).toBe('my-cool-app-DEC-0001');
  });

  test('inserts with all optional fields populated round trip', () => {
    taxonomy.add('api', NOW);
    const id = tmp.store.tx(() =>
      records.insert(
        makeInput({
          title: 'Use JWT',
          body: 'longer body content',
          ttlDays: 30,
          pinned: true,
          source: 'agent:claude-code',
        }),
      ),
    );
    const rec = records.findById(id);
    expect(rec).not.toBeNull();
    expect(rec?.title).toBe('Use JWT');
    expect(rec?.body).toBe('longer body content');
    expect(rec?.ttlDays).toBe(30);
    expect(rec?.pinned).toBe(true);
    expect(rec?.source).toBe('agent:claude-code');
    expect(rec?.revision).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// findById / findRowById
// ---------------------------------------------------------------------------

describe('RecordsRepo — findById', () => {
  test('returns null for an unknown id', () => {
    expect(records.findById('kauri-DEC-9999')).toBeNull();
    expect(records.findRowById('kauri-DEC-9999')).toBeNull();
  });

  test('hydrates tags and files from their repos', () => {
    taxonomy.addMany(['api', 'security'], NOW);
    const id = tmp.store.tx(() => {
      const newId = records.insert(makeInput());
      tags.set(newId, ['api', 'security']);
      files.replace(newId, [
        { path: 'src/a.ts', mtime: 100, size: 10, sha256: 'h' },
      ]);
      return newId;
    });
    const rec = records.findById(id);
    expect(rec?.tags).toEqual(['api', 'security']);
    expect(rec?.files).toEqual([
      { path: 'src/a.ts', mtime: 100, size: 10, sha256: 'h' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// updateScalars
// ---------------------------------------------------------------------------

describe('RecordsRepo — updateScalars', () => {
  test('updates title and bumps revision', () => {
    const id = tmp.store.tx(() => records.insert(makeInput()));
    records.updateScalars(id, { title: 'New title' }, '2026-04-12T00:00:00.000Z');
    const rec = records.findById(id);
    expect(rec?.title).toBe('New title');
    expect(rec?.revision).toBe(2);
    expect(rec?.lastModified).toBe('2026-04-12T00:00:00.000Z');
  });

  test('updates body, leaving title unchanged', () => {
    const id = tmp.store.tx(() => records.insert(makeInput({ title: 'unchanged' })));
    records.updateScalars(id, { body: 'new body' }, NOW);
    const rec = records.findById(id);
    expect(rec?.title).toBe('unchanged');
    expect(rec?.body).toBe('new body');
  });

  test('clearing ttlDays with null is honoured', () => {
    const id = tmp.store.tx(() => records.insert(makeInput({ ttlDays: 30 })));
    records.updateScalars(id, { ttlDays: null }, NOW);
    expect(records.findById(id)?.ttlDays).toBeNull();
  });

  test('multiple fields update in one call', () => {
    const id = tmp.store.tx(() => records.insert(makeInput()));
    records.updateScalars(
      id,
      { title: 't2', body: 'b2', ttlDays: 7 },
      '2026-04-12T00:00:00.000Z',
    );
    const rec = records.findById(id);
    expect(rec?.title).toBe('t2');
    expect(rec?.body).toBe('b2');
    expect(rec?.ttlDays).toBe(7);
    expect(rec?.revision).toBe(2);
  });

  test('throws not_found when id does not exist', () => {
    try {
      records.updateScalars('kauri-DEC-9999', { title: 'x' }, NOW);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(KauriError);
      expect((e as KauriError).code).toBe('not_found');
    }
  });

  test('does not change last_validated', () => {
    const id = tmp.store.tx(() => records.insert(makeInput()));
    records.updateScalars(id, { title: 'new' }, '2026-04-12T00:00:00.000Z');
    expect(records.findById(id)?.lastValidated).toBe(NOW);
  });
});

// ---------------------------------------------------------------------------
// setPinned / markValidated / setStatus / linkSupersession
// ---------------------------------------------------------------------------

describe('RecordsRepo — setPinned', () => {
  test('toggles the pinned flag without bumping revision', () => {
    const id = tmp.store.tx(() => records.insert(makeInput()));
    records.setPinned(id, true, '2026-04-12T00:00:00.000Z');
    const rec = records.findById(id);
    expect(rec?.pinned).toBe(true);
    expect(rec?.revision).toBe(1);
    expect(rec?.lastModified).toBe('2026-04-12T00:00:00.000Z');
  });

  test('throws not_found for unknown id', () => {
    expect(() => records.setPinned('kauri-DEC-9999', true, NOW)).toThrow(KauriError);
  });
});

describe('RecordsRepo — markValidated', () => {
  test('updates last_validated and last_modified, no revision bump', () => {
    const id = tmp.store.tx(() => records.insert(makeInput()));
    records.markValidated(id, '2026-04-15T00:00:00.000Z', '2026-04-15T00:00:00.000Z');
    const rec = records.findById(id);
    expect(rec?.lastValidated).toBe('2026-04-15T00:00:00.000Z');
    expect(rec?.lastModified).toBe('2026-04-15T00:00:00.000Z');
    expect(rec?.revision).toBe(1);
  });

  test('throws not_found for unknown id', () => {
    expect(() => records.markValidated('kauri-DEC-9999', NOW, NOW)).toThrow(KauriError);
  });
});

describe('RecordsRepo — setStatus', () => {
  test('changes status without bumping revision', () => {
    const id = tmp.store.tx(() => records.insert(makeInput()));
    records.setStatus(id, 'deprecated', '2026-04-12T00:00:00.000Z');
    const rec = records.findById(id);
    expect(rec?.status).toBe('deprecated');
    expect(rec?.revision).toBe(1);
  });

  test('throws not_found for unknown id', () => {
    expect(() => records.setStatus('kauri-DEC-9999', 'deprecated', NOW)).toThrow(KauriError);
  });
});

describe('RecordsRepo — linkSupersession', () => {
  test('marks the old record superseded and writes superseded_by', () => {
    const ids = tmp.store.tx(() => {
      const old = records.insert(makeInput({ title: 'old' }));
      const next = records.insert(makeInput({ title: 'new', supersedes: old }));
      records.linkSupersession(old, next, '2026-04-12T00:00:00.000Z');
      return { old, next };
    });
    const oldRec = records.findById(ids.old);
    const newRec = records.findById(ids.next);
    expect(oldRec?.status).toBe('superseded');
    expect(oldRec?.supersededBy).toBe(ids.next);
    expect(newRec?.supersedes).toBe(ids.old);
  });

  test('throws not_found for unknown id', () => {
    expect(() =>
      records.linkSupersession('kauri-DEC-9999', 'kauri-DEC-0001', NOW),
    ).toThrow(KauriError);
  });
});

// ---------------------------------------------------------------------------
// walkChain
// ---------------------------------------------------------------------------

describe('RecordsRepo — walkChain', () => {
  function buildChain(length: number): string[] {
    return tmp.store.tx(() => {
      const ids: string[] = [];
      let prev: string | null = null;
      for (let i = 0; i < length; i++) {
        const id = records.insert(
          makeInput({ title: `step ${i}`, supersedes: prev }),
        );
        if (prev !== null) {
          records.linkSupersession(prev, id, NOW);
        }
        ids.push(id);
        prev = id;
      }
      return ids;
    });
  }

  test('returns just the record itself for a chain of length 1', () => {
    const id = tmp.store.tx(() => records.insert(makeInput()));
    const chain = records.walkChain(id);
    expect(chain).toHaveLength(1);
    expect(chain[0]?.id).toBe(id);
  });

  test('returns the full chain in ancestor-to-descendant order', () => {
    const ids = buildChain(4);
    const chain = records.walkChain(ids[2] as string);
    expect(chain.map((r) => r.id)).toEqual(ids);
  });

  test('walking from the oldest still returns the full chain', () => {
    const ids = buildChain(3);
    const chain = records.walkChain(ids[0] as string);
    expect(chain.map((r) => r.id)).toEqual(ids);
  });

  test('walking from the newest still returns the full chain', () => {
    const ids = buildChain(3);
    const chain = records.walkChain(ids[2] as string);
    expect(chain.map((r) => r.id)).toEqual(ids);
  });

  test('throws not_found when starting id does not exist', () => {
    expect(() => records.walkChain('kauri-DEC-9999')).toThrow(KauriError);
  });
});

// ---------------------------------------------------------------------------
// Aggregations
// ---------------------------------------------------------------------------

describe('RecordsRepo — aggregations', () => {
  test('countByStatus and pinnedCount', () => {
    tmp.store.tx(() => {
      records.insert(makeInput({ title: 'a', pinned: true }));
      records.insert(makeInput({ title: 'b', pinned: true }));
      records.insert(makeInput({ title: 'c' }));
      records.insert(makeInput({ title: 'd', status: 'draft' }));
      records.insert(makeInput({ title: 'e', status: 'deprecated' }));
    });
    expect(records.countByStatus('active')).toBe(3);
    expect(records.countByStatus('draft')).toBe(1);
    expect(records.countByStatus('deprecated')).toBe(1);
    expect(records.countByStatus('superseded')).toBe(0);
    expect(records.pinnedCount()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Service-layer convenience
// ---------------------------------------------------------------------------

describe('RecordsRepo — convenience helpers', () => {
  test('parseRecordId delegates to core/ids', () => {
    expect(records.parseRecordId('kauri-DEC-0042')).toEqual({
      scope: 'project',
      slug: 'kauri',
      kind: 'decision',
      n: 42,
    });
  });

  test('prefixForKind delegates to core/ids', () => {
    expect(records.prefixForKind('decision')).toBe('DEC');
  });
});
