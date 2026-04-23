/**
 * Codegen: emit src/store/migrations-data.ts from migrations/*.sql.
 *
 * Why this exists: `bun build --compile` does not bundle arbitrary
 * filesystem reads, but it *does* embed text imports declared with
 * `with { type: 'text' }`. To avoid hand-maintaining the import list
 * each time we add a migration, this script discovers the SQL files,
 * validates their version numbers are sequential starting from 1, and
 * regenerates the data module.
 *
 * Run via:
 *   bun run embed-migrations    (npm script — defined in package.json)
 *   bun run scripts/embed-migrations.ts
 *
 * The output file is gitignored — it's regenerated as part of `prebuild`
 * and on demand during development.
 */
import { Glob } from 'bun';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const MIGRATIONS_DIR = resolve(ROOT, 'migrations');
const OUT_FILE = resolve(ROOT, 'src/store/migrations-data.ts');

interface DiscoveredMigration {
  readonly version: number;
  readonly filename: string;
  readonly baseName: string;
}

async function discover(): Promise<DiscoveredMigration[]> {
  const glob = new Glob('*.sql');
  const filenames: string[] = [];
  for await (const name of glob.scan(MIGRATIONS_DIR)) {
    filenames.push(name);
  }
  filenames.sort();

  if (filenames.length === 0) {
    throw new Error(`no migration files found in ${MIGRATIONS_DIR}`);
  }

  const out: DiscoveredMigration[] = [];
  for (const filename of filenames) {
    const match = /^(\d{4})_(.+)\.sql$/.exec(filename);
    if (match === null) {
      throw new Error(`migration filename ${filename} does not match '<NNNN>_<name>.sql' shape`);
    }
    const version = Number.parseInt(match[1] as string, 10);
    out.push({
      version,
      filename,
      baseName: filename.replace(/\.sql$/, ''),
    });
  }

  // Validate sequential versions starting from 1.
  for (let i = 0; i < out.length; i++) {
    const expected = i + 1;
    const got = (out[i] as DiscoveredMigration).version;
    if (got !== expected) {
      throw new Error(
        `migration version gap or duplicate: expected ${expected}, got ${got} in ${(out[i] as DiscoveredMigration).filename}`,
      );
    }
  }

  return out;
}

function render(entries: readonly DiscoveredMigration[]): string {
  const lines: string[] = [
    '// GENERATED FILE — do not edit by hand.',
    '// Regenerate with `bun run embed-migrations`.',
    '//',
    '// Embeds migration SQL as text imports so `bun build --compile`',
    '// bundles the SQL into the standalone binary. The migration runner',
    '// in `./migrations.ts` consumes the `MIGRATIONS` array exported below.',
    '',
  ];
  for (const e of entries) {
    const importName = `sql${e.version.toString().padStart(4, '0')}`;
    lines.push(`import ${importName} from '../../migrations/${e.filename}' with { type: 'text' };`);
  }
  lines.push('');
  lines.push('export interface Migration {');
  lines.push('  readonly version: number;');
  lines.push('  readonly name: string;');
  lines.push('  readonly sql: string;');
  lines.push('}');
  lines.push('');
  lines.push('export const MIGRATIONS: readonly Migration[] = [');
  for (const e of entries) {
    const importName = `sql${e.version.toString().padStart(4, '0')}`;
    lines.push(`  { version: ${e.version}, name: '${e.baseName}', sql: ${importName} },`);
  }
  lines.push('];');
  lines.push('');
  return lines.join('\n');
}

async function main(): Promise<void> {
  const entries = await discover();
  const source = render(entries);
  await writeFile(OUT_FILE, source);
  console.log(`embed-migrations: wrote ${OUT_FILE} with ${entries.length} migration(s)`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
