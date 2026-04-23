/**
 * Integration tests for the meta key/value repo.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { META_DEFAULTS } from '../../src/core/constants.ts';
import { KauriError } from '../../src/core/errors.ts';
import { latestVersion } from '../../src/store/migrations.ts';
import { MetaRepo } from '../../src/store/repo/meta.ts';
import { makeTmpStore, type TmpStore } from '../helpers/tmp-store.ts';

let tmp: TmpStore;
let meta: MetaRepo;

beforeEach(() => {
  tmp = makeTmpStore();
  meta = new MetaRepo(tmp.store.db);
});

afterEach(() => {
  tmp?.cleanup();
});

// ---------------------------------------------------------------------------
// Generic get/set
// ---------------------------------------------------------------------------

describe('MetaRepo — generic get/set', () => {
  test('get returns null for missing keys', () => {
    expect(meta.get('does_not_exist')).toBeNull();
  });

  test('set then get round-trips a value', () => {
    meta.set('foo', 'bar');
    expect(meta.get('foo')).toBe('bar');
  });

  test('set is INSERT OR REPLACE', () => {
    meta.set('foo', 'bar');
    meta.set('foo', 'baz');
    expect(meta.get('foo')).toBe('baz');
  });

  test('get treats empty string as null', () => {
    meta.set('emptied', '');
    expect(meta.get('emptied')).toBeNull();
  });

  test('getRaw distinguishes empty string from missing', () => {
    meta.set('emptied', '');
    expect(meta.getRaw('emptied')).toBe('');
    expect(meta.getRaw('does_not_exist')).toBeNull();
  });

  test('setMany inserts all entries', () => {
    meta.setMany({ a: '1', b: '2', c: '3' });
    expect(meta.get('a')).toBe('1');
    expect(meta.get('b')).toBe('2');
    expect(meta.get('c')).toBe('3');
  });
});

// ---------------------------------------------------------------------------
// Slug
// ---------------------------------------------------------------------------

describe('MetaRepo — slug', () => {
  test('returns null when slug not set', () => {
    expect(meta.getSlug()).toBeNull();
  });

  test('round-trips a normalised slug', () => {
    meta.setSlug('kauri');
    expect(meta.getSlug()).toBe('kauri');
  });

  test('normalises raw input through normalizeSlug', () => {
    meta.setSlug('My Cool App!');
    expect(meta.getSlug()).toBe('my-cool-app');
  });

  test('rejects reserved values via normalizeSlug', () => {
    expect(() => meta.setSlug('usr')).toThrow(KauriError);
    expect(() => meta.setSlug('dec')).toThrow(KauriError);
  });

  test('rejects values that normalise to empty', () => {
    expect(() => meta.setSlug('日本語')).toThrow(KauriError);
    expect(() => meta.setSlug('   ')).toThrow(KauriError);
  });
});

// ---------------------------------------------------------------------------
// Created at
// ---------------------------------------------------------------------------

describe('MetaRepo — created_at', () => {
  test('returns null when not set', () => {
    expect(meta.getCreatedAt()).toBeNull();
  });

  test('round-trips an ISO 8601 string', () => {
    meta.setCreatedAt('2026-04-11T10:30:00.000Z');
    expect(meta.getCreatedAt()).toBe('2026-04-11T10:30:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

describe('MetaRepo — schema_version', () => {
  test('reads the seeded value (set by the migration runner)', () => {
    expect(meta.getSchemaVersion()).toBe(latestVersion());
  });

  test('setSchemaVersion accepts non-negative integers', () => {
    meta.setSchemaVersion(7);
    expect(meta.getSchemaVersion()).toBe(7);
    meta.setSchemaVersion(0);
    expect(meta.getSchemaVersion()).toBe(0);
  });

  test('setSchemaVersion rejects negative or non-integer', () => {
    expect(() => meta.setSchemaVersion(-1)).toThrow(TypeError);
    expect(() => meta.setSchemaVersion(1.5)).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// Default TTL
// ---------------------------------------------------------------------------

describe('MetaRepo — default_ttl_days', () => {
  test('reads the seeded default of 90', () => {
    expect(meta.getDefaultTtlDays()).toBe(90);
  });

  test('round-trips a custom value', () => {
    meta.setDefaultTtlDays(30);
    expect(meta.getDefaultTtlDays()).toBe(30);
  });

  test('null clears the value (disables time-based staleness)', () => {
    meta.setDefaultTtlDays(null);
    expect(meta.getDefaultTtlDays()).toBeNull();
  });

  test('getDefaultTtlDaysOrFallback returns META_DEFAULTS when null', () => {
    meta.setDefaultTtlDays(null);
    expect(meta.getDefaultTtlDaysOrFallback()).toBe(META_DEFAULTS.defaultTtlDays);
  });

  test('getDefaultTtlDaysOrFallback returns the stored value when set', () => {
    meta.setDefaultTtlDays(45);
    expect(meta.getDefaultTtlDaysOrFallback()).toBe(45);
  });

  test('rejects negative or non-integer', () => {
    expect(() => meta.setDefaultTtlDays(-1)).toThrow(TypeError);
    expect(() => meta.setDefaultTtlDays(1.5)).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// Pin soft cap
// ---------------------------------------------------------------------------

describe('MetaRepo — pin_soft_cap', () => {
  test('reads the seeded default of 10', () => {
    expect(meta.getPinSoftCap()).toBe(10);
  });

  test('round-trips a custom value', () => {
    meta.setPinSoftCap(25);
    expect(meta.getPinSoftCap()).toBe(25);
  });

  test('falls back to META_DEFAULTS when value is missing', () => {
    meta.set('pin_soft_cap', '');
    expect(meta.getPinSoftCap()).toBe(META_DEFAULTS.pinSoftCap);
  });

  test('falls back when value is unparseable', () => {
    meta.set('pin_soft_cap', 'not a number');
    expect(meta.getPinSoftCap()).toBe(META_DEFAULTS.pinSoftCap);
  });

  test('rejects negative on set', () => {
    expect(() => meta.setPinSoftCap(-1)).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// File hash size cap
// ---------------------------------------------------------------------------

describe('MetaRepo — file_hash_size_cap_bytes', () => {
  test('reads the seeded default of 1 MiB', () => {
    expect(meta.getFileHashSizeCapBytes()).toBe(META_DEFAULTS.fileHashSizeCapBytes);
  });

  test('round-trips a custom value', () => {
    meta.setFileHashSizeCapBytes(2 * 1024 * 1024);
    expect(meta.getFileHashSizeCapBytes()).toBe(2 * 1024 * 1024);
  });

  test('falls back when value is missing or unparseable', () => {
    meta.set('file_hash_size_cap_bytes', '');
    expect(meta.getFileHashSizeCapBytes()).toBe(META_DEFAULTS.fileHashSizeCapBytes);
    meta.set('file_hash_size_cap_bytes', 'huh');
    expect(meta.getFileHashSizeCapBytes()).toBe(META_DEFAULTS.fileHashSizeCapBytes);
  });
});
