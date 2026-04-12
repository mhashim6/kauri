import { basename } from 'node:path';

import type { Command } from 'commander';

import { systemClock } from '../../core/clock.ts';
import { initStore } from '../../services/init-service.ts';
import { projectStorePathFor, userStorePath } from '../../store/paths.ts';
import { isJsonMode } from '../main.ts';
import { handleError, printJson, printText } from '../output.ts';

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Initialise a new Kauri store')
    .option('-s, --slug <slug>', 'Project slug override (defaults to directory name)')
    .option('--scope <scope>', 'project or user', 'project')
    .action((opts: { slug?: string; scope?: string }, cmd: Command) => {
      const json = isJsonMode(cmd);
      try {
        const scope = opts.scope === 'user' ? 'user' : 'project';
        const storePath =
          scope === 'user' ? userStorePath() : projectStorePathFor(process.cwd());
        const slug = opts.slug ?? (scope === 'project' ? basename(process.cwd()) : undefined);

        const result = initStore({
          storePath,
          scope,
          slug,
          clock: systemClock,
        });

        if (json) {
          printJson(result);
        } else {
          printText(`Initialised Kauri ${result.scope} store at ${result.storePath}`);
          printText(`Slug: ${result.slug}`);
          printText(`Created: ${result.createdAt}`);
        }
      } catch (err) {
        handleError(err, json);
      }
    });
}
