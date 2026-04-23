import type { Command } from 'commander';

import { queryRecords } from '../../services/records-service.ts';
import { isJsonMode, openContext, parseScopeRead } from '../main.ts';
import { handleError, printJson, printText } from '../output.ts';

export function registerQuery(program: Command): void {
  program
    .command('query')
    .description('List records matching filters')
    .option('-T, --tag <tag...>', 'Filter by tags (OR semantics)')
    .option('-S, --status <status>', 'Filter by status (default: active)')
    .option('-F, --file <path...>', 'Filter by associated file')
    .option('-x, --text <query>', 'Full-text search')
    .option('--since <iso>', 'Created on or after')
    .option('-n, --limit <n>', 'Result cap', '100')
    .option('-o, --offset <n>', 'Pagination offset', '0')
    .option('-s, --scope <scope>', 'project, user, or both', 'both')
    .action((opts: Record<string, unknown>, cmd: Command) => {
      const json = isJsonMode(cmd);
      const { ctx, cleanup } = openContext();
      try {
        const result = queryRecords(
          ctx,
          {
            tags: opts['tag'] as string[] | undefined,
            status: opts['status'] as string | undefined as
              | 'active'
              | 'draft'
              | 'superseded'
              | 'deprecated'
              | 'any'
              | undefined,
            files: opts['file'] as string[] | undefined,
            text: opts['text'] as string | undefined,
            since: opts['since'] as string | undefined,
            limit: Number(opts['limit']),
            offset: Number(opts['offset']),
          },
          parseScopeRead(opts['scope'] as string | undefined),
        );
        if (json) {
          printJson({ records: result.records, total: result.total });
        } else {
          if (result.records.length === 0) {
            printText('No records found.');
          } else {
            for (const r of result.records) {
              const tags = r.tags.join(', ');
              printText(`[${r.id}] ${r.scope} | ${r.status} | ${tags} | ${r.title}`);
            }
            printText(`\n${result.records.length} of ${result.total} records shown.`);
          }
        }
      } catch (err) {
        handleError(err, json);
      } finally {
        cleanup();
      }
    });
}
