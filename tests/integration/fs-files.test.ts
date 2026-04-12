import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { META_DEFAULTS } from '../../src/core/constants.ts';
import { systemFsProbe } from '../../src/fs/files.ts';
import { sha256String } from '../../src/fs/hash.ts';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kauri-fs-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('systemFsProbe — defaults', () => {
  test('uses META_DEFAULTS.fileHashSizeCapBytes when no override given', () => {
    const probe = systemFsProbe();
    expect(probe.sizeCap).toBe(META_DEFAULTS.fileHashSizeCapBytes);
  });

  test('respects sizeCap override', () => {
    const probe = systemFsProbe({ sizeCap: 1234 });
    expect(probe.sizeCap).toBe(1234);
  });
});

describe('systemFsProbe.stat', () => {
  test('returns null for a file that does not exist', () => {
    const probe = systemFsProbe();
    expect(probe.stat(join(dir, 'nope.txt'))).toBeNull();
  });

  test('returns null when an intermediate path component is a file (ENOTDIR)', () => {
    const probe = systemFsProbe();
    const file = join(dir, 'a-file.txt');
    writeFileSync(file, 'x');
    // Trying to stat below a regular file produces ENOTDIR on POSIX.
    expect(probe.stat(join(file, 'inside'))).toBeNull();
  });

  test('rethrows non-missing-file errors (e.g. embedded null bytes)', () => {
    const probe = systemFsProbe();
    // Node rejects paths containing null bytes with ERR_INVALID_ARG_VALUE,
    // not ENOENT — the probe must rethrow rather than swallowing it.
    expect(() => probe.stat('foo\0bar')).toThrow();
  });

  test('returns mtime in seconds and size in bytes for an existing file', () => {
    const probe = systemFsProbe();
    const path = join(dir, 'sample.txt');
    writeFileSync(path, 'hello world');
    const stat = probe.stat(path);
    expect(stat).not.toBeNull();
    expect(stat?.size).toBe(11);
    // mtime should be unix epoch seconds, not ms
    const realMtimeSeconds = Math.floor(statSync(path).mtimeMs / 1000);
    expect(stat?.mtime).toBe(realMtimeSeconds);
    // sanity: looks like seconds, not milliseconds
    expect(stat?.mtime).toBeLessThan(1e12);
    expect(stat?.mtime).toBeGreaterThan(1e9);
  });
});

describe('systemFsProbe.hash', () => {
  test('matches sha256String for the same content', async () => {
    const probe = systemFsProbe();
    const path = join(dir, 'sample.txt');
    const content = 'a deterministic test';
    writeFileSync(path, content);
    expect(await probe.hash(path)).toBe(sha256String(content));
  });
});
