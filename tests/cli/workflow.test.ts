/**
 * Layer-3 CLI tests — full lifecycle through the compiled binary.
 *
 * These tests spawn `dist/kauri` in temp directories and verify the
 * complete user-facing workflow: init → record → query → show →
 * update → validate → pin → project → check → status → history.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BIN, run, runOk } from '../helpers/bin.ts';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kauri-cli-test-'));
  // Init a git repo so kauri init sets up the merge driver.
  Bun.spawnSync(['git', 'init', '-q'], { cwd: dir });
  Bun.spawnSync(['git', 'commit', '--allow-empty', '-m', 'init', '-q'], { cwd: dir });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// Skip all tests if binary doesn't exist.
const skip = !existsSync(BIN);

describe('CLI workflow', () => {
  test.skipIf(skip)('init creates a store and git config', async () => {
    const out = await runOk(['init', '--slug', 'clitest'], { cwd: dir });
    expect(out).toContain('Initialised Kauri');
    expect(out).toContain('clitest');
    expect(existsSync(join(dir, '.kauri', 'store.db'))).toBe(true);
    expect(existsSync(join(dir, '.gitattributes'))).toBe(true);
  });

  test.skipIf(skip)('record + query + show + update + validate lifecycle', async () => {
    await runOk(['init', '--slug', 'clitest'], { cwd: dir });

    // Record
    const recordOut = await runOk(
      ['record', '-t', 'Use JWT', '-b', 'JWT with 15min access', '-T', 'api'],
      { cwd: dir },
    );
    expect(recordOut).toContain('clitest-DEC-0001');

    // Query
    const queryOut = await runOk(['query'], { cwd: dir });
    expect(queryOut).toContain('Use JWT');
    expect(queryOut).toContain('1 of 1');

    // Show
    const showOut = await runOk(['show', 'clitest-DEC-0001'], { cwd: dir });
    expect(showOut).toContain('JWT with 15min access');
    expect(showOut).toContain('Revision: 1');

    // Update
    const updateOut = await runOk(
      ['update', 'clitest-DEC-0001', '-t', 'Use JWT with refresh'],
      { cwd: dir },
    );
    expect(updateOut).toContain('revision 2');

    // Validate
    const valOut = await runOk(
      ['validate', 'clitest-DEC-0001', 'still_valid'],
      { cwd: dir },
    );
    expect(valOut).toContain('active');
  });

  test.skipIf(skip)('pin + project shows pinned body', async () => {
    await runOk(['init', '--slug', 'clitest'], { cwd: dir });
    await runOk(
      ['record', '-t', 'Pinned decision', '-b', 'Important body text', '-T', 'architecture'],
      { cwd: dir },
    );
    await runOk(['pin', 'clitest-DEC-0001'], { cwd: dir });

    const projOut = await runOk(['project'], { cwd: dir });
    expect(projOut).toContain('## Pinned');
    expect(projOut).toContain('Important body text');
  });

  test.skipIf(skip)('check reports no stale records on fresh store', async () => {
    await runOk(['init', '--slug', 'clitest'], { cwd: dir });
    await runOk(['record', '-t', 'Fresh', '-b', 'body', '-T', 'api'], { cwd: dir });

    const checkOut = await runOk(['check'], { cwd: dir });
    expect(checkOut).toContain('No stale records');
  });

  test.skipIf(skip)('status shows correct counts', async () => {
    await runOk(['init', '--slug', 'clitest'], { cwd: dir });
    await runOk(['record', '-t', 'A', '-b', 'b', '-T', 'api'], { cwd: dir });
    await runOk(['record', '-t', 'B', '-b', 'b', '-T', 'api', '--pin'], { cwd: dir });
    await runOk(['record', '-t', 'C', '-b', 'b', '-T', 'api', '-S', 'draft'], { cwd: dir });

    const statusOut = await runOk(['status'], { cwd: dir });
    expect(statusOut).toContain('Active: 2');
    expect(statusOut).toContain('Draft: 1');
    expect(statusOut).toContain('Pinned: 1');
  });

  test.skipIf(skip)('taxonomy list + add', async () => {
    await runOk(['init', '--slug', 'clitest'], { cwd: dir });

    const taxOut = await runOk(['taxonomy'], { cwd: dir });
    expect(taxOut).toContain('api');
    expect(taxOut).toContain('architecture');

    const addOut = await runOk(['taxonomy', 'add', 'custom-tag'], { cwd: dir });
    expect(addOut).toContain("Added 'custom-tag'");
  });

  test.skipIf(skip)('history shows supersession chain', async () => {
    await runOk(['init', '--slug', 'clitest'], { cwd: dir });
    await runOk(['record', '-t', 'V1', '-b', 'first', '-T', 'api'], { cwd: dir });
    await runOk(
      ['record', '-t', 'V2', '-b', 'second', '-T', 'api', '-X', 'clitest-DEC-0001'],
      { cwd: dir },
    );

    const histOut = await runOk(['history', 'clitest-DEC-0001'], { cwd: dir });
    expect(histOut).toContain('clitest-DEC-0001');
    expect(histOut).toContain('clitest-DEC-0002');
  });
});

describe('CLI JSON output', () => {
  test.skipIf(skip)('--json flag produces valid JSON for query', async () => {
    await runOk(['init', '--slug', 'clitest'], { cwd: dir });
    await runOk(['record', '-t', 'Test', '-b', 'body', '-T', 'api'], { cwd: dir });

    const out = await runOk(['query', '--json'], { cwd: dir });
    const parsed = JSON.parse(out);
    expect(parsed.records).toHaveLength(1);
    expect(parsed.total).toBe(1);
    expect(parsed.records[0].title).toBe('Test');
  });

  test.skipIf(skip)('--json flag produces valid JSON for status', async () => {
    await runOk(['init', '--slug', 'clitest'], { cwd: dir });
    const out = await runOk(['status', '--json'], { cwd: dir });
    const parsed = JSON.parse(out);
    expect(typeof parsed.active).toBe('number');
    expect(typeof parsed.taxonomySize).toBe('number');
  });
});

describe('CLI exit codes', () => {
  test.skipIf(skip)('show with unknown ID exits 3', async () => {
    await runOk(['init', '--slug', 'clitest'], { cwd: dir });
    const result = await run(['show', 'clitest-DEC-9999'], { cwd: dir });
    expect(result.exitCode).toBe(3);
  });

  test.skipIf(skip)('validate with bad verdict exits 2', async () => {
    await runOk(['init', '--slug', 'clitest'], { cwd: dir });
    await runOk(['record', '-t', 'X', '-b', 'y', '-T', 'api'], { cwd: dir });
    const result = await run(['validate', 'clitest-DEC-0001', 'bogus'], { cwd: dir });
    expect(result.exitCode).toBe(2);
  });

  test.skipIf(skip)('record with unknown tag exits 1', async () => {
    await runOk(['init', '--slug', 'clitest'], { cwd: dir });
    const result = await run(['record', '-t', 'X', '-b', 'y', '-T', 'unknown-tag'], { cwd: dir });
    expect(result.exitCode).not.toBe(0);
  });
});
