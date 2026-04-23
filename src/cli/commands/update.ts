import type { Command } from 'commander';

import { updateRecord } from '../../services/records-service.ts';
import { resolveBody } from '../body-input.ts';
import { getSource, isJsonMode, openContext } from '../main.ts';
import { handleError, printJson, printText } from '../output.ts';

export function registerUpdate(program: Command): void {
  program
    .command('update <id>')
    .description("Edit a record's mutable fields")
    .option('-t, --title <title>', 'New title')
    .option('-b, --body <body>', 'New body (use "-" for stdin)')
    .option('-f, --body-file <path>', 'Read body from file')
    .option('-T, --tag <tag...>', 'Replace tags (repeatable)')
    .option('-F, --file <path...>', 'Replace file associations (repeatable)')
    .option('-L, --link <id...>', 'Replace linked records (repeatable)')
    .option('--ttl <days>', 'Override ttl_days (use "" to clear)')
    .option('--pin', 'Pin this record')
    .option('--no-pin', 'Unpin this record')
    .option('--allow-new-tags', 'Auto-add unknown tags')
    .action(async (id: string, opts: Record<string, unknown>, cmd: Command) => {
      const json = isJsonMode(cmd);
      const { ctx, cleanup } = openContext();
      try {
        // Only resolve body if --body or --body-file was given.
        let body: string | undefined;
        if (opts['body'] !== undefined || opts['bodyFile'] !== undefined) {
          body = await resolveBody({
            body: opts['body'] as string | undefined,
            bodyFile: opts['bodyFile'] as string | undefined,
          });
        }
        const ttlRaw = opts['ttl'] as string | undefined;
        const ttlDays = ttlRaw === '' ? null : ttlRaw !== undefined ? Number(ttlRaw) : undefined;
        const pinned = opts['pin'] === true ? true : opts['pin'] === false ? false : undefined;

        const result = updateRecord(ctx, {
          id,
          source: getSource(cmd),
          title: opts['title'] as string | undefined,
          body,
          tags: opts['tag'] as string[] | undefined,
          files: opts['file'] as string[] | undefined,
          links: opts['link'] as string[] | undefined,
          ttlDays,
          pinned,
          allowNewTags: opts['allowNewTags'] === true,
        });
        if (json) {
          printJson({
            id: result.record.id,
            revision: result.record.revision,
            lastModified: result.record.lastModified,
            warnings: result.warnings,
          });
        } else {
          printText(`Updated ${result.record.id} (revision ${result.record.revision})`);
          for (const w of result.warnings) printText(`  warning: ${w.message}`);
        }
      } catch (err) {
        handleError(err, json);
      } finally {
        cleanup();
      }
    });
}
