/**
 * Helper for Layer-3 (CLI) tests: spawn the compiled kauri binary.
 */
import { resolve } from 'node:path';

export const BIN = process.env['KAURI_BIN'] ?? resolve(import.meta.dir, '../../dist/kauri');

export interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Spawn the kauri binary with the given args. Returns stdout, stderr,
 * and exit code. Throws if the process times out (default 10s).
 */
export async function run(
  args: string[],
  opts: { cwd?: string; stdin?: string; timeout?: number } = {},
): Promise<RunResult> {
  const proc = Bun.spawn([BIN, ...args], {
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
    stdin: opts.stdin !== undefined ? new Blob([opts.stdin]) : 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const timeout = opts.timeout ?? 10000;
  const timer = setTimeout(() => proc.kill(), timeout);

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  clearTimeout(timer);
  return { stdout, stderr, exitCode };
}

/**
 * Convenience: run and assert exit code 0. Returns stdout.
 * Throws with stderr on failure.
 */
export async function runOk(args: string[], opts: { cwd?: string } = {}): Promise<string> {
  const result = await run(args, opts);
  if (result.exitCode !== 0) {
    throw new Error(
      `kauri ${args.join(' ')} exited with code ${result.exitCode}\nstderr: ${result.stderr}\nstdout: ${result.stdout}`,
    );
  }
  return result.stdout;
}
