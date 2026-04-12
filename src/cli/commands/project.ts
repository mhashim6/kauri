import type { Command } from 'commander';

import { projectRecords } from '../../services/projection-service.ts';
import { isJsonMode, openContext, parseScopeRead } from '../main.ts';
import { handleError, printJson, printText } from '../output.ts';

export function registerProject(program: Command): void {
  program
    .command('project')
    .description('Compile active records for context injection')
    .option('-T, --tag <tag...>', 'Filter by tags')
    .option('--full', 'Include full bodies (not just index)')
    .option('--include-drafts', 'Include draft records')
    .option('--format <format>', 'text or json', 'text')
    .option('-s, --scope <scope>', 'project, user, or both', 'both')
    .action((opts: Record<string, unknown>, cmd: Command) => {
      const json = isJsonMode(cmd);
      const { ctx, cleanup } = openContext();
      try {
        const format = opts['format'] === 'json' || json ? 'json' : 'text';
        const result = projectRecords(ctx, {
          scope: parseScopeRead(opts['scope'] as string | undefined),
          tags: opts['tag'] as string[] | undefined,
          includeDrafts: opts['includeDrafts'] === true,
          full: opts['full'] === true,
          format,
        });
        if (result.json) {
          printJson(result.json);
        } else if (result.text) {
          printText(result.text);
        }
      } catch (err) {
        handleError(err, json);
      } finally {
        cleanup();
      }
    });
}
