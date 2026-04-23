import { describe, expect, test } from 'bun:test';

import { type ProjectionInput, renderJson, renderText } from '../../src/core/projection.ts';
import type { FileAssoc, KauriRecord } from '../../src/core/types.ts';

// ---------------------------------------------------------------------------
// Test fixture helpers
// ---------------------------------------------------------------------------

/** Build a KauriRecord with sensible defaults; override any field per test. */
function makeRecord(overrides: Partial<KauriRecord> & { id: string; title: string }): KauriRecord {
  return {
    kind: 'decision',
    scope: 'project',
    status: 'active',
    body: 'default body',
    tags: ['architecture'],
    files: [],
    links: [],
    source: 'agent:test',
    supersedes: null,
    supersededBy: null,
    ttlDays: null,
    pinned: false,
    payload: null,
    revision: 1,
    created: '2026-01-01T00:00:00.000Z',
    lastModified: '2026-01-01T00:00:00.000Z',
    lastValidated: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function fileAssoc(path: string): FileAssoc {
  return { path, mtime: 0, size: 0, sha256: null };
}

function emptyInput(overrides: Partial<ProjectionInput> = {}): ProjectionInput {
  return {
    slugLabel: 'kauri',
    counts: { active: 0, pinned: 0, drafts: 0 },
    pinned: [],
    indexed: [],
    staleIds: new Set(),
    full: false,
    includeDrafts: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// renderText — title and empty
// ---------------------------------------------------------------------------

describe('renderText — title', () => {
  test('uses the slug label and counts', () => {
    const out = renderText(
      emptyInput({ slugLabel: 'kauri', counts: { active: 47, pinned: 3, drafts: 0 } }),
    );
    expect(out).toMatch(/^# Kauri Records — kauri \(47 active, 3 pinned\)/);
  });

  test('omits drafts count when includeDrafts is false', () => {
    const out = renderText(emptyInput({ counts: { active: 47, pinned: 3, drafts: 5 } }));
    expect(out).not.toContain('drafts');
  });

  test('shows drafts count when includeDrafts is true and drafts > 0', () => {
    const out = renderText(
      emptyInput({ counts: { active: 47, pinned: 3, drafts: 5 }, includeDrafts: true }),
    );
    expect(out).toMatch(/47 active, 3 pinned, 5 drafts/);
  });

  test('omits drafts count when includeDrafts is true but drafts == 0', () => {
    const out = renderText(
      emptyInput({ counts: { active: 47, pinned: 3, drafts: 0 }, includeDrafts: true }),
    );
    expect(out).not.toContain('drafts');
  });

  test('uses the literal usr label for user-only projection', () => {
    const out = renderText(
      emptyInput({ slugLabel: 'usr', counts: { active: 5, pinned: 0, drafts: 0 } }),
    );
    expect(out).toMatch(/^# Kauri Records — usr/);
  });

  test('uses the both label for cross-scope projection', () => {
    const out = renderText(
      emptyInput({ slugLabel: 'both', counts: { active: 10, pinned: 1, drafts: 0 } }),
    );
    expect(out).toMatch(/^# Kauri Records — both/);
  });
});

describe('renderText — empty', () => {
  test('shows the empty placeholder when no records', () => {
    const out = renderText(emptyInput());
    expect(out).toContain('_No records to display._');
  });

  test('output ends with exactly one newline', () => {
    const out = renderText(emptyInput());
    expect(out.endsWith('\n')).toBe(true);
    expect(out.endsWith('\n\n')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// renderText — pinned section
// ---------------------------------------------------------------------------

describe('renderText — pinned section', () => {
  test('renders pinned header and full record', () => {
    const rec = makeRecord({
      id: 'kauri-DEC-0019',
      title: 'Never log user PII or session tokens',
      body: 'All logging must redact email, phone, JWT bodies.',
      tags: ['security', 'convention'],
      files: [fileAssoc('src/lib/log.ts')],
      pinned: true,
      created: '2026-03-22T10:00:00.000Z',
      lastValidated: '2026-04-01T10:00:00.000Z',
    });
    const out = renderText(
      emptyInput({
        counts: { active: 1, pinned: 1, drafts: 0 },
        pinned: [rec],
      }),
    );
    expect(out).toContain('## Pinned');
    expect(out).toContain(
      '### [kauri-DEC-0019] project | security, convention | Never log user PII or session tokens',
    );
    expect(out).toContain('All logging must redact email, phone, JWT bodies.');
    expect(out).toContain('Files: src/lib/log.ts');
    expect(out).toContain('Recorded: 2026-03-22 · Last validated: 2026-04-01');
  });

  test('omits Files line when no files are associated', () => {
    const rec = makeRecord({
      id: 'kauri-DEC-0031',
      title: 'Postgres is the only datastore',
      body: 'No Redis, no DynamoDB.',
      tags: ['architecture', 'data'],
      pinned: true,
    });
    const out = renderText(
      emptyInput({ counts: { active: 1, pinned: 1, drafts: 0 }, pinned: [rec] }),
    );
    expect(out).not.toContain('Files:');
    expect(out).toContain('Recorded:');
  });

  test('renders multiple files comma-separated', () => {
    const rec = makeRecord({
      id: 'kauri-DEC-0001',
      title: 'Uses several files',
      files: [fileAssoc('src/a.ts'), fileAssoc('src/b.ts'), fileAssoc('src/c.ts')],
      pinned: true,
    });
    const out = renderText(
      emptyInput({ counts: { active: 1, pinned: 1, drafts: 0 }, pinned: [rec] }),
    );
    expect(out).toContain('Files: src/a.ts, src/b.ts, src/c.ts');
  });

  test('skips Pinned section entirely when no pinned records', () => {
    const rec = makeRecord({ id: 'kauri-DEC-0001', title: 'Just an index entry' });
    const out = renderText(
      emptyInput({ counts: { active: 1, pinned: 0, drafts: 0 }, indexed: [rec] }),
    );
    expect(out).not.toContain('## Pinned');
  });
});

// ---------------------------------------------------------------------------
// renderText — index section
// ---------------------------------------------------------------------------

describe('renderText — index section', () => {
  test('renders one-liner per indexed record', () => {
    const recs = [
      makeRecord({
        id: 'kauri-DEC-0001',
        title: 'Monorepo with pnpm workspaces',
        tags: ['architecture'],
      }),
      makeRecord({
        id: 'kauri-DEC-0002',
        title: 'All API responses use camelCase',
        tags: ['convention'],
      }),
    ];
    const out = renderText(
      emptyInput({ counts: { active: 2, pinned: 0, drafts: 0 }, indexed: recs }),
    );
    expect(out).toContain(
      '- [kauri-DEC-0001] project | architecture | Monorepo with pnpm workspaces',
    );
    expect(out).toContain(
      '- [kauri-DEC-0002] project | convention | All API responses use camelCase',
    );
  });

  test('header uses "N more" wording when pinned section is present', () => {
    const pinned = [makeRecord({ id: 'kauri-DEC-0001', title: 'A pinned record', pinned: true })];
    const indexed = [makeRecord({ id: 'kauri-DEC-0002', title: 'An indexed record' })];
    const out = renderText(
      emptyInput({
        counts: { active: 2, pinned: 1, drafts: 0 },
        pinned,
        indexed,
      }),
    );
    expect(out).toContain('## Index (1 more — use `kauri_show` or `kauri_query` to fetch)');
  });

  test('header uses "N records" wording when no pinned section', () => {
    const indexed = [
      makeRecord({ id: 'kauri-DEC-0001', title: 'A' }),
      makeRecord({ id: 'kauri-DEC-0002', title: 'B' }),
      makeRecord({ id: 'kauri-DEC-0003', title: 'C' }),
    ];
    const out = renderText(emptyInput({ counts: { active: 3, pinned: 0, drafts: 0 }, indexed }));
    expect(out).toContain('## Index (3 records — use `kauri_show` or `kauri_query` to fetch)');
  });

  test('skips Index section entirely when no indexed records', () => {
    const pinned = [makeRecord({ id: 'kauri-DEC-0001', title: 'Only pinned', pinned: true })];
    const out = renderText(emptyInput({ counts: { active: 1, pinned: 1, drafts: 0 }, pinned }));
    expect(out).not.toContain('## Index');
  });

  test('full mode renders bodies inside the index section', () => {
    const indexed = [
      makeRecord({ id: 'kauri-DEC-0001', title: 'First', body: 'first body content' }),
      makeRecord({ id: 'kauri-DEC-0002', title: 'Second', body: 'second body content' }),
    ];
    const out = renderText(
      emptyInput({
        counts: { active: 2, pinned: 0, drafts: 0 },
        indexed,
        full: true,
      }),
    );
    expect(out).toContain('### [kauri-DEC-0001]');
    expect(out).toContain('first body content');
    expect(out).toContain('### [kauri-DEC-0002]');
    expect(out).toContain('second body content');
    // No bullet entries in full mode
    expect(out).not.toMatch(/^- \[kauri-DEC-/m);
  });
});

// ---------------------------------------------------------------------------
// renderText — markers
// ---------------------------------------------------------------------------

describe('renderText — STALE marker', () => {
  test('appended to index entry title when staleIds contains the id', () => {
    const rec = makeRecord({ id: 'kauri-DEC-0004', title: 'Old decision' });
    const out = renderText(
      emptyInput({
        counts: { active: 1, pinned: 0, drafts: 0 },
        indexed: [rec],
        staleIds: new Set(['kauri-DEC-0004']),
      }),
    );
    expect(out).toContain('| Old decision [STALE]');
  });

  test('appended to pinned record title when staleIds contains the id', () => {
    const rec = makeRecord({ id: 'kauri-DEC-0019', title: 'Pinned but stale', pinned: true });
    const out = renderText(
      emptyInput({
        counts: { active: 1, pinned: 1, drafts: 0 },
        pinned: [rec],
        staleIds: new Set(['kauri-DEC-0019']),
      }),
    );
    expect(out).toContain('| Pinned but stale [STALE]');
  });

  test('not appended when record is not stale', () => {
    const rec = makeRecord({ id: 'kauri-DEC-0001', title: 'Fresh' });
    const out = renderText(
      emptyInput({ counts: { active: 1, pinned: 0, drafts: 0 }, indexed: [rec] }),
    );
    expect(out).not.toContain('[STALE]');
  });
});

describe('renderText — DRAFT marker', () => {
  test('appended to draft record title in index', () => {
    const rec = makeRecord({ id: 'kauri-DEC-0001', title: 'Open question', status: 'draft' });
    const out = renderText(
      emptyInput({
        counts: { active: 0, pinned: 0, drafts: 1 },
        indexed: [rec],
        includeDrafts: true,
      }),
    );
    expect(out).toContain('| Open question [DRAFT]');
  });

  test('both DRAFT and STALE markers can appear together', () => {
    const rec = makeRecord({ id: 'kauri-DEC-0001', title: 'Old draft', status: 'draft' });
    const out = renderText(
      emptyInput({
        counts: { active: 0, pinned: 0, drafts: 1 },
        indexed: [rec],
        staleIds: new Set(['kauri-DEC-0001']),
        includeDrafts: true,
      }),
    );
    expect(out).toContain('| Old draft [DRAFT] [STALE]');
  });
});

// ---------------------------------------------------------------------------
// renderText — full spec-matching snapshot
// ---------------------------------------------------------------------------

describe('renderText — spec example', () => {
  test('matches the structure of kauri-spec.md § kauri_project example', () => {
    const pinned: KauriRecord[] = [
      makeRecord({
        id: 'kauri-DEC-0019',
        title: 'Never log user PII or session tokens',
        body: 'All logging must redact email, phone, JWT bodies. Use the `safeLog()` wrapper in src/lib/log.ts.',
        tags: ['security', 'convention'],
        files: [fileAssoc('src/lib/log.ts')],
        pinned: true,
        created: '2026-03-22T10:00:00.000Z',
        lastValidated: '2026-04-01T10:00:00.000Z',
      }),
      makeRecord({
        id: 'kauri-DEC-0031',
        title: 'Postgres is the only datastore',
        body: 'No Redis, no DynamoDB, no in-memory caches that survive request boundaries.',
        tags: ['architecture', 'data'],
        pinned: true,
        created: '2026-04-01T10:00:00.000Z',
        lastValidated: '2026-04-01T10:00:00.000Z',
      }),
      makeRecord({
        id: 'usr-DEC-0002',
        scope: 'user',
        title: 'Commit messages follow Conventional Commits',
        body: 'Applied to all projects by default.',
        tags: ['convention'],
        pinned: true,
        created: '2026-02-15T10:00:00.000Z',
        lastValidated: '2026-02-15T10:00:00.000Z',
      }),
    ];
    const indexed: KauriRecord[] = [
      makeRecord({
        id: 'kauri-DEC-0001',
        title: 'Monorepo with pnpm workspaces',
        tags: ['architecture'],
      }),
      makeRecord({
        id: 'kauri-DEC-0002',
        title: 'All API responses use camelCase',
        tags: ['convention'],
      }),
      makeRecord({
        id: 'kauri-DEC-0003',
        title: 'Vitest for unit, Playwright for e2e',
        tags: ['testing'],
      }),
      makeRecord({
        id: 'kauri-DEC-0004',
        title: 'JWT with 15min access + 7d refresh',
        tags: ['api', 'convention'],
      }),
      makeRecord({
        id: 'kauri-DEC-0047',
        title: 'Pin Node to 22.x in .nvmrc',
        tags: ['dependency'],
      }),
    ];
    const out = renderText({
      slugLabel: 'kauri',
      counts: { active: 8, pinned: 3, drafts: 0 },
      pinned,
      indexed,
      staleIds: new Set(['kauri-DEC-0004']),
      full: false,
      includeDrafts: false,
    });

    const expected = [
      '# Kauri Records — kauri (8 active, 3 pinned)',
      '',
      '## Pinned',
      '',
      '### [kauri-DEC-0019] project | security, convention | Never log user PII or session tokens',
      'All logging must redact email, phone, JWT bodies. Use the `safeLog()` wrapper in src/lib/log.ts.',
      'Files: src/lib/log.ts',
      'Recorded: 2026-03-22 · Last validated: 2026-04-01',
      '',
      '### [kauri-DEC-0031] project | architecture, data | Postgres is the only datastore',
      'No Redis, no DynamoDB, no in-memory caches that survive request boundaries.',
      'Recorded: 2026-04-01 · Last validated: 2026-04-01',
      '',
      '### [usr-DEC-0002] user | convention | Commit messages follow Conventional Commits',
      'Applied to all projects by default.',
      'Recorded: 2026-02-15 · Last validated: 2026-02-15',
      '',
      '## Index (5 more — use `kauri_show` or `kauri_query` to fetch)',
      '',
      '- [kauri-DEC-0001] project | architecture | Monorepo with pnpm workspaces',
      '- [kauri-DEC-0002] project | convention | All API responses use camelCase',
      '- [kauri-DEC-0003] project | testing | Vitest for unit, Playwright for e2e',
      '- [kauri-DEC-0004] project | api, convention | JWT with 15min access + 7d refresh [STALE]',
      '- [kauri-DEC-0047] project | dependency | Pin Node to 22.x in .nvmrc',
      '',
    ].join('\n');

    expect(out).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// renderJson
// ---------------------------------------------------------------------------

describe('renderJson', () => {
  test('returns the slug label, counts, and mode flags', () => {
    const out = renderJson(
      emptyInput({
        slugLabel: 'kauri',
        counts: { active: 5, pinned: 2, drafts: 1 },
        full: true,
        includeDrafts: true,
      }),
    );
    expect(out.slugLabel).toBe('kauri');
    expect(out.counts).toEqual({ active: 5, pinned: 2, drafts: 1 });
    expect(out.full).toBe(true);
    expect(out.includeDrafts).toBe(true);
  });

  test('pinned records always include full body fields', () => {
    const rec = makeRecord({
      id: 'kauri-DEC-0001',
      title: 'Pinned record',
      body: 'pinned body',
      files: [fileAssoc('src/a.ts')],
      pinned: true,
    });
    const out = renderJson(emptyInput({ pinned: [rec] }));
    expect(out.pinned).toHaveLength(1);
    const entry = out.pinned[0]!;
    expect(entry.id).toBe('kauri-DEC-0001');
    expect(entry.title).toBe('Pinned record');
    expect(entry.body).toBe('pinned body');
    expect(entry.files).toEqual(['src/a.ts']);
    expect(entry.created).toBe('2026-01-01T00:00:00.000Z');
    expect(entry.lastValidated).toBe('2026-01-01T00:00:00.000Z');
  });

  test('indexed records have minimal shape in default mode', () => {
    const rec = makeRecord({ id: 'kauri-DEC-0001', title: 'Indexed', body: 'should be omitted' });
    const out = renderJson(emptyInput({ indexed: [rec] }));
    expect(out.indexed).toHaveLength(1);
    const entry = out.indexed[0]!;
    expect(entry.id).toBe('kauri-DEC-0001');
    expect(entry.title).toBe('Indexed');
    expect(entry).not.toHaveProperty('body');
    expect(entry).not.toHaveProperty('files');
  });

  test('indexed records have full shape in full mode', () => {
    const rec = makeRecord({
      id: 'kauri-DEC-0001',
      title: 'Indexed',
      body: 'now visible',
      files: [fileAssoc('src/a.ts')],
    });
    const out = renderJson(emptyInput({ indexed: [rec], full: true }));
    const entry = out.indexed[0] as { body?: string; files?: readonly string[] };
    expect(entry.body).toBe('now visible');
    expect(entry.files).toEqual(['src/a.ts']);
  });

  test('stale flag propagates from staleIds set', () => {
    const recA = makeRecord({ id: 'kauri-DEC-0001', title: 'fresh' });
    const recB = makeRecord({ id: 'kauri-DEC-0002', title: 'stale' });
    const out = renderJson(
      emptyInput({
        indexed: [recA, recB],
        staleIds: new Set(['kauri-DEC-0002']),
      }),
    );
    expect(out.indexed[0]?.stale).toBe(false);
    expect(out.indexed[1]?.stale).toBe(true);
  });
});
