/**
 * Integration tests for the records service — the full stack from
 * service → repos → SQLite, covering create, update, validate, and
 * supersession workflows.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fixedClock } from '../../src/core/clock.ts';
import { KauriError } from '../../src/core/errors.ts';
import { systemFsProbe } from '../../src/fs/files.ts';
import { makeStoreBundle, type ServiceContext } from '../../src/services/context.ts';
import {
  createRecord,
  queryRecords,
  showRecord,
  updateRecord,
  validateRecord,
} from '../../src/services/records-service.ts';
import { Store } from '../../src/store/store.ts';

let dir: string;
let ctx: ServiceContext;
let stores: Store[];

const NOW = '2026-04-12T10:00:00.000Z';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kauri-records-svc-'));
  const store = Store.openInMemory('project');
  stores = [store];
  const bundle = makeStoreBundle(store);
  // Seed slug + taxonomy.
  bundle.meta.setSlug('kauri');
  bundle.taxonomy.addMany(['api', 'security', 'testing', 'architecture'], NOW);

  ctx = {
    projectBundle: bundle,
    userBundle: null,
    clock: fixedClock(NOW),
    fsProbe: systemFsProbe({ sizeCap: 1024 * 1024 }),
  };
});

afterEach(() => {
  for (const s of stores) s.close();
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

describe('createRecord', () => {
  test('creates a record with tags and returns it hydrated', () => {
    const result = createRecord(ctx, {
      title: 'Use JWT',
      body: 'JWT body',
      tags: ['api', 'security'],
      source: 'agent:test',
    });
    expect(result.record.id).toBe('kauri-DEC-0001');
    expect(result.record.title).toBe('Use JWT');
    expect(result.record.tags).toEqual(['api', 'security']);
    expect(result.record.status).toBe('active');
    expect(result.record.revision).toBe(1);
  });

  test('creates a record with files and probes them', () => {
    const file = join(dir, 'auth.ts');
    writeFileSync(file, 'export const auth = true;');
    const result = createRecord(ctx, {
      title: 'Auth file',
      body: 'body',
      tags: ['api'],
      source: 'manual',
      files: [file],
    });
    expect(result.record.files).toHaveLength(1);
    expect(result.record.files[0]?.path).toBe(file);
    expect(result.record.files[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.warnings).toEqual([]);
  });

  test('emits warning for missing files but still tracks them', () => {
    const result = createRecord(ctx, {
      title: 'Phantom file',
      body: 'body',
      tags: ['api'],
      source: 'manual',
      files: ['/nonexistent/path.ts'],
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.code).toBe('file_not_found');
    expect(result.record.files).toHaveLength(1);
    expect(result.record.files[0]?.sha256).toBeNull();
  });

  test('rejects unknown tags when allowNewTags is false', () => {
    expect(() =>
      createRecord(ctx, {
        title: 'test',
        body: 'body',
        tags: ['unknown-tag'],
        source: 'manual',
      }),
    ).toThrow(KauriError);
  });

  test('adds unknown tags when allowNewTags is true', () => {
    const result = createRecord(ctx, {
      title: 'test',
      body: 'body',
      tags: ['brand-new-tag'],
      source: 'manual',
      allowNewTags: true,
    });
    expect(result.record.tags).toContain('brand-new-tag');
  });

  test('creates draft records', () => {
    const result = createRecord(ctx, {
      title: 'draft',
      body: 'draft body',
      tags: ['api'],
      source: 'manual',
      status: 'draft',
    });
    expect(result.record.status).toBe('draft');
  });

  test('counter increments across calls', () => {
    const r1 = createRecord(ctx, { title: 'a', body: 'b', tags: ['api'], source: 's' });
    const r2 = createRecord(ctx, { title: 'c', body: 'd', tags: ['api'], source: 's' });
    expect(r1.record.id).toBe('kauri-DEC-0001');
    expect(r2.record.id).toBe('kauri-DEC-0002');
  });
});

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

describe('updateRecord', () => {
  test('updates title and bumps revision', () => {
    const { record: original } = createRecord(ctx, {
      title: 'old',
      body: 'body',
      tags: ['api'],
      source: 's',
    });
    const { record: updated } = updateRecord(ctx, {
      id: original.id,
      source: 's',
      title: 'new',
    });
    expect(updated.title).toBe('new');
    expect(updated.revision).toBe(2);
  });

  test('replaces tags when provided', () => {
    const { record } = createRecord(ctx, {
      title: 't',
      body: 'b',
      tags: ['api'],
      source: 's',
    });
    const { record: updated } = updateRecord(ctx, {
      id: record.id,
      source: 's',
      tags: ['security', 'testing'],
    });
    expect(updated.tags).toEqual(['security', 'testing']);
  });

  test('throws not_found for unknown ID', () => {
    expect(() => updateRecord(ctx, { id: 'kauri-DEC-9999', source: 's', title: 'x' })).toThrow(
      KauriError,
    );
  });
});

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

describe('validateRecord', () => {
  test('still_valid refreshes last_validated', () => {
    const { record } = createRecord(ctx, {
      title: 't',
      body: 'b',
      tags: ['api'],
      source: 's',
    });
    const { record: validated } = validateRecord(ctx, record.id, 'still_valid', 's');
    expect(validated.lastValidated).toBe(NOW);
    expect(validated.status).toBe('active');
  });

  test('still_valid promotes draft to active', () => {
    const { record } = createRecord(ctx, {
      title: 'draft',
      body: 'b',
      tags: ['api'],
      source: 's',
      status: 'draft',
    });
    expect(record.status).toBe('draft');
    const { record: promoted } = validateRecord(ctx, record.id, 'still_valid', 's');
    expect(promoted.status).toBe('active');
  });

  test('deprecate sets status to deprecated', () => {
    const { record } = createRecord(ctx, {
      title: 't',
      body: 'b',
      tags: ['api'],
      source: 's',
    });
    const { record: deprecated } = validateRecord(ctx, record.id, 'deprecate', 's');
    expect(deprecated.status).toBe('deprecated');
  });
});

// ---------------------------------------------------------------------------
// Show / Query
// ---------------------------------------------------------------------------

describe('showRecord + queryRecords', () => {
  test('show returns a hydrated record', () => {
    const { record } = createRecord(ctx, {
      title: 't',
      body: 'b',
      tags: ['api'],
      source: 's',
    });
    const shown = showRecord(ctx, record.id);
    expect(shown.id).toBe(record.id);
    expect(shown.tags).toEqual(['api']);
  });

  test('show throws not_found for unknown ID', () => {
    expect(() => showRecord(ctx, 'kauri-DEC-9999')).toThrow(KauriError);
  });

  test('query returns active records by default', () => {
    createRecord(ctx, { title: 'a', body: 'b', tags: ['api'], source: 's' });
    createRecord(ctx, {
      title: 'draft',
      body: 'b',
      tags: ['api'],
      source: 's',
      status: 'draft',
    });
    const result = queryRecords(ctx, {});
    expect(result.total).toBe(1);
    expect(result.records[0]?.title).toBe('a');
  });
});

// ---------------------------------------------------------------------------
// Supersession
// ---------------------------------------------------------------------------

describe('supersession', () => {
  test('creates a chain: old is superseded, new links back', () => {
    const { record: old } = createRecord(ctx, {
      title: 'v1',
      body: 'b',
      tags: ['api'],
      source: 's',
    });
    const { record: next } = createRecord(ctx, {
      title: 'v2',
      body: 'b',
      tags: ['api'],
      source: 's',
      supersedes: old.id,
    });
    const refreshedOld = showRecord(ctx, old.id);
    expect(refreshedOld.status).toBe('superseded');
    expect(refreshedOld.supersededBy).toBe(next.id);
    expect(next.supersedes).toBe(old.id);
  });
});
