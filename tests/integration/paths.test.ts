/**
 * Tests for filesystem path resolution in src/store/paths.ts.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ensureParentDir,
  findProjectStorePath,
  KAURI_DIR,
  projectStorePathFor,
  STORE_FILENAME,
  userStorePath,
} from '../../src/store/paths.ts';

let tmpRoot: string;

beforeEach(() => {
  // Each test gets its own root so they're parallel-safe.
  const stamp = Date.now() + Math.random().toString(36).slice(2, 8);
  tmpRoot = join(tmpdir(), `kauri-paths-test-${stamp}`);
  mkdirSync(tmpRoot, { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// findProjectStorePath
// ---------------------------------------------------------------------------

describe('findProjectStorePath', () => {
  test('returns null when no .kauri/store.db exists in any ancestor', () => {
    const nested = join(tmpRoot, 'a', 'b', 'c');
    mkdirSync(nested, { recursive: true });
    expect(findProjectStorePath(nested)).toBeNull();
  });

  test('finds the store in the same directory', () => {
    mkdirSync(join(tmpRoot, KAURI_DIR));
    const path = join(tmpRoot, KAURI_DIR, STORE_FILENAME);
    writeFileSync(path, '');
    expect(findProjectStorePath(tmpRoot)).toBe(path);
  });

  test('finds the store in a parent directory', () => {
    mkdirSync(join(tmpRoot, KAURI_DIR));
    const storePath = join(tmpRoot, KAURI_DIR, STORE_FILENAME);
    writeFileSync(storePath, '');
    const nested = join(tmpRoot, 'a', 'b', 'c');
    mkdirSync(nested, { recursive: true });
    expect(findProjectStorePath(nested)).toBe(storePath);
  });

  test('finds the store in a grandparent directory', () => {
    const projectRoot = join(tmpRoot, 'projectA');
    mkdirSync(join(projectRoot, KAURI_DIR), { recursive: true });
    const storePath = join(projectRoot, KAURI_DIR, STORE_FILENAME);
    writeFileSync(storePath, '');
    const deeplyNested = join(projectRoot, 'src', 'lib', 'sub');
    mkdirSync(deeplyNested, { recursive: true });
    expect(findProjectStorePath(deeplyNested)).toBe(storePath);
  });

  test('prefers the closest ancestor when multiple exist', () => {
    // outer .kauri
    mkdirSync(join(tmpRoot, KAURI_DIR), { recursive: true });
    writeFileSync(join(tmpRoot, KAURI_DIR, STORE_FILENAME), '');
    // inner .kauri
    const inner = join(tmpRoot, 'inner');
    mkdirSync(join(inner, KAURI_DIR), { recursive: true });
    const innerStore = join(inner, KAURI_DIR, STORE_FILENAME);
    writeFileSync(innerStore, '');
    // From a directory inside `inner`, we should find the inner store.
    const nested = join(inner, 'src');
    mkdirSync(nested);
    expect(findProjectStorePath(nested)).toBe(innerStore);
  });

  test('walk terminates at filesystem root without crashing', () => {
    // From `/` upward there's nothing — and the function should return null,
    // not loop forever.
    expect(findProjectStorePath('/')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// projectStorePathFor
// ---------------------------------------------------------------------------

describe('projectStorePathFor', () => {
  test('joins the .kauri directory and store filename onto the project root', () => {
    expect(projectStorePathFor('/some/project')).toBe('/some/project/.kauri/store.db');
  });

  test('resolves relative paths to absolute paths', () => {
    const result = projectStorePathFor('.');
    expect(result.endsWith('/.kauri/store.db')).toBe(true);
    // The path should be absolute
    expect(result.startsWith('/')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// userStorePath
// ---------------------------------------------------------------------------

describe('userStorePath', () => {
  test('returns ~/.kauri/store.db', () => {
    const path = userStorePath();
    expect(path.endsWith('/.kauri/store.db')).toBe(true);
  });

  test('is an absolute path', () => {
    expect(userStorePath().startsWith('/')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ensureParentDir
// ---------------------------------------------------------------------------

describe('ensureParentDir', () => {
  test('creates the parent directory when missing', () => {
    const file = join(tmpRoot, 'a', 'b', 'c', 'file.txt');
    expect(existsSync(join(tmpRoot, 'a'))).toBe(false);
    ensureParentDir(file);
    expect(existsSync(join(tmpRoot, 'a', 'b', 'c'))).toBe(true);
  });

  test('is a no-op when the parent directory already exists', () => {
    const file = join(tmpRoot, 'file.txt');
    // tmpRoot already exists, so ensureParentDir should not throw or recreate.
    expect(() => ensureParentDir(file)).not.toThrow();
    expect(existsSync(tmpRoot)).toBe(true);
  });

  test('is idempotent — calling twice is fine', () => {
    const file = join(tmpRoot, 'sub', 'file.txt');
    ensureParentDir(file);
    expect(() => ensureParentDir(file)).not.toThrow();
  });
});
