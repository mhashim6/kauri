/**
 * Projection rendering — text and JSON.
 *
 * The projection is the core delivery vehicle for Kauri: it's what
 * `kauri project` (and the matching MCP tool) emits, and what session-start
 * hooks inject into the agent's context. v0.1 uses an **index-mode** layout
 * by default — pinned records render their full body, everything else
 * renders as a one-line index entry the agent can later expand via
 * `kauri_show` or `kauri_query`. See `kauri-spec.md` § kauri_project for
 * the full output example this module is contracted to match.
 *
 * These functions are deliberately pure. The projection-service in
 * `src/services/` does the data assembly (which records to include, the
 * staleness scan, the scope merge); this module just turns the assembled
 * input into bytes.
 *
 * Per the module-boundary rules, this file imports only from `core/`.
 */
import type { KauriRecord } from './types.ts';

/** Counts displayed in the projection title. */
export interface ProjectionCounts {
  /** Total number of active records being projected. Includes pinned. */
  readonly active: number;
  /** Number of pinned records (subset of `active`). */
  readonly pinned: number;
  /** Number of drafts. Only meaningful when `includeDrafts` is true. */
  readonly drafts: number;
}

/**
 * Everything the renderer needs. The service layer is responsible for
 * computing each field — selecting records, partitioning pinned vs
 * indexed, running the staleness check.
 */
export interface ProjectionInput {
  /**
   * Display label for the title. Typically the project slug for a
   * project-only projection (`'kauri'`), the literal `'usr'` for a
   * user-only projection, or `'both'` for a merged read.
   */
  readonly slugLabel: string;
  readonly counts: ProjectionCounts;
  /** Records that get full-body treatment in the output. */
  readonly pinned: readonly KauriRecord[];
  /** Records that get one-line index treatment unless `full` is true. */
  readonly indexed: readonly KauriRecord[];
  /** Set of record IDs flagged as stale. Lookups are O(1). */
  readonly staleIds: ReadonlySet<string>;
  /** When true, the indexed section also renders bodies. */
  readonly full: boolean;
  /** When true, drafts are included and the title shows a drafts count. */
  readonly includeDrafts: boolean;
}

// ---------------------------------------------------------------------------
// Text rendering
// ---------------------------------------------------------------------------

/**
 * Render a `ProjectionInput` to a markdown string. The output is stable
 * across runs (no timestamps in the layout itself; only the per-record
 * `Recorded` and `Last validated` lines, which come from record data).
 *
 * Always ends with exactly one trailing newline.
 */
export function renderText(input: ProjectionInput): string {
  return buildTextBlocks(input).join('\n\n') + '\n';
}

/**
 * Logical "blocks" joined by blank lines in the final output. This is
 * the structure that lets us produce the spec's exact spacing without
 * tracking newlines manually inside per-record renderers.
 */
function buildTextBlocks(input: ProjectionInput): string[] {
  const blocks: string[] = [renderTitle(input)];

  if (input.pinned.length === 0 && input.indexed.length === 0) {
    blocks.push('_No records to display._');
    return blocks;
  }

  if (input.pinned.length > 0) {
    blocks.push('## Pinned');
    for (const rec of input.pinned) {
      blocks.push(renderFullRecord(rec, input.staleIds.has(rec.id)));
    }
  }

  if (input.indexed.length > 0) {
    blocks.push(renderIndexHeader(input));
    if (input.full) {
      for (const rec of input.indexed) {
        blocks.push(renderFullRecord(rec, input.staleIds.has(rec.id)));
      }
    } else {
      // Index entries collapse into a single block so the bullet list
      // renders contiguously without blank lines between items.
      const lines = input.indexed.map((rec) =>
        renderIndexEntry(rec, input.staleIds.has(rec.id)),
      );
      blocks.push(lines.join('\n'));
    }
  }

  return blocks;
}

function renderTitle(input: ProjectionInput): string {
  const parts = [`${input.counts.active} active`, `${input.counts.pinned} pinned`];
  if (input.includeDrafts && input.counts.drafts > 0) {
    parts.push(`${input.counts.drafts} drafts`);
  }
  return `# Kauri Records — ${input.slugLabel} (${parts.join(', ')})`;
}

