import type { Command } from 'commander';

import { checkStaleness, type StaleRecord } from '../../services/check-service.ts';
import { isJsonMode, openContext, parseScopeRead } from '../main.ts';
import { handleError, printJson, printText } from '../output.ts';

export function registerCheck(program: Command): void {
  program
    .command('check')
    .description('Run staleness detection')
    .option('-s, --scope <scope>', 'project, user, or both', 'both')
    .option('-q, --quiet', 'Only print stale records')
    .option('--strict', 'Exit code 4 if any record is stale')
    .action((opts: Record<string, unknown>, cmd: Command) => {
      const json = isJsonMode(cmd);
      const { ctx, cleanup } = openContext();
      try {
        const scope = parseScopeRead(opts['scope'] as string | undefined);
        const result = checkStaleness(ctx, scope);

        if (json) {
          printJson({
            checked: result.checked,
            staleCount: result.staleRecords.length,
            staleRecords: result.staleRecords.map((sr) => ({
              id: sr.record.id,
              scope: sr.record.scope,
              tags: sr.record.tags,
              title: sr.record.title,
              reasons: sr.reasons,
            })),
          });
        } else {
          if (opts['quiet'] !== true) {
            printText(`Checked ${result.checked} active records in scope '${scope}'.`);
          }
          if (result.staleRecords.length > 0) {
            if (opts['quiet'] !== true) {
              printText(`${result.staleRecords.length} records flagged as potentially stale:\n`);
            }
            for (const sr of result.staleRecords) {
              formatStaleRecord(sr);
            }
          } else if (opts['quiet'] !== true) {
            printText('No stale records found.');
          }
        }

        if (opts['strict'] === true && result.staleRecords.length > 0) {
          process.exit(4);
        }
      } catch (err) {
        handleError(err, json);
      } finally {
        cleanup();
      }
    });
}

function formatStaleRecord(sr: StaleRecord): void {
  const tags = sr.record.tags.join(', ');
  printText(`  ${sr.record.id}  ${sr.record.scope}  [${tags}]  ${sr.record.title}`);
  for (const reason of sr.reasons) {
    if (reason.kind === 'time') {
      printText(`            TTL expired: last validated ${reason.daysSinceValidation}d ago (ttl=${reason.ttlDays}d)`);
    } else if (reason.kind === 'file_changed') {
      printText(`            ${reason.path} content changed since last validation`);
    } else if (reason.kind === 'file_missing') {
      printText(`            ${reason.path} no longer exists`);
    }
  }
  printText('');
}
