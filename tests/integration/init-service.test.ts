import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fixedClock } from '../../src/core/clock.ts';
import { DEFAULT_TAXONOMY } from '../../src/core/constants.ts';
import { KauriError } from '../../src/core/errors.ts';
import { MetaRepo } from '../../src/store/repo/meta.ts';
import { TaxonomyRepo } from '../../src/store/repo/tags.ts';
import { Store } from '../../src/store/store.ts';
import { initStore } from '../../src/services/init-service.ts';

let dirs: string[] = [];

afterEach(() => {
  for (const d of dirs) {
    rmSync(d, { recursive: true, force: true });
  }
  dirs = [];
});

function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'kauri-init-test-'));
  dirs.push(d);
  return d;
}

describe('initStore', () => {
  const clock = fixedClock('2026-04-12T10:00:00.000Z');

  test('creates the store file and parent directory', () => {
    const dir = tmpDir();
    const storePath = join(dir, '.kauri', 'store.db');
    initStore({ storePath, scope: 'project', slug: 'kauri', clock });
    expect(existsSync(storePath)).toBe(true);
  });

  test('returns the normalised slug and createdAt', () => {
    const dir = tmpDir();
    const result = initStore({
      storePath: join(dir, '.kauri', 'store.db'),
      scope: 'project',
      slug: 'My Cool App!',
      clock,
    });
    expect(result.slug).toBe('my-cool-app');
    expect(result.createdAt).toBe('2026-04-12T10:00:00.000Z');
    expect(result.scope).toBe('project');
  });

  test('seeds meta with slug and created_at', () => {
    const dir = tmpDir();
    const storePath = join(dir, '.kauri', 'store.db');
    initStore({ storePath, scope: 'project', slug: 'kauri', clock });
    // Reopen and verify.
    const store = Store.openAt(storePath, 'project');
    try {
      const meta = new MetaRepo(store.db);
      expect(meta.getSlug()).toBe('kauri');
      expect(meta.getCreatedAt()).toBe('2026-04-12T10:00:00.000Z');
    } finally {
      store.close();
    }
  });

  test('seeds the default taxonomy', () => {
    const dir = tmpDir();
    const storePath = join(dir, '.kauri', 'store.db');
    initStore({ storePath, scope: 'project', slug: 'kauri', clock });
    const store = Store.openAt(storePath, 'project');
    try {
      const taxonomy = new TaxonomyRepo(store.db);
      expect(taxonomy.list()).toEqual([...DEFAULT_TAXONOMY].sort());
    } finally {
      store.close();
    }
  });

  test('user scope uses slug=usr and ignores the slug param', () => {
    const dir = tmpDir();
    const storePath = join(dir, '.kauri', 'store.db');
    const result = initStore({ storePath, scope: 'user', clock });
    expect(result.slug).toBe('usr');
  });

  test('refuses to re-init when a store already exists', () => {
    const dir = tmpDir();
    const storePath = join(dir, '.kauri', 'store.db');
    initStore({ storePath, scope: 'project', slug: 'kauri', clock });
    expect(() =>
      initStore({ storePath, scope: 'project', slug: 'kauri', clock }),
    ).toThrow(KauriError);
  });

  test('refuses reserved slugs', () => {
    const dir = tmpDir();
    expect(() =>
      initStore({
        storePath: join(dir, '.kauri', 'store.db'),
        scope: 'project',
        slug: 'usr',
        clock,
      }),
    ).toThrow(KauriError);
  });
});
