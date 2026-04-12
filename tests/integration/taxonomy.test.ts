import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { KauriError } from '../../src/core/errors.ts';
import { RecordTagsRepo, TaxonomyRepo } from '../../src/store/repo/tags.ts';
import { makeTmpStore, type TmpStore } from '../helpers/tmp-store.ts';

let tmp: TmpStore;
let taxonomy: TaxonomyRepo;
let recordTags: RecordTagsRepo;

const NOW = '2026-04-11T10:00:00.000Z';

beforeEach(() => {
  tmp = makeTmpStore();
  taxonomy = new TaxonomyRepo(tmp.store.db);
  recordTags = new RecordTagsRepo(tmp.store.db);
});

afterEach(() => {
  tmp?.cleanup();
});

// ---------------------------------------------------------------------------
// TaxonomyRepo
// ---------------------------------------------------------------------------

describe('TaxonomyRepo — list/has/add', () => {
  test('list is empty on a fresh store', () => {
    expect(taxonomy.list()).toEqual([]);
  });

  test('add inserts a tag and list returns it', () => {
    expect(taxonomy.add('api', NOW)).toBe(true);
    expect(taxonomy.list()).toEqual(['api']);
  });

  test('add is idempotent — second call returns false', () => {
    taxonomy.add('api', NOW);
    expect(taxonomy.add('api', NOW)).toBe(false);
    expect(taxonomy.list()).toEqual(['api']);
  });

  test('list is alphabetical', () => {
    taxonomy.add('zeta', NOW);
    taxonomy.add('alpha', NOW);
    taxonomy.add('mu', NOW);
    expect(taxonomy.list()).toEqual(['alpha', 'mu', 'zeta']);
  });

  test('has reports presence after add', () => {
    expect(taxonomy.has('api')).toBe(false);
    taxonomy.add('api', NOW);
    expect(taxonomy.has('api')).toBe(true);
  });

  test('add normalises raw input', () => {
    taxonomy.add('  Foo Bar!  ', NOW);
    expect(taxonomy.list()).toContain('foo-bar');
    expect(taxonomy.has('foo-bar')).toBe(true);
  });

  test('add rejects reserved tags', () => {
    expect(() => taxonomy.add('usr', NOW)).toThrow(KauriError);
    expect(() => taxonomy.add('dec', NOW)).toThrow(KauriError);
  });

  test('add rejects empty / non-normalisable input', () => {
    expect(() => taxonomy.add('', NOW)).toThrow(KauriError);
    expect(() => taxonomy.add('日本語', NOW)).toThrow(KauriError);
  });
});

describe('TaxonomyRepo — addMany', () => {
  test('seeds the default taxonomy in one call', () => {
    const added = taxonomy.addMany(['api', 'security', 'testing'], NOW);
    expect(added).toEqual(['api', 'security', 'testing']);
    expect(taxonomy.list()).toEqual(['api', 'security', 'testing']);
  });

  test('returns only the newly-added tags', () => {
    taxonomy.add('api', NOW);
    const added = taxonomy.addMany(['api', 'security'], NOW);
    expect(added).toEqual(['security']);
  });

  test('normalises every input', () => {
    taxonomy.addMany(['  api  ', 'My Tag'], NOW);
    expect(taxonomy.list()).toEqual(['api', 'my-tag']);
  });
});

// ---------------------------------------------------------------------------
// RecordTagsRepo
// ---------------------------------------------------------------------------

/**
 * Manually insert a minimal record row so RecordTagsRepo has a foreign
 * key target. We bypass RecordsRepo here to keep the tag tests
 * independent of records-repo behaviour.
 */
function insertBareRecord(id: string): void {
  tmp.store.db.exec(
    `INSERT INTO records (
       id, kind, scope, status, title, body, source,
       supersedes, superseded_by, ttl_days, pinned, payload,
       revision, created, last_modified, last_validated
     ) VALUES (
       '${id}', 'decision', 'project', 'active', 't', 'b', 'manual',
       NULL, NULL, NULL, 0, NULL, 1, '${NOW}', '${NOW}', '${NOW}'
     )`,
  );
}

describe('RecordTagsRepo — set / tagsFor', () => {
  test('tagsFor is empty for a record with no tags', () => {
    insertBareRecord('kauri-DEC-0001');
    expect(recordTags.tagsFor('kauri-DEC-0001')).toEqual([]);
  });

  test('set associates tags with a record', () => {
    insertBareRecord('kauri-DEC-0001');
    taxonomy.addMany(['api', 'security'], NOW);
    recordTags.set('kauri-DEC-0001', ['api', 'security']);
    expect(recordTags.tagsFor('kauri-DEC-0001')).toEqual(['api', 'security']);
  });

  test('set replaces the previous tag set', () => {
    insertBareRecord('kauri-DEC-0001');
    taxonomy.addMany(['api', 'security', 'data'], NOW);
    recordTags.set('kauri-DEC-0001', ['api', 'security']);
    recordTags.set('kauri-DEC-0001', ['data']);
    expect(recordTags.tagsFor('kauri-DEC-0001')).toEqual(['data']);
  });

  test('set with empty array clears all tags', () => {
    insertBareRecord('kauri-DEC-0001');
    taxonomy.add('api', NOW);
    recordTags.set('kauri-DEC-0001', ['api']);
    recordTags.set('kauri-DEC-0001', []);
    expect(recordTags.tagsFor('kauri-DEC-0001')).toEqual([]);
  });

  test('set deduplicates tags', () => {
    insertBareRecord('kauri-DEC-0001');
    taxonomy.add('api', NOW);
    recordTags.set('kauri-DEC-0001', ['api', 'api', 'api']);
    expect(recordTags.tagsFor('kauri-DEC-0001')).toEqual(['api']);
  });

  test('set throws KauriError when a tag is not in the taxonomy', () => {
    insertBareRecord('kauri-DEC-0001');
    expect(() => recordTags.set('kauri-DEC-0001', ['unknown-tag'])).toThrow(KauriError);
  });

  test('tagsFor returns tags sorted alphabetically', () => {
    insertBareRecord('kauri-DEC-0001');
    taxonomy.addMany(['zebra', 'alpha', 'mu'], NOW);
    recordTags.set('kauri-DEC-0001', ['zebra', 'alpha', 'mu']);
    expect(recordTags.tagsFor('kauri-DEC-0001')).toEqual(['alpha', 'mu', 'zebra']);
  });
});

describe('RecordTagsRepo — idsByTag', () => {
  test('returns IDs of records carrying the tag', () => {
    insertBareRecord('kauri-DEC-0001');
    insertBareRecord('kauri-DEC-0002');
    insertBareRecord('kauri-DEC-0003');
    taxonomy.addMany(['api', 'security'], NOW);
    recordTags.set('kauri-DEC-0001', ['api']);
    recordTags.set('kauri-DEC-0002', ['api', 'security']);
    recordTags.set('kauri-DEC-0003', ['security']);
    const apiIds = [...recordTags.idsByTag('api')].sort();
    expect(apiIds).toEqual(['kauri-DEC-0001', 'kauri-DEC-0002']);
  });

  test('returns empty for an unknown tag', () => {
    expect(recordTags.idsByTag('not-a-tag')).toEqual([]);
  });
});
