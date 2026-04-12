import type { Command } from 'commander';

import { showRecord } from '../../services/records-service.ts';
import { isJsonMode, openContext } from '../main.ts';
import { handleError, printJson, printText } from '../output.ts';

export function registerShow(program: Command): void {
  program
    .command('show <id>')
    .description('Show a single record')
    .action((id: string, _opts: Record<string, unknown>, cmd: Command) => {
      const json = isJsonMode(cmd);
      const { ctx, cleanup } = openContext();
      try {
        const record = showRecord(ctx, id);
        if (json) {
          printJson({ record });
        } else {
          printText(`### [${record.id}] ${record.scope} | ${record.tags.join(', ')} | ${record.title}`);
          printText(record.body);
          if (record.files.length > 0) {
            printText(`Files: ${record.files.map((f) => f.path).join(', ')}`);
          }
          printText(`Status: ${record.status} | Revision: ${record.revision}`);
          printText(`Recorded: ${record.created.slice(0, 10)} · Last validated: ${record.lastValidated.slice(0, 10)}`);
          if (record.supersedes) printText(`Supersedes: ${record.supersedes}`);
          if (record.supersededBy) printText(`Superseded by: ${record.supersededBy}`);
        }
      } catch (err) {
        handleError(err, json);
      } finally {
        cleanup();
      }
    });
}
