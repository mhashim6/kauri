# Kauri Plugin for Claude Code

Integrates [Kauri](../../README.md) with Claude Code so that project decisions
are visible in every coding session and the agent can record, query, and
validate decisions as first-class MCP tools.

## What it does

| Feature                   | How                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Decisions in context**  | Session-start hook injects the Kauri projection (pinned + index) into Claude's context automatically |
| **MCP tools**             | Claude sees `kauri_record`, `kauri_query`, `kauri_show`, etc. alongside Bash/Read/Edit               |
| **Skills**                | `/kauri:record-decision` and `/kauri:check-staleness` teach Claude when and how to use Kauri         |
| **Post-commit staleness** | After `git commit`, a hook checks for stale decisions and alerts Claude                              |

## Prerequisites

- [Claude Code](https://claude.ai/code) installed
- `kauri` binary in PATH (`brew install kauri` or download from [Releases](https://github.com/mhashim6/kauri/releases))
- A Kauri store initialised in your project (`kauri init`)

## Installation

### From npm

```bash
# Project-level (recommended — shared with team)
claude plugin install kauri-claude-code --scope project

# User-level (all your projects)
claude plugin install kauri-claude-code --scope user
```

### MCP server only (any MCP client)

If you only need the 12 MCP tools without hooks and skills:

```bash
# Claude Code
claude mcp add kauri -- kauri serve
```

For other MCP clients (Cursor, Windsurf, Claude Desktop), add to your config:

```json
{
  "mcpServers": {
    "kauri": { "command": "kauri", "args": ["serve"] }
  }
}
```

### From local source (for development)

```bash
claude --plugin-dir ./plugins/claude-code
```

Or reload during a session:

```
/reload-plugins
```

## What gets registered

### MCP Server

The plugin registers `kauri serve` as an MCP server. Claude Code starts it
automatically and exposes all 12 Kauri tools:

`kauri_record` `kauri_update` `kauri_query` `kauri_show` `kauri_history`
`kauri_validate` `kauri_project` `kauri_pin` `kauri_unpin`
`kauri_taxonomy_list` `kauri_taxonomy_add` `kauri_check`

### Hooks

| Event                    | Trigger              | Action                                                |
| ------------------------ | -------------------- | ----------------------------------------------------- |
| `SessionStart` (startup) | New session begins   | Injects decision projection into context              |
| `SessionStart` (compact) | Context is compacted | Re-injects projection so decisions survive compaction |
| `PostToolUse` (Bash)     | After a `git commit` | Runs staleness check, alerts if records are stale     |

### Skills

| Skill           | Invocation                       | Purpose                                      |
| --------------- | -------------------------------- | -------------------------------------------- |
| record-decision | `/kauri:record-decision [title]` | Guided workflow for recording a new decision |
| check-staleness | `/kauri:check-staleness`         | Review and resolve stale decisions           |

## Troubleshooting

**"kauri: command not found"** — The `kauri` binary isn't in PATH. Either:

- Run `bun run build` in the Kauri repo and add `dist/` to your PATH
- Or use `bun run /path/to/kauri/src/cli.ts` and update `.mcp.json` accordingly

**No decisions showing at session start** — Make sure you've run `kauri init`
in your project directory and have at least one recorded decision.

**MCP tools not appearing** — Check that the plugin is loaded:

```
/reload-plugins
```

Then verify with `/kauri:check-staleness` — if the skill loads, the plugin is active.
