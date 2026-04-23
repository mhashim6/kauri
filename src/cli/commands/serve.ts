/**
 * `kauri serve` — start the MCP server over stdio transport.
 *
 * The server runs until stdin closes (i.e. the parent process
 * disconnects). All MCP tools are registered and delegate to the
 * same service functions the CLI uses.
 *
 * IMPORTANT: `server.connect(transport)` resolves immediately after
 * setting up listeners — it does NOT block until disconnect. We must
 * keep the process alive and only clean up stores when the transport
 * actually closes.
 */
import type { Command } from 'commander';

import { startMcpServer } from '../../mcp/server.ts';
import { openContext } from '../main.ts';
import { handleError } from '../output.ts';

export function registerServe(program: Command): void {
  program
    .command('serve')
    .description('Start the MCP server (stdio transport)')
    .action(async (_opts: Record<string, unknown>, _cmd: Command) => {
      const { ctx, cleanup } = openContext();
      try {
        await startMcpServer(ctx);
        // server.connect() resolved — the server is now listening on
        // stdio. Keep the process alive until stdin closes. Clean up
        // stores on exit.
        process.on('exit', cleanup);
        process.on('SIGINT', () => {
          cleanup();
          process.exit(0);
        });
        process.on('SIGTERM', () => {
          cleanup();
          process.exit(0);
        });
        // Block forever — stdin EOF or a signal will terminate us.
        await new Promise(() => {});
      } catch (err) {
        cleanup();
        handleError(err, false);
      }
    });
}
