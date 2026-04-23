import type { Command } from 'commander';

import { createRecord } from '../../services/records-service.ts';
import { resolveBody } from '../body-input.ts';
import { getSource, isJsonMode, openContext, parseScopeWrite } from '../main.ts';
import { handleError, printJson, printText } from '../output.ts';

export function registerRecord(program: Command): void {
  program
    .command('record')
    .description('Create a new decision record')
    .requiredOption('-t, --title <title>', 'Record title (short)')
    .option('-b, --body <body>', 'Record body (use "-" for stdin)')
    .option('-f, --body-file <path>', 'Read body from file')
    .option('-T, --tag <tag...>', 'Tags (repeatable)')
    .option('-F, --file <path...>', 'Associated file paths (repeatable)')
    .option('-L, --link <id...>', 'IDs of related records (repeatable)')
    .option('-S, --status <status>', 'draft or active', 'active')
    .option('-X, --supersedes <id>', 'ID of record being replaced')
    .option('--ttl <days>', 'Override ttl_days')
    .option('--pin', 'Pin this record')
    .option('--allow-new-tags', 'Auto-add unknown tags')
    .option('-s, --scope <scope>', 'project or user')
    .action(async (opts: Record<string, unknown>, cmd: Command) => {
      const json = isJsonMode(cmd);
      const { ctx, cleanup } = openContext();
      try {
        const body = await resolveBody({
          body: opts['body'] as string | undefined,
          bodyFile: opts['bodyFile'] as string | undefined,
        });
        const result = createRecord(ctx, {
          title: opts['title'] as string,
          body,
          tags: (opts['tag'] as string[] | undefined) ?? [],
          source: getSource(cmd),
          status: (opts['status'] as 'draft' | 'active') ?? 'active',
          files: opts['file'] as string[] | undefined,
          links: opts['link'] as string[] | undefined,
          supersedes: opts['supersedes'] as string | undefined,
          ttlDays: opts['ttl'] !== undefined ? Number(opts['ttl']) : undefined,
          pinned: opts['pin'] === true,
          allowNewTags: opts['allowNewTags'] === true,
          scope: parseScopeWrite(opts['scope'] as string | undefined),
        });
        if (json) {
          printJson({ id: result.record.id, status: result.record.status, created: result.record.created, warnings: result.warnings });
        } else {
          printText(`Created ${result.record.id} (${result.record.status})`);
          for (const w of result.warnings) {
            printText(`  warning: ${w.message}`);
          }
        }
      } catch (err) {
        handleError(err, json);
      } finally {
        cleanup();
      }
    });
}
