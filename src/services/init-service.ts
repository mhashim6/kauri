/**
 * `kauri init` — create and seed a new store.
 *
 * 1. Create the `.kauri/` directory (or `~/.kauri/` for user scope).
 * 2. Open the store (which runs pending migrations).
 * 3. Seed `meta` with the project slug and init timestamp.
 * 4. Seed `taxonomy` with the default tag vocabulary.
 *
 * Refuses to re-init if a store already exists at the target path.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import type { Clock } from '../core/clock.ts';
import { DEFAULT_TAXONOMY } from '../core/constants.ts';
import { KauriError } from '../core/errors.ts';
import { normalizeSlug } from '../core/slug.ts';
import type { Scope } from '../core/types.ts';
import { MetaRepo } from '../store/repo/meta.ts';
import { TaxonomyRepo } from '../store/repo/tags.ts';
import { Store } from '../store/store.ts';

export interface InitInput {
  /** Where to create the store. Absolute path to the `.db` file. */
  readonly storePath: string;
  /** Which scope this store represents. */
  readonly scope: Scope;
  /**
   * Project slug. Required for project scope; ignored for user scope.
   * May be the raw directory name — will be normalised and validated.
   */
  readonly slug?: string | undefined;
  readonly clock: Clock;
}

export interface InitResult {
  /** Absolute path to the created store file. */
  readonly storePath: string;
  readonly scope: Scope;
  /** The normalised slug (project scope) or `'usr'` (user scope). */
  readonly slug: string;
  readonly createdAt: string;
}

/**
 * Create and seed a new Kauri store. Throws if a store already exists
 * at the given path (use `Store.openAt` to open an existing store).
 */
export function initStore(input: InitInput): InitResult {
  if (existsSync(input.storePath)) {
    throw new KauriError(
      'conflict',
      `a store already exists at ${input.storePath}; use 'kauri serve' or 'kauri record' to interact with it`,
      { path: input.storePath },
    );
  }

  const scope = input.scope;
  const slug = scope === 'project' ? normalizeSlug(input.slug ?? '') : 'usr';

  const now = input.clock.nowIso();
  const store = Store.openAt(input.storePath, scope);

  try {
    store.tx(() => {
      const meta = new MetaRepo(store.db);
      // For user scope, the slug is the literal 'usr' which is a reserved
      // value for normalizeSlug. We bypass re-validation and write directly.
      if (scope === 'user') {
        meta.set('slug', slug);
      } else {
        meta.setSlug(slug);
      }
      meta.setCreatedAt(now);

      const taxonomy = new TaxonomyRepo(store.db);
      taxonomy.addMany(DEFAULT_TAXONOMY, now);
    });
  } catch (err) {
    store.close();
    throw err;
  }

  store.close();

  // For project scope, set up git merge driver if inside a git repo.
  if (scope === 'project') {
    setupGitMergeDriver(input.storePath);
  }

  return {
    storePath: input.storePath,
    scope,
    slug,
    createdAt: now,
  };
}

// ---------------------------------------------------------------------------
// Git merge driver setup
// ---------------------------------------------------------------------------

/**
 * If the store lives inside a git repo:
 *   1. Create `.gitattributes` with the merge driver line (if not present).
 *   2. Register the merge driver in `.git/config` (if not present).
 *
 * Failures are silently ignored — git setup is best-effort. The store
 * works fine without it; merges just won't auto-resolve.
 */
function setupGitMergeDriver(storePath: string): void {
  try {
    const kauriDir = dirname(storePath); // .kauri/
    const projectRoot = dirname(kauriDir);
    const gitDir = findGitDir(projectRoot);
    if (gitDir === null) return;

    // 1. .gitattributes — merge driver
    const gitattrsPath = join(projectRoot, '.gitattributes');
    const mergeAttrLine = '.kauri/store.db merge=kauri';
    ensureLineInFile(gitattrsPath, mergeAttrLine);

    // 1b. .gitignore — exclude WAL/SHM runtime files
    const gitignorePath = join(projectRoot, '.gitignore');
    ensureLineInFile(gitignorePath, '*.db-wal');
    ensureLineInFile(gitignorePath, '*.db-shm');

    // 2. .git/config — use the actual invocable path to kauri.
    const driverCmd = resolveDriverCommand();
    const gitConfigPath = join(gitDir, 'config');
    if (existsSync(gitConfigPath)) {
      const content = readFileSync(gitConfigPath, 'utf-8');
      if (!content.includes('[merge "kauri"]')) {
        const driverConfig = [
          '',
          '[merge "kauri"]',
          '\tname = Kauri decision store merge',
          `\tdriver = ${driverCmd} merge-driver %O %A %B`,
          '',
        ].join('\n');
        appendFileSync(gitConfigPath, driverConfig);
      }
    }
  } catch {
    // Best-effort: don't fail init if git setup fails.
  }
}

/** Walk upward looking for a `.git` directory. */
function findGitDir(startDir: string): string | null {
  let current = startDir;
  for (;;) {
    const candidate = join(current, '.git');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Figure out the command to invoke kauri. If we're running from the
 * compiled binary (`dist/kauri` or installed globally), use `kauri`.
 * If we're running via `bun run src/cli.ts`, use the absolute path
 * so git can find it regardless of cwd.
 */
function resolveDriverCommand(): string {
  const argv0 = process.argv[0] ?? '';
  const argv1 = process.argv[1] ?? '';

  // Running as compiled binary: argv[0] is the binary path.
  // Check if argv[0] ends with /kauri (not /bun).
  if (argv0.endsWith('/kauri') || argv0.endsWith('\\kauri')) {
    return argv0;
  }

  // Running via `bun run src/cli.ts`: argv[0] is bun, argv[1] is the script.
  if (argv1.endsWith('.ts') || argv1.endsWith('.js')) {
    return `bun run ${resolve(argv1)}`;
  }

  // Fallback: assume `kauri` is in PATH.
  return 'kauri';
}

/** Ensure a line exists in a file (create if missing). */
function ensureLineInFile(filePath: string, line: string): void {
  if (existsSync(filePath)) {
    const content = readFileSync(filePath, 'utf-8');
    if (content.includes(line)) return;
    appendFileSync(filePath, (content.endsWith('\n') ? '' : '\n') + line + '\n');
  } else {
    writeFileSync(filePath, line + '\n');
  }
}
