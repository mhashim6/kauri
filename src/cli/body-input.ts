/**
 * Four-pattern body input resolver for `kauri record` and `kauri update`.
 *
 *   1. --body "text" / -b "text"      → inline
 *   2. --body-file path / -f path     → read from file
 *   3. --body - / -b -                → read from stdin
 *   4. (none)                         → open $EDITOR
 *
 * Throws when multiple sources are supplied simultaneously.
 */
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { KauriError } from '../core/errors.ts';

export interface BodyInputOpts {
  readonly body?: string | undefined;
  readonly bodyFile?: string | undefined;
}

/**
 * Resolve the body from the provided CLI options. Returns the body
 * string. Throws `KauriError('usage')` if multiple sources conflict
 * or the body is empty.
 */
export async function resolveBody(opts: BodyInputOpts): Promise<string> {
  const sources: string[] = [];
  if (opts.body !== undefined && opts.body !== '-') sources.push('inline');
  if (opts.body === '-') sources.push('stdin');
  if (opts.bodyFile !== undefined) sources.push('file');

  if (sources.length > 1) {
    throw new KauriError(
      'usage',
      `multiple body sources specified (${sources.join(', ')}); use exactly one of --body, --body-file, or --body - (stdin)`,
    );
  }

  let body: string;

  if (opts.body !== undefined && opts.body !== '-') {
    body = opts.body;
  } else if (opts.body === '-') {
    body = await Bun.stdin.text();
  } else if (opts.bodyFile !== undefined) {
    body = readFileSync(opts.bodyFile, 'utf-8');
  } else {
    // No body specified — open $EDITOR.
    body = await openEditor();
  }

  body = body.trim();
  if (body.length === 0) {
    throw new KauriError('usage', 'body is empty; aborting');
  }
  return body;
}

/**
 * Open $EDITOR (or `vi` fallback) on a temporary file. Returns the
 * file content after the editor exits. Deletes the temp file after
 * reading.
 */
async function openEditor(): Promise<string> {
  const editor = process.env['EDITOR'] ?? process.env['VISUAL'] ?? 'vi';
  const tmpFile = join(tmpdir(), `kauri-body-${Date.now()}.md`);

  // Write a template so the user sees something in the editor.
  const template =
    '# Enter the record body below this line.\n# Lines starting with # are kept (they are NOT comments in this context).\n\n';
  await Bun.write(tmpFile, template);

  const proc = Bun.spawn([editor, tmpFile], {
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  await proc.exited;

  if (proc.exitCode !== 0) {
    throw new KauriError('usage', `editor exited with code ${proc.exitCode}; aborting`);
  }

  const content = readFileSync(tmpFile, 'utf-8');
  // Clean up temp file (best-effort).
  try {
    const { unlinkSync } = await import('node:fs');
    unlinkSync(tmpFile);
  } catch {
    // Ignore — temp dir will be cleaned up eventually.
  }
  return content;
}
