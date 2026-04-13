/**
 * `kauri merge-driver` — git custom merge driver for `.kauri/store.db`.
 *
 * Git calls this as: `kauri merge-driver %O %A %B`
 *   %O = base (common ancestor)
 *   %A = ours (current branch) — merge result is written here
 *   %B = theirs (other branch)
 *
 * Exit code 0 = merge succeeded. Non-zero = merge failed (git will
 * report a conflict and the user must resolve manually).
 *
 * This command is registered in `.git/config` by `kauri init`:
 *   [merge "kauri"]
 *     name = Kauri decision store merge
 *     driver = kauri merge-driver %O %A %B
 *
 * And activated by `.gitattributes`:
 *   .kauri/store.db merge=kauri
 */
import { resolve } from 'node:path';

import type { Command } from 'commander';

import { mergeStores } from '../../services/merge-service.ts';

export function registerMergeDriver(program: Command): void {
  program
    .command('merge-driver <base> <ours> <theirs>')
    .description('Git merge driver for .kauri/store.db (called by git, not directly)')
    .action((base: string, ours: string, theirs: string) => {
      try {
        const result = mergeStores(resolve(base), resolve(ours), resolve(theirs));
        // Log to stderr (git captures stdout for some drivers).
        if (result.insertedFromTheirs > 0 || result.updatedFromTheirs > 0) {
          console.error(
            `kauri merge-driver: merged ${result.insertedFromTheirs} new + ${result.updatedFromTheirs} updated records from theirs, ${result.taxonomyAdded} new tags`,
          );
        }
        for (const rename of result.renamedIds) {
          console.error(
            `kauri merge-driver: ID collision — renamed ${rename.originalId} → ${rename.newId}`,
          );
        }
        // Exit 0 = merge succeeded.
        process.exit(0);
      } catch (err) {
        console.error('kauri merge-driver: merge failed:');
        console.error(err);
        process.exit(1);
      }
    });
}
