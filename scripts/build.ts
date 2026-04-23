/**
 * Build script: embed migrations then compile to a single binary.
 *
 * Run via:
 *   bun run build     (npm script — runs prebuild + this script)
 *   bun run scripts/build.ts
 *
 * Output: dist/kauri (standalone binary, no Bun runtime needed)
 */
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const ENTRY = resolve(ROOT, 'src/cli.ts');
const OUTFILE = resolve(ROOT, 'dist/kauri');

async function main(): Promise<void> {
  console.log('build: compiling...');
  console.log(`  entry:  ${ENTRY}`);
  console.log(`  output: ${OUTFILE}`);

  const result = await Bun.build({
    entrypoints: [ENTRY],
    outdir: resolve(ROOT, 'dist'),
    target: 'bun',
    minify: true,
    sourcemap: 'linked',
  });

  if (!result.success) {
    console.error('build: compilation failed:');
    for (const msg of result.logs) {
      console.error(`  ${msg}`);
    }
    process.exit(1);
  }

  // Bun.build produces a JS bundle, not a compiled binary.
  // For the standalone binary, we need `bun build --compile`.
  // Bun.build() API doesn't support --compile yet, so we shell out.
  const proc = Bun.spawn(['bun', 'build', '--compile', '--minify', '--outfile', OUTFILE, ENTRY], {
    cwd: ROOT,
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    console.error(`build: bun build --compile exited with code ${exitCode}`);
    process.exit(exitCode);
  }

  console.log(`build: done → ${OUTFILE}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
