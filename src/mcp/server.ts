/**
 * Kauri MCP server — all 11 tools over stdio transport.
 *
 * Each tool maps 1:1 to a service function. The server receives a
 * ServiceContext (built by the `kauri serve` CLI command) and registers
 * tool handlers that delegate to the appropriate service.
 *
 * Tool input validation uses Zod schemas (raw shapes) passed directly
 * to `McpServer.tool()`. The SDK validates inputs before calling the
 * handler, so the handlers can trust their args.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { checkStaleness } from '../services/check-service.ts';
import type { ServiceContext } from '../services/context.ts';
import { pinRecord, unpinRecord } from '../services/pin-service.ts';
import { projectRecords } from '../services/projection-service.ts';
import {
  createRecord,
  historyOf,
  queryRecords,
  showRecord,
  updateRecord,
  validateRecord,
} from '../services/records-service.ts';
import { addTag, listTags } from '../services/taxonomy-service.ts';

/**
 * Create and start the MCP server. This function blocks until the
 * transport disconnects (the parent process closes stdin).
 */
export async function startMcpServer(ctx: ServiceContext): Promise<void> {
  const server = new McpServer({
    name: 'kauri',
    version: '0.1.2',
  });

  // --- kauri_record ---
  server.tool(
    'kauri_record',
    {
      title: z.string().describe('Record title (short)'),
      body: z.string().describe('Record body (markdown)'),
      tags: z.array(z.string()).describe('Tags from the taxonomy'),
      source: z.string().describe('Source attribution (e.g. agent:claude-code)'),
      status: z.enum(['draft', 'active']).optional().describe('Initial status'),
      files: z.array(z.string()).optional().describe('Associated file paths'),
      links: z.array(z.string()).optional().describe('IDs of related records'),
      supersedes: z.string().optional().describe('ID of record being replaced'),
      ttl_days: z.number().int().optional().describe('Override TTL in days'),
      pinned: z.boolean().optional().describe('Pin this record'),
      allow_new_tags: z.boolean().optional().describe('Auto-add unknown tags'),
      scope: z.enum(['project', 'user']).optional().describe('Target scope'),
    },
    async (args) => {
      const result = createRecord(ctx, {
        title: args.title,
        body: args.body,
        tags: args.tags,
        source: args.source,
        status: args.status,
        files: args.files,
        links: args.links,
        supersedes: args.supersedes,
        ttlDays: args.ttl_days,
        pinned: args.pinned,
        allowNewTags: args.allow_new_tags,
        scope: args.scope,
      });
      return toolResult({
        id: result.record.id,
        status: result.record.status,
        created: result.record.created,
        warnings: result.warnings,
      });
    },
  );

  // --- kauri_update ---
  server.tool(
    'kauri_update',
    {
      id: z.string().describe('Record ID'),
      source: z.string().describe('Source attribution'),
      title: z.string().optional().describe('New title'),
      body: z.string().optional().describe('New body'),
      tags: z.array(z.string()).optional().describe('Replace tags'),
      files: z.array(z.string()).optional().describe('Replace file associations'),
      links: z.array(z.string()).optional().describe('Replace linked records'),
      ttl_days: z.number().int().nullable().optional().describe('Override TTL (null to clear)'),
      pinned: z.boolean().optional().describe('Set pinned state'),
      allow_new_tags: z.boolean().optional().describe('Auto-add unknown tags'),
    },
    async (args) => {
      const result = updateRecord(ctx, {
        id: args.id,
        source: args.source,
        title: args.title,
        body: args.body,
        tags: args.tags,
        files: args.files,
        links: args.links,
        ttlDays: args.ttl_days,
        pinned: args.pinned,
        allowNewTags: args.allow_new_tags,
      });
      return toolResult({
        id: result.record.id,
        revision: result.record.revision,
        lastModified: result.record.lastModified,
        warnings: result.warnings,
      });
    },
  );

  // --- kauri_query ---
  server.tool(
    'kauri_query',
    {
      source: z.string().describe('Source attribution'),
      tags: z.array(z.string()).optional().describe('Filter by tags'),
      status: z
        .enum(['draft', 'active', 'superseded', 'deprecated', 'any'])
        .optional()
        .describe('Filter by status'),
      files: z.array(z.string()).optional().describe('Filter by associated file'),
      text: z.string().optional().describe('Full-text search query'),
      since: z.string().optional().describe('Created on or after (ISO 8601)'),
      limit: z.number().int().optional().describe('Result cap'),
      offset: z.number().int().optional().describe('Pagination offset'),
      scope: z.enum(['project', 'user', 'both']).optional().describe('Scope to query'),
    },
    async (args) => {
      const result = queryRecords(
        ctx,
        {
          tags: args.tags,
          status: args.status,
          files: args.files,
          text: args.text,
          since: args.since,
          limit: args.limit,
          offset: args.offset,
        },
        args.scope ?? 'both',
      );
      return toolResult({
        records: result.records,
        total: result.total,
        limit: args.limit ?? 100,
        offset: args.offset ?? 0,
      });
    },
  );

  // --- kauri_show ---
  server.tool(
    'kauri_show',
    {
      id: z.string().describe('Record ID'),
      source: z.string().describe('Source attribution'),
    },
    async (args) => {
      const record = showRecord(ctx, args.id);
      return toolResult({ record });
    },
  );

  // --- kauri_history ---
  server.tool(
    'kauri_history',
    {
      id: z.string().describe('Record ID'),
      source: z.string().describe('Source attribution'),
    },
    async (args) => {
      const chain = historyOf(ctx, args.id);
      return toolResult({ chain });
    },
  );

  // --- kauri_validate ---
  server.tool(
    'kauri_validate',
    {
      id: z.string().describe('Record ID'),
      verdict: z.enum(['still_valid', 'deprecate']).describe('Validation verdict'),
      source: z.string().describe('Source attribution'),
    },
    async (args) => {
      const result = validateRecord(ctx, args.id, args.verdict, args.source);
      return toolResult({
        id: result.record.id,
        status: result.record.status,
        lastValidated: result.record.lastValidated,
      });
    },
  );

  // --- kauri_project ---
  server.tool(
    'kauri_project',
    {
      source: z.string().describe('Source attribution'),
      tags: z.array(z.string()).optional().describe('Filter by tags'),
      include_drafts: z.boolean().optional().describe('Include draft records'),
      full: z.boolean().optional().describe('Include full bodies in index section'),
      format: z.enum(['text', 'json']).optional().describe('Output format'),
      scope: z.enum(['project', 'user', 'both']).optional().describe('Scope to project'),
    },
    async (args) => {
      const result = projectRecords(ctx, {
        scope: args.scope ?? 'both',
        tags: args.tags,
        includeDrafts: args.include_drafts,
        full: args.full,
        format: args.format,
      });
      if (result.json) return toolResult(result.json);
      return { content: [{ type: 'text' as const, text: result.text ?? '' }] };
    },
  );

  // --- kauri_pin ---
  server.tool(
    'kauri_pin',
    {
      id: z.string().describe('Record ID'),
      source: z.string().describe('Source attribution'),
    },
    async (args) => {
      const result = pinRecord(ctx, args.id, args.source);
      return toolResult({
        id: result.record.id,
        pinned: true,
        pinnedCount: result.pinnedCount,
        warnings: result.warnings,
      });
    },
  );

  // --- kauri_unpin ---
  server.tool(
    'kauri_unpin',
    {
      id: z.string().describe('Record ID'),
      source: z.string().describe('Source attribution'),
    },
    async (args) => {
      const result = unpinRecord(ctx, args.id, args.source);
      return toolResult({
        id: result.record.id,
        pinned: false,
        pinnedCount: result.pinnedCount,
        warnings: result.warnings,
      });
    },
  );

  // --- kauri_taxonomy_list ---
  server.tool(
    'kauri_taxonomy_list',
    {
      source: z.string().describe('Source attribution'),
      scope: z.enum(['project', 'user', 'both']).optional().describe('Scope to query'),
    },
    async (args) => {
      const tags = listTags(ctx, args.scope ?? 'both');
      return toolResult({ tags, scope: args.scope ?? 'both' });
    },
  );

  // --- kauri_taxonomy_add ---
  server.tool(
    'kauri_taxonomy_add',
    {
      tag: z.string().describe('Tag to add (lowercase, hyphenated)'),
      source: z.string().describe('Source attribution'),
      scope: z.enum(['project', 'user']).optional().describe('Target scope'),
    },
    async (args) => {
      const added = addTag(ctx, args.tag, args.scope, ctx.clock);
      return toolResult({ tag: args.tag, added, scope: args.scope ?? 'project' });
    },
  );

  // --- kauri_check ---
  server.tool(
    'kauri_check',
    {
      source: z.string().describe('Source attribution'),
      scope: z.enum(['project', 'user', 'both']).optional().describe('Scope to check'),
    },
    async (args) => {
      const result = checkStaleness(ctx, args.scope ?? 'both');
      return toolResult({
        checked: result.checked,
        staleCount: result.staleRecords.length,
        staleRecords: result.staleRecords.map((sr) => ({
          id: sr.record.id,
          title: sr.record.title,
          reasons: sr.reasons,
        })),
      });
    },
  );

  // Connect transport and block until disconnect.
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/** Wrap a result object as MCP tool content. */
function toolResult(value: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}
