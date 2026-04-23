import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { FileAssoc } from '../../src/core/types.ts';
import { FilesRepo } from '../../src/store/repo/files.ts';
import { makeTmpStore, type TmpStore } from '../helpers/tmp-store.ts';

let tmp: TmpStore;
let files: FilesRepo;

const NOW = '2026-04-11T10:00:00.000Z';

beforeEach(() => {
  tmp = makeTmpStore();
  files = new FilesRepo(tmp.store.db);
});

afterEach(() => {
  tmp?.cleanup();
});

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

function fa(path: string, mtime: number, size: number, sha256: string | null = 'h'): FileAssoc {
  return { path, mtime, size, sha256 };
}

describe('FilesRepo — list', () => {
  test('returns empty array for a record with no files', () => {
    insertBareRecord('kauri-DEC-0001');
    expect(files.list('kauri-DEC-0001')).toEqual([]);
  });

  test('returns files in alphabetical path order', () => {
    insertBareRecord('kauri-DEC-0001');
    files.replace('kauri-DEC-0001', [
      fa('zeta.ts', 100, 10),
      fa('alpha.ts', 200, 20),
      fa('mu.ts', 300, 30),
    ]);
    expect(files.list('kauri-DEC-0001').map((f) => f.path)).toEqual([
      'alpha.ts',
      'mu.ts',
      'zeta.ts',
    ]);
  });

  test('preserves all FileAssoc fields', () => {
    insertBareRecord('kauri-DEC-0001');
    files.replace('kauri-DEC-0001', [fa('a.ts', 12345, 67, 'abc123')]);
    const out = files.list('kauri-DEC-0001');
    expect(out).toEqual([{ path: 'a.ts', mtime: 12345, size: 67, sha256: 'abc123' }]);
  });

  test('preserves null sha256 for over-cap files', () => {
    insertBareRecord('kauri-DEC-0001');
    files.replace('kauri-DEC-0001', [fa('huge.bin', 100, 999999999, null)]);
    expect(files.list('kauri-DEC-0001')[0]?.sha256).toBeNull();
  });
});

describe('FilesRepo — replace', () => {
  test('clears the previous set when called again', () => {
    insertBareRecord('kauri-DEC-0001');
    files.replace('kauri-DEC-0001', [fa('a.ts', 1, 1)]);
    files.replace('kauri-DEC-0001', [fa('b.ts', 2, 2)]);
    expect(files.list('kauri-DEC-0001').map((f) => f.path)).toEqual(['b.ts']);
  });

  test('empty array clears all file associations', () => {
    insertBareRecord('kauri-DEC-0001');
    files.replace('kauri-DEC-0001', [fa('a.ts', 1, 1)]);
    files.replace('kauri-DEC-0001', []);
    expect(files.list('kauri-DEC-0001')).toEqual([]);
  });

  test('deduplicates by path (last writer wins for the same path)', () => {
    insertBareRecord('kauri-DEC-0001');
    files.replace('kauri-DEC-0001', [fa('a.ts', 1, 10), fa('a.ts', 2, 20), fa('a.ts', 3, 30)]);
    const out = files.list('kauri-DEC-0001');
    expect(out).toHaveLength(1);
    expect(out[0]?.mtime).toBe(3);
    expect(out[0]?.size).toBe(30);
  });
});

describe('FilesRepo — touchMtime', () => {
  test('updates only the mtime, leaving size and sha256 unchanged', () => {
    insertBareRecord('kauri-DEC-0001');
    files.replace('kauri-DEC-0001', [fa('a.ts', 100, 10, 'abc')]);
    files.touchMtime('kauri-DEC-0001', 'a.ts', 999);
    const out = files.list('kauri-DEC-0001');
    expect(out[0]).toEqual({ path: 'a.ts', mtime: 999, size: 10, sha256: 'abc' });
  });

  test('is a no-op when the (record, path) pair does not exist', () => {
    insertBareRecord('kauri-DEC-0001');
    files.replace('kauri-DEC-0001', [fa('a.ts', 100, 10)]);
    expect(() => files.touchMtime('kauri-DEC-0001', 'b.ts', 999)).not.toThrow();
    expect(files.list('kauri-DEC-0001')[0]?.mtime).toBe(100);
  });
});

describe('FilesRepo — idsByPath', () => {
  test('returns record IDs that reference the given path', () => {
    insertBareRecord('kauri-DEC-0001');
    insertBareRecord('kauri-DEC-0002');
    insertBareRecord('kauri-DEC-0003');
    files.replace('kauri-DEC-0001', [fa('shared.ts', 1, 1)]);
    files.replace('kauri-DEC-0002', [fa('shared.ts', 1, 1), fa('other.ts', 1, 1)]);
    files.replace('kauri-DEC-0003', [fa('other.ts', 1, 1)]);
    expect([...files.idsByPath('shared.ts')].sort()).toEqual(['kauri-DEC-0001', 'kauri-DEC-0002']);
    expect([...files.idsByPath('other.ts')].sort()).toEqual(['kauri-DEC-0002', 'kauri-DEC-0003']);
  });

  test('returns empty for unknown path', () => {
    expect(files.idsByPath('nope.ts')).toEqual([]);
  });
});
