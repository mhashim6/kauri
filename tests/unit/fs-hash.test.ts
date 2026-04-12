import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sha256File, sha256String } from '../../src/fs/hash.ts';

describe('sha256String', () => {
  test('hashes the empty string to the well-known SHA-256 zero digest', () => {
    expect(sha256String('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  test('hashes "hello" to the well-known digest', () => {
    expect(sha256String('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  test('different strings produce different hashes', () => {
    expect(sha256String('foo')).not.toBe(sha256String('bar'));
  });

  test('produces a 64-character lowercase hex string', () => {
    const h = sha256String('anything');
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('sha256File', () => {
  test('matches sha256String for the same content', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kauri-hash-test-'));
    try {
      const path = join(dir, 'sample.txt');
      const content = 'kauri is a deterministic record database';
      writeFileSync(path, content);
      expect(await sha256File(path)).toBe(sha256String(content));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('handles an empty file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kauri-hash-test-'));
    try {
      const path = join(dir, 'empty.txt');
      writeFileSync(path, '');
      expect(await sha256File(path)).toBe(sha256String(''));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('handles a moderately large file (256 KiB) without OOM', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kauri-hash-test-'));
    try {
      const path = join(dir, 'big.txt');
      const chunk = 'x'.repeat(1024);
      const content = chunk.repeat(256);
      writeFileSync(path, content);
      expect(await sha256File(path)).toBe(sha256String(content));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