function renderIndexHeader(input: ProjectionInput): string {
  const label =
    input.pinned.length > 0
      ? `${input.indexed.length} more`
      : `${input.indexed.length} records`;
  return `## Index (${label} — use \`kauri_show\` or \`kauri_query\` to fetch)`;
}

/**
 * Pinned-section / `--full` mode: header + body + (optional) files line +
 * dates line. The order matches the spec example exactly.
 */
function renderFullRecord(rec: KauriRecord, stale: boolean): string {
  const lines: string[] = [];
  const tags = rec.tags.join(', ');
  const markers = buildMarkers(rec, stale);
  lines.push(`### [${rec.id}] ${rec.scope} | ${tags} | ${rec.title}${markers}`);
  lines.push(rec.body);
  if (rec.files.length > 0) {
    const filePaths = rec.files.map((f) => f.path).join(', ');
    lines.push(`Files: ${filePaths}`);
  }
  const created = rec.created.slice(0, 10);
  const validated = rec.lastValidated.slice(0, 10);
  lines.push(`Recorded: ${created} · Last validated: ${validated}`);
  return lines.join('\n');
}

/** Index-mode one-liner. Uses a leading `- ` so it renders as a bullet item. */
function renderIndexEntry(rec: KauriRecord, stale: boolean): string {
  const tags = rec.tags.join(', ');
  const markers = buildMarkers(rec, stale);
  return `- [${rec.id}] ${rec.scope} | ${tags} | ${rec.title}${markers}`;
}

/** Build the trailing `[DRAFT]` / `[STALE]` markers for a record's title line. */
function buildMarkers(rec: KauriRecord, stale: boolean): string {
  const parts: string[] = [];
  if (rec.status === 'draft') {
    parts.push('[DRAFT]');
  }
  if (stale) {
    parts.push('[STALE]');
  }
  return parts.length === 0 ? '' : ' ' + parts.join(' ');
}

// ---------------------------------------------------------------------------
// JSON rendering
// ---------------------------------------------------------------------------

/**
 * Minimal index-entry shape returned in JSON output for non-pinned,
 * non-`full` records. Contains everything an agent needs to decide
 * "is this worth fetching?".
 */
export interface IndexEntryJson {
  readonly id: string;
  readonly kind: string;
  readonly scope: string;
  readonly status: string;
  readonly title: string;
  readonly tags: readonly string[];
  readonly stale: boolean;
}

/** Full record shape returned for pinned records (and all records in `full` mode). */
export interface FullEntryJson extends IndexEntryJson {
  readonly body: string;
  readonly files: readonly string[];
  readonly created: string;
  readonly lastValidated: string;
}

export interface ProjectionJson {
  readonly slugLabel: string;
  readonly counts: ProjectionCounts;
  readonly pinned: readonly FullEntryJson[];
  readonly indexed: readonly (IndexEntryJson | FullEntryJson)[];
  readonly full: boolean;
  readonly includeDrafts: boolean;
}

/**
 * Render a `ProjectionInput` to a structured JSON-ready object. Pinned
 * records always include their full body; indexed records include the
 * full body only when `full` is true.
 */
export function renderJson(input: ProjectionInput): ProjectionJson {
  const pinned = input.pinned.map((r) => toFullJson(r, input.staleIds.has(r.id)));
  const indexed = input.indexed.map((r) =>
    input.full
      ? toFullJson(r, input.staleIds.has(r.id))
      : toIndexJson(r, input.staleIds.has(r.id)),
  );
  return {
    slugLabel: input.slugLabel,
    counts: input.counts,
    pinned,
    indexed,
    full: input.full,
    includeDrafts: input.includeDrafts,
  };
}

function toIndexJson(rec: KauriRecord, stale: boolean): IndexEntryJson {
  return {
    id: rec.id,
    kind: rec.kind,
    scope: rec.scope,
    status: rec.status,
    title: rec.title,
    tags: rec.tags,
    stale,
  };
}

function toFullJson(rec: KauriRecord, stale: boolean): FullEntryJson {
  return {
    ...toIndexJson(rec, stale),
    body: rec.body,
    files: rec.files.map((f) => f.path),
    created: rec.created,
    lastValidated: rec.lastValidated,
  };
}
