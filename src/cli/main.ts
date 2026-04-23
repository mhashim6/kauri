/**
 * CLI top-level — commander program definition, context builder, and
 * error handler. Each subcommand is registered by importing its
 * `register` function from `src/cli/commands/`.
 */
import { existsSync } from 'node:fs';

import { Command } from 'commander';

import { systemClock } from '../core/clock.ts';
import { META_DEFAULTS } from '../core/constants.ts';
import type { Scope, ScopeQuery } from '../core/types.ts';
import { systemFsProbe } from '../fs/files.ts';
import { makeStoreBundle, type ServiceContext } from '../services/context.ts';
import { findProjectStorePath, userStorePath } from '../store/paths.ts';
import { Store } from '../store/store.ts';

import { registerCheck } from './commands/check.ts';
import { registerHistory } from './commands/history.ts';
import { registerInit } from './commands/init.ts';
import { registerMergeDriver } from './commands/merge-driver.ts';
import { registerMigrate } from './commands/migrate.ts';
import { registerPin, registerUnpin } from './commands/pin.ts';
import { registerProject } from './commands/project.ts';
import { registerQuery } from './commands/query.ts';
import { registerRecord } from './commands/record.ts';
import { registerServe } from './commands/serve.ts';
import { registerSetupGit } from './commands/setup-git.ts';
import { registerShow } from './commands/show.ts';
import { registerStatus } from './commands/status.ts';
import { registerTaxonomy } from './commands/taxonomy.ts';
import { registerUpdate } from './commands/update.ts';
import { registerValidate } from './commands/validate.ts';

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('kauri')
    .description('A deterministic record database for LLM agents and humans')
    .version('0.1.0')
    .option('-j, --json', 'Output as JSON', false)
    .option('--source <source>', 'Source attribution', 'manual');

  registerInit(program);
  registerRecord(program);
  registerUpdate(program);
  registerQuery(program);
  registerShow(program);
  registerHistory(program);
  registerValidate(program);
  registerProject(program);
  registerPin(program);
  registerUnpin(program);
  registerCheck(program);
  registerTaxonomy(program);
  registerStatus(program);
  registerMigrate(program);
  registerMergeDriver(program);
  registerSetupGit(program);
  registerServe(program);

  return program;
}

/**
 * Build a ServiceContext by opening whatever stores are available.
 * Each command that needs a context calls this in its action handler.
 * The returned `cleanup` function must be called to close the stores.
 */
export function openContext(_scopeHint?: ScopeQuery): { ctx: ServiceContext; cleanup: () => void } {
  const stores: Store[] = [];

  // Project store: walk upward from cwd.
  let projectBundle: ServiceContext['projectBundle'] = null;
  const projectPath = findProjectStorePath(process.cwd());
  if (projectPath !== null) {
    const store = Store.openAt(projectPath, 'project');
    stores.push(store);
    projectBundle = makeStoreBundle(store);
  }

  // User store: only open if the file exists.
  let userBundle: ServiceContext['userBundle'] = null;
  const uPath = userStorePath();
  if (existsSync(uPath)) {
    const store = Store.openAt(uPath, 'user');
    stores.push(store);
    userBundle = makeStoreBundle(store);
  }

  const sizeCap =
    projectBundle?.meta.getFileHashSizeCapBytes() ?? META_DEFAULTS.fileHashSizeCapBytes;

  const ctx: ServiceContext = {
    projectBundle,
    userBundle,
    clock: systemClock,
    fsProbe: systemFsProbe({ sizeCap }),
  };

  const cleanup = (): void => {
    for (const s of stores) {
      try {
        s.close();
      } catch {
        // best effort
      }
    }
  };

  return { ctx, cleanup };
}

/** Extract global --json flag from a Command instance. */
export function isJsonMode(cmd: Command): boolean {
  return cmd.optsWithGlobals().json === true;
}

/** Extract global --source flag from a Command instance. */
export function getSource(cmd: Command): string {
  return (cmd.optsWithGlobals().source as string) ?? 'manual';
}

/** Parse --scope flag into the correct type with 'both' default for reads. */
export function parseScopeRead(value: string | undefined): ScopeQuery {
  if (value === 'project' || value === 'user' || value === 'both') return value;
  return 'both';
}

/** Parse --scope flag for writes (no 'both' allowed). */
export function parseScopeWrite(value: string | undefined): Scope | undefined {
  if (value === 'project' || value === 'user') return value;
  return undefined;
}
