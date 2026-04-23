/**
 * Bun test preload — runs once before any test file.
 *
 * Ensures `dist/kauri` exists for layer-3 (CLI) and layer-4 (MCP)
 * tests. If the binary is missing, runs a build. If the build fails,
 * logs a warning but doesn't block unit/integration tests.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const BIN = resolve(import.meta.dir, '../../dist/kauri');

if (!existsSync(BIN)) {
  console.warn(`preload: ${BIN} not found, building...`);
  const proc = Bun.spawnSync(['bun', 'run', 'build'], {
    cwd: resolve(import.meta.dir, '../..'),
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (proc.exitCode !== 0) {
    console.warn(`preload: build failed (exit ${proc.exitCode}). Layer 3/4 tests will be skipped.`);
  }
}

export {};
