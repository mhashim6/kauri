import type { Command } from 'commander';

import { historyOf } from '../../services/records-service.ts';
import { isJsonMode, openContext } from '../main.ts';
import { handleError, printJson, printText } from '../output.ts';

export function registerHistory(program: Command): void {
  program
    .command('history <id>')
    .description('Walk the supersession chain of a record')
    .action((id: string, _opts: Record<string, unknown>, cmd: Command) => {
      const json = isJsonMode(cmd);
      const { ctx, cleanup } = openContext();
      try {
        const chain = historyOf(ctx, id);
        if (json) {
          printJson({ chain });
        } else {
          for (const r of chain) {
            const marker = r.id === id ? ' ← (you are here)' : '';
            printText(`[${r.id}] ${r.status} | ${r.title}${marker}`);
          }
        }
      } catch (err) {
        handleError(err, json);
      } finally {
        cleanup();
      }
    });
}
