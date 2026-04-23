/**
 * Minimal JSON-RPC client for Layer-4 (MCP protocol) tests.
 *
 * Spawns `kauri serve` and communicates via newline-delimited JSON
 * over stdio. Uses Bun's subprocess API (FileSink for stdin,
 * ReadableStream for stdout).
 */
import { BIN } from './bin.ts';

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class McpTestClient {
  private proc: ReturnType<typeof Bun.spawn>;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: JsonRpcResponse) => void; reject: (e: Error) => void }
  >();

  private constructor(proc: ReturnType<typeof Bun.spawn>) {
    this.proc = proc;
    this.startReading();
  }

  static async start(cwd: string): Promise<McpTestClient> {
    const proc = Bun.spawn([BIN, 'serve'], {
      cwd,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'ignore',
    });
    const client = new McpTestClient(proc);

    // Initialize the MCP session.
    await client.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'kauri-test', version: '1.0' },
    });
    // Send initialized notification.
    client.notify('notifications/initialized', {});
    await Bun.sleep(100);

    return client;
  }

  async request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    // Bun's stdin with 'pipe' is a FileSink.
    const stdin = this.proc.stdin as unknown as {
      write(data: string | Uint8Array): number;
      flush(): void;
    };
    stdin.write(msg);
    stdin.flush();

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request ${method} (id=${id}) timed out`));
      }, 5000);
      this.pending.set(id, {
        resolve: (resp) => {
          clearTimeout(timer);
          if (resp.error) {
            reject(new Error(`MCP error: ${JSON.stringify(resp.error)}`));
          } else {
            resolve(resp.result);
          }
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
    });
  }

  notify(method: string, params: unknown): void {
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
    const stdin = this.proc.stdin as unknown as {
      write(data: string | Uint8Array): number;
      flush(): void;
    };
    stdin.write(msg);
    stdin.flush();
  }

  async listTools(): Promise<Array<{ name: string }>> {
    const result = (await this.request('tools/list', {})) as { tools: Array<{ name: string }> };
    return result.tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = (await this.request('tools/call', { name, arguments: args })) as {
      content: Array<{ type: string; text: string }>;
    };
    const text = result.content?.[0]?.text;
    return text ? JSON.parse(text) : result;
  }

  async close(): Promise<void> {
    try {
      const stdin = this.proc.stdin as unknown as { end(): void };
      stdin.end();
    } catch {
      // Already closed.
    }
    this.proc.kill();
    await this.proc.exited;
  }

  private startReading(): void {
    const stdout = this.proc.stdout as ReadableStream<Uint8Array>;
    if (!stdout) return;
    const reader = new Response(stdout).body?.getReader();
    if (!reader) return;

    let buffer = '';
    const processChunk = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += new TextDecoder().decode(value);
          let newlineIdx: number;
          while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newlineIdx).trim();
            buffer = buffer.slice(newlineIdx + 1);
            if (line.length === 0) continue;
            try {
              const msg = JSON.parse(line) as JsonRpcResponse;
              if (msg.id !== undefined && this.pending.has(msg.id)) {
                const handler = this.pending.get(msg.id)!;
                this.pending.delete(msg.id);
                handler.resolve(msg);
              }
            } catch {
              // Not valid JSON.
            }
          }
        }
      } catch {
        // Stream closed.
      }
    };
    processChunk();
  }
}
