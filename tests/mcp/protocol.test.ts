/**
 * Layer-4 MCP protocol tests — spawn `kauri serve` and exercise
 * the tools via JSON-RPC over stdio.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BIN, runOk } from '../helpers/bin.ts';
import { McpTestClient } from '../helpers/mcp-client.ts';

let dir: string;
let client: McpTestClient;

const skip = !existsSync(BIN);

beforeEach(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'kauri-mcp-test-'));
  Bun.spawnSync(['git', 'init', '-q'], { cwd: dir });
  Bun.spawnSync(['git', 'commit', '--allow-empty', '-m', 'init', '-q'], { cwd: dir });
  await runOk(['init', '--slug', 'mcptest'], { cwd: dir });
  client = await McpTestClient.start(dir);
});

afterEach(async () => {
  if (skip) return;
  await client?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('MCP tool discovery', () => {
  test.skipIf(skip)('tools/list returns all expected tools', async () => {
    const tools = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'kauri_check',
      'kauri_history',
      'kauri_pin',
      'kauri_project',
      'kauri_query',
      'kauri_record',
      'kauri_show',
      'kauri_taxonomy_add',
      'kauri_taxonomy_list',
      'kauri_unpin',
      'kauri_update',
      'kauri_validate',
    ]);
  });
});

describe('MCP tool round-trips', () => {
  test.skipIf(skip)('kauri_taxonomy_list returns default tags', async () => {
    const result = (await client.callTool('kauri_taxonomy_list', {
      source: 'agent:test',
    })) as { tags: string[] };
    expect(result.tags).toContain('api');
    expect(result.tags).toContain('architecture');
    expect(result.tags.length).toBe(10);
  });

  test.skipIf(skip)('kauri_record + kauri_query round trip', async () => {
    const created = (await client.callTool('kauri_record', {
      title: 'MCP test decision',
      body: 'Created via MCP protocol test',
      tags: ['api'],
      source: 'agent:test',
    })) as { id: string; status: string };

    expect(created.id).toBe('mcptest-DEC-0001');
    expect(created.status).toBe('active');

    const queried = (await client.callTool('kauri_query', {
      source: 'agent:test',
    })) as { records: Array<{ id: string; title: string }>; total: number };

    expect(queried.total).toBe(1);
    expect(queried.records[0]?.title).toBe('MCP test decision');
  });

  test.skipIf(skip)('kauri_show returns full record', async () => {
    await client.callTool('kauri_record', {
      title: 'Show test',
      body: 'Full body here',
      tags: ['testing'],
      source: 'agent:test',
    });

    const shown = (await client.callTool('kauri_show', {
      id: 'mcptest-DEC-0001',
      source: 'agent:test',
    })) as { record: { id: string; body: string } };

    expect(shown.record.id).toBe('mcptest-DEC-0001');
    expect(shown.record.body).toBe('Full body here');
  });

  test.skipIf(skip)('kauri_validate changes status', async () => {
    await client.callTool('kauri_record', {
      title: 'To deprecate',
      body: 'body',
      tags: ['api'],
      source: 'agent:test',
    });

    const result = (await client.callTool('kauri_validate', {
      id: 'mcptest-DEC-0001',
      verdict: 'deprecate',
      source: 'agent:test',
    })) as { status: string };

    expect(result.status).toBe('deprecated');
  });

  test.skipIf(skip)('kauri_project returns text projection', async () => {
    await client.callTool('kauri_record', {
      title: 'Projected decision',
      body: 'body',
      tags: ['architecture'],
      source: 'agent:test',
      pinned: true,
    });

    const result = await client.request('tools/call', {
      name: 'kauri_project',
      arguments: { source: 'agent:test' },
    }) as { content: Array<{ type: string; text: string }> };

    const text = result.content[0]?.text ?? '';
    expect(text).toContain('Kauri Records');
    expect(text).toContain('Projected decision');
  });

  test.skipIf(skip)('kauri_check runs without error', async () => {
    await client.callTool('kauri_record', {
      title: 'Fresh',
      body: 'body',
      tags: ['api'],
      source: 'agent:test',
    });

    const result = (await client.callTool('kauri_check', {
      source: 'agent:test',
    })) as { checked: number; staleCount: number };

    expect(result.checked).toBeGreaterThan(0);
    expect(result.staleCount).toBe(0);
  });
});
