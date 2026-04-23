import type { Command } from 'commander';

import { addTag, listTags } from '../../services/taxonomy-service.ts';
import { isJsonMode, openContext, parseScopeRead, parseScopeWrite } from '../main.ts';
import { handleError, printJson, printText } from '../output.ts';

export function registerTaxonomy(program: Command): void {
  const tax = program.command('taxonomy').description('List or manage the tag taxonomy');

  // Default action (no subcommand) = list.
  tax
    .option('-s, --scope <scope>', 'project, user, or both', 'both')
    .action((opts: Record<string, unknown>, cmd: Command) => {
      const json = isJsonMode(cmd);
      const { ctx, cleanup } = openContext();
      try {
        const tags = listTags(ctx, parseScopeRead(opts['scope'] as string | undefined));
        if (json) {
          printJson({ tags });
        } else {
          if (tags.length === 0) {
            printText('No tags in taxonomy.');
          } else {
            for (const tag of tags) printText(`  ${tag}`);
          }
        }
      } catch (err) {
        handleError(err, json);
      } finally {
        cleanup();
      }
    });

  // taxonomy add <tag>
  tax
    .command('add <tag>')
    .description('Add a tag to the taxonomy')
    .option('-s, --scope <scope>', 'project or user')
    .action((tag: string, opts: Record<string, unknown>, cmd: Command) => {
      const json = isJsonMode(cmd);
      const { ctx, cleanup } = openContext();
      try {
        const added = addTag(
          ctx,
          tag,
          parseScopeWrite(opts['scope'] as string | undefined),
          ctx.clock,
        );
        if (json) {
          printJson({ tag, added });
        } else {
          printText(added ? `Added '${tag}' to taxonomy.` : `'${tag}' already exists.`);
        }
      } catch (err) {
        handleError(err, json);
      } finally {
        cleanup();
      }
    });
}
