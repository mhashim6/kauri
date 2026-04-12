import type { Command } from 'commander';

import { handleError } from '../output.ts';

export function registerServe(program: Command): void {
  program
    .command('serve')
    .description('Start the MCP server (stdio transport)')
    .action((_opts: Record<string, unknown>, _cmd: Command) => {
      try {
        // MCP server implementation is Phase D Step 14.
        // For now, print a placeholder message.
        console.error('kauri serve: MCP server not yet implemented. Coming in Phase D Step 14.');
        process.exit(1);
      } catch (err) {
        handleError(err, false);
      }
    });
}
