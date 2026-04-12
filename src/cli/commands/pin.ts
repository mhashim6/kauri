import type { Command } from 'commander';

import { pinRecord, unpinRecord } from '../../services/pin-service.ts';
import { getSource, isJsonMode, openContext } from '../main.ts';
import { handleError, printJson, printText } from '../output.ts';

export function registerPin(program: Command): void {
  program
    .command('pin <id>')
    .description('Pin a record (include body in projection)')
    .action((id: string, _opts: Record<string, unknown>, cmd: Command) => {
      const json = isJsonMode(cmd);
      const { ctx, cleanup } = openContext();
      try {
        const result = pinRecord(ctx, id, getSource(cmd));
        if (json) {
          printJson({ id: result.record.id, pinned: true, pinnedCount: result.pinnedCount, warnings: result.warnings });
        } else {
          printText(`Pinned ${result.record.id} (${result.pinnedCount} total pinned)`);
          for (const w of result.warnings) printText(`  warning: ${w.message}`);
        }
      } catch (err) {
        handleError(err, json);
      } finally {
        cleanup();
      }
    });
}

export function registerUnpin(program: Command): void {
  program
    .command('unpin <id>')
    .description('Unpin a record')
    .action((id: string, _opts: Record<string, unknown>, cmd: Command) => {
      const json = isJsonMode(cmd);
      const { ctx, cleanup } = openContext();
      try {
        const result = unpinRecord(ctx, id, getSource(cmd));
        if (json) {
          printJson({ id: result.record.id, pinned: false, pinnedCount: result.pinnedCount, warnings: result.warnings });
        } else {
          printText(`Unpinned ${result.record.id} (${result.pinnedCount} total pinned)`);
        }
      } catch (err) {
        handleError(err, json);
      } finally {
        cleanup();
      }
    });
}
