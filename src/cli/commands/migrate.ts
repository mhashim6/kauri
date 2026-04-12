import type { Command } from 'commander';

import { currentVersion, latestVersion } from '../../store/migrations.ts';
import { isJsonMode, openContext } from '../main.ts';
import { handleError, printJson, printText } from '../output.ts';

export function registerMigrate(program: Command): void {
  program
    .command('migrate')
    .description('Apply pending schema migrations')
    .action((_opts: Record<string, unknown>, cmd: Command) => {
      const json = isJsonMode(cmd);
      const { ctx, cleanup } = openContext();
      try {
        // Migrations are applied automatically on store open — so if we
        // got here without error, the store is up to date.
        const store = ctx.projectBundle?.store ?? ctx.userBundle?.store;
        if (store === undefined) {
          printText('No store found.');
          return;
        }
        const current = currentVersion(store.db);
        const latest = latestVersion();
        if (json) {
          printJson({ currentVersion: current, latestVersion: latest, upToDate: current === latest });
        } else {
          if (current === latest) {
            printText(`Schema is up to date (version ${current}).`);
          } else {
            printText(`Migrated from version ${current} to ${latest}.`);
          }
        }
      } catch (err) {
        handleError(err, json);
      } finally {
        cleanup();
      }
    });
}
