/**
 * `kauri setup-git` — register the merge driver in the current git repo.
 *
 * This is for existing repos where `kauri init` already ran (so the
 * store exists) but the git merge driver wasn't set up yet — either
 * because init ran before the merge driver feature existed, or because
 * a teammate cloned the repo and needs the local git config.
 *
 * Two things happen:
 *   1. `.gitattributes` gets the `merge=kauri` line (if not present).
 *   2. `.git/config` gets the `[merge "kauri"]` section (if not present).
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import type { Command } from 'commander';

import { isJsonMode } from '../main.ts';
import { handleError, printJson, printText } from '../output.ts';

export function registerSetupGit(program: Command): void {
  program
    .command('setup-git')
    .description('Register the Kauri merge driver in the current git repo')
    .action((_opts: Record<string, unknown>, cmd: Command) => {
      const json = isJsonMode(cmd);
      try {
        const cwd = process.cwd();
        const gitDir = findGitDir(cwd);
        if (gitDir === null) {
          printText('Not inside a git repository. Nothing to do.');
          return;
        }

        const projectRoot = dirname(gitDir);
        const driverCmd = resolveDriverCommand();

        // 1. .gitattributes — merge driver
        const gitattrsPath = join(projectRoot, '.gitattributes');
        const mergeAttrLine = '.kauri/store.db merge=kauri';
        const attrCreated = ensureLineInFile(gitattrsPath, mergeAttrLine);

        // 1b. .gitignore — exclude WAL/SHM runtime files
        const gitignorePath = join(projectRoot, '.gitignore');
        ensureLineInFile(gitignorePath, '*.db-wal');
        ensureLineInFile(gitignorePath, '*.db-shm');

        // 2. .git/config
        let configCreated = false;
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
            configCreated = true;
          }
        }

        if (json) {
          printJson({
            gitattributes: attrCreated ? 'created' : 'already present',
            gitConfig: configCreated ? 'created' : 'already present',
            driverCommand: `${driverCmd} merge-driver %O %A %B`,
          });
        } else {
          if (attrCreated) {
            printText(`Created ${gitattrsPath}`);
          } else {
            printText(`.gitattributes already has the merge driver line.`);
          }
          if (configCreated) {
            printText(`Registered merge driver in ${gitConfigPath}`);
          } else {
            printText(`Merge driver already registered in .git/config.`);
          }
          printText(`Driver command: ${driverCmd} merge-driver %O %A %B`);
        }
      } catch (err) {
        handleError(err, json);
      }
    });
}

function findGitDir(startDir: string): string | null {
  let current = resolve(startDir);
  for (;;) {
    const candidate = join(current, '.git');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function resolveDriverCommand(): string {
  const argv0 = process.argv[0] ?? '';
  const argv1 = process.argv[1] ?? '';
  if (argv0.endsWith('/kauri') || argv0.endsWith('\\kauri')) return argv0;
  if (argv1.endsWith('.ts') || argv1.endsWith('.js')) return `bun run ${resolve(argv1)}`;
  return 'kauri';
}

/** Returns true if the line was added, false if already present. */
function ensureLineInFile(filePath: string, line: string): boolean {
  if (existsSync(filePath)) {
    const content = readFileSync(filePath, 'utf-8');
    if (content.includes(line)) return false;
    appendFileSync(filePath, (content.endsWith('\n') ? '' : '\n') + line + '\n');
    return true;
  }
  writeFileSync(filePath, line + '\n');
  return true;
}
