import type { Command } from 'commander';

import { checkStaleness } from '../../services/check-service.ts';
import { listTags } from '../../services/taxonomy-service.ts';
import { isJsonMode, openContext } from '../main.ts';
import { handleError, printJson, printText } from '../output.ts';
import { bundlesForRead } from '../../services/context.ts';

export function registerStatus(program: Command): void {
  program
    .command('status')
    .description('Summary: counts by status, stale count, taxonomy size')
    .option('-s, --scope <scope>', 'project, user, or both', 'both')
    .action((_opts: Record<string, unknown>, cmd: Command) => {
      const json = isJsonMode(cmd);
      const { ctx, cleanup } = openContext();
      try {
        const bundles = bundlesForRead(ctx, 'both');
        let active = 0;
        let draft = 0;
        let superseded = 0;
        let deprecated = 0;
        let pinned = 0;
        for (const b of bundles) {
          active += b.records.countByStatus('active');
          draft += b.records.countByStatus('draft');
          superseded += b.records.countByStatus('superseded');
          deprecated += b.records.countByStatus('deprecated');
          pinned += b.records.pinnedCount();
        }
        const staleResult = checkStaleness(ctx, 'both');
        const tags = listTags(ctx, 'both');

        const summary = {
          active,
          draft,
          superseded,
          deprecated,
          pinned,
          stale: staleResult.staleRecords.length,
          taxonomySize: tags.length,
        };

        if (json) {
          printJson(summary);
        } else {
          printText(`Active: ${active}  Draft: ${draft}  Superseded: ${superseded}  Deprecated: ${deprecated}`);
          printText(`Pinned: ${pinned}  Stale: ${summary.stale}  Tags: ${summary.taxonomySize}`);
        }
      } catch (err) {
        handleError(err, json);
      } finally {
        cleanup();
      }
    });
}
