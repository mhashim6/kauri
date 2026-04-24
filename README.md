<p align="center">
  <img src="logo.svg" alt="Kauri" width="200" />
</p>

# Kauri

LLM agents are powerful but forgetful. They don't remember what your team decided last month, why you chose Postgres over DynamoDB, or that the auth module has a constraint nobody documented. Every session starts from zero.

Kauri gives agents a decision memory. It's a local-first database that tracks your project's architectural choices, conventions, and constraints — committed with your repo, versioned with git, and injected into agent context at every session start.

Decisions get a lifecycle: they're recorded, tagged, associated with files, and automatically flagged when the code they describe has changed. The agent sees them. The agent respects them. The agent can propose new ones for your approval.

## How agents use it

With the Claude Code plugin, Kauri is part of every session:

- **Session start**: the agent sees all your decisions — pinned ones in full, everything else as a scannable index
- **Before planning**: the agent consults relevant decisions before making architectural choices (`/kauri:consult`)
- **After deciding**: the agent drafts a decision record for your approval, not auto-records (`/kauri:propose`)
- **After implementing**: the agent reviews changes against existing decisions (`/kauri:review`)
- **After committing**: a hook checks if any decisions went stale and alerts the agent

12 MCP tools give the agent native access: `kauri_record`, `kauri_query`, `kauri_show`, `kauri_validate`, `kauri_project`, and more. No Bash wrapping, no prompt hacking — structured tool calls with validated schemas.

```bash
# Use with Claude Code
/plugin marketplace add mhashim6/kauri
/plugin install kauri@kauri
```

Works with any MCP-compatible agent (Cursor, Windsurf, etc.) via `kauri serve`.

## The human is always in the loop

Kauri is designed around human judgment, not automation:

- **Decisions require rationale.** A record isn't a log entry — it's a deliberate choice with a "why."
- **Recording goes through a proposal.** The agent drafts, you approve. The `/kauri:propose` skill prevents low-quality records from accumulating.
- **Staleness is a prompt, not an action.** When code changes under a decision, Kauri flags it. A human (or agent, with your approval) decides whether the decision is still valid, needs updating, or should be retired.
- **The database is committed with your repo.** Decisions are visible to every team member, reviewable in PRs, and preserved in git history.

## Installation

### Homebrew (macOS and Linux)

```bash
brew tap mhashim6/kauri
brew install kauri
```

### GitHub Releases

Download the binary for your platform from [Releases](https://github.com/mhashim6/kauri/releases) and add it to your PATH.

Available binaries: `kauri-darwin-arm64`, `kauri-darwin-x64`, `kauri-linux-x64`, `kauri-windows-x64.exe`

### Build from source

```bash
git clone https://github.com/mhashim6/kauri && cd kauri
bun install && bun run build
# Binary at dist/kauri — add to your PATH
```

### Claude Code plugin

```bash
/plugin marketplace add mhashim6/kauri
/plugin install kauri@kauri
```

Or add the MCP server directly (works with any MCP client):

```bash
claude mcp add kauri -- kauri serve
```

For other MCP clients (Cursor, Windsurf, Claude Desktop), add to your MCP config:

```json
{
  "mcpServers": {
    "kauri": { "command": "kauri", "args": ["serve"] }
  }
}
```

## Quick start

```bash
kauri init
kauri record -t "Use JWT with refresh tokens" \
  -b "15-minute access tokens, 7-day refresh. Chose over session cookies for stateless scaling." \
  -T api -T security -F src/auth/handler.ts
kauri project   # see the projection agents receive
kauri check     # run staleness detection
```

## Git integration

The `.kauri/store.db` is committed with your repo — this is intentional. Decisions travel with the code, visible in PRs, available on every clone, and shared across the team without a separate sync mechanism.

SQLite is binary, so normal git diff/merge can't handle it. Kauri ships a custom three-way merge driver that resolves conflicts automatically:

- **New records on both branches**: both are kept
- **Same record edited on both branches**: last-writer-wins by timestamp
- **ID collisions** (same counter used independently): the incoming record is re-numbered
- **Taxonomy**: union of both sides

The merge driver is registered in `.git/config` and activated via `.gitattributes`. WAL and SHM runtime files are gitignored — `Store.close()` checkpoints all data into the main `.db` file before git ever sees it.

```bash
# Auto-configured by kauri init. For existing repos:
kauri setup-git
```

We evaluated committing a `.sql` text dump instead of the binary for readable diffs, but rejected it — Kauri's own tooling (`kauri history`, `kauri show`, `kauri query`) surfaces changes better than raw SQL in `git log`, and the binary approach has zero overhead with a single source of truth. See `kauri-DEC-0016` for the full rationale.

## CLI reference

| Command                                 | What it does                                                          |
| --------------------------------------- | --------------------------------------------------------------------- |
| `kauri init`                            | Create a store in the current directory                               |
| `kauri record -t "..." -b "..." -T tag` | Record a decision (`-F` files, `-L` links, `--supersedes`)            |
| `kauri update <id>`                     | Edit a record's mutable fields (`-t`, `-b`, `-T`, `-F`, `-L`)         |
| `kauri query [--text "..."]`            | Search decisions (filter by `--tag`, `--file`, `--status`, `--since`) |
| `kauri show <id>`                       | View a decision in full                                               |
| `kauri history <id>`                    | Walk the supersession chain                                           |
| `kauri validate <id> still_valid`       | Confirm a decision is current                                         |
| `kauri validate <id> deprecate`         | Retire a decision                                                     |
| `kauri pin <id>` / `kauri unpin <id>`   | Pin/unpin a record (pinned = body shown in projection)                |
| `kauri project`                         | Compile decisions for agent context                                   |
| `kauri check`                           | Run staleness detection                                               |
| `kauri status`                          | Summary: counts by status, stale count, taxonomy size                 |
| `kauri taxonomy`                        | List or manage the tag taxonomy                                       |
| `kauri setup-git`                       | Register the Kauri merge driver in the current git repo               |
| `kauri serve`                           | Start the MCP server (stdio transport)                                |

Every command supports `--json` and `--help`.

## Documentation

- [`plugins/claude-code/`](./plugins/claude-code/README.md) — Claude Code plugin

## License

[MIT](./LICENSE)
