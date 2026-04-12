import type { Command } from 'commander';

import type { Verdict } from '../../core/types.ts';
import { KauriError } from '../../core/errors.ts';
import { validateRecord } from '../../services/records-service.ts';
import { getSource, isJsonMode, openContext } from '../main.ts';
import { handleError, printJson, printText } from '../output.ts';

export function registerValidate(program: Command): void {
  program
    .command('validate <id> <verdict>')
    .description('Confirm (still_valid) or deprecate a record')
    .action((id: string, verdictStr: string, _opts: Record<string, unknown>, cmd: Command) => {
      const json = isJsonMode(cmd);
      const { ctx, cleanup } = openContext();
      try {
        if (verdictStr !== 'still_valid' && verdictStr !== 'deprecate') {
          throw new KauriError('usage', `verdict must be 'still_valid' or 'deprecate', got '${verdictStr}'`);
        }
        const verdict: Verdict = verdictStr;
        const result = validateRecord(ctx, id, verdict, getSource(cmd));
        if (json) {
          printJson({ id: result.record.id, status: result.record.status, lastValidated: result.record.lastValidated });
        } else {
          printText(`${result.record.id}: ${result.record.status} (validated ${result.record.lastValidated.slice(0, 10)})`);
        }
      } catch (err) {
        handleError(err, json);
      } finally {
        cleanup();
      }
    });
}
