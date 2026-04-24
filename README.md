<p align="center">
  <img src="logo.svg" alt="Kauri" width="200" />
</p>

# Kauri

A local-first decision record store for LLM agents and humans. Tracks
architectural choices, conventions, and constraints — committed with your repo,
versioned with git, injected into agent context at session start.

Records have a lifecycle (draft, active, superseded, deprecated), file
associations with staleness detection, full-text search, and a controlled tag
taxonomy.

## Installation

### Homebrew (macOS and Linux)

```bash
brew tap mhashim6/kauri
brew install kauri
```

### GitHub Releases

Download the binary for your platform from
[Releases](https://github.com/mhashim6/kauri/releases) and add it to your
PATH.

Available: `kauri-darwin-arm64`, `kauri-darwin-x64`, `kauri-linux-x64`,
`kauri-windows-x64.exe`

### Build from source

```bash
git clone https://github.com/mhashim6/kauri && cd kauri
bun install && bun run build
# Binary at dist/kauri — add to your PATH
```

## Quick start

```bash
kauri init
kauri record -t "Use JWT with refresh tokens" \
  -b "15-minute access tokens, 7-day refresh. Chose over session cookies for stateless scaling." \
  -T api -T security -F src/auth/handler.ts
kauri project   # the projection agents receive
kauri check     # staleness detection
```

## Scopes

Kauri has two scopes:

- **Project** (default) — stored in `.kauri/store.db`, committed with the repo,
  shared with the team.
- **User** — stored in `~/.kauri/store.db`, shared across all your projects,
  not committed anywhere.

```bash
kauri init --scope user          # create the user store
kauri record --scope user -t "Prefer composition over inheritance" \
  -b "Personal convention across all projects" -T style
kauri query --scope user         # list user-level decisions
kauri query --scope both         # search project + user together
```

## Agent integration

### Claude Code plugin

```bash
/plugin marketplace add mhashim6/kauri
/plugin install kauri@kauri
```

This registers 12 MCP tools (`kauri_record`, `kauri_query`, `kauri_show`,
`kauri_validate`, `kauri_project`, etc.), session-start and post-commit hooks,
and 5 skills (`/kauri:consult`, `/kauri:propose`, `/kauri:review`,
`/kauri:record-decision`, `/kauri:check-staleness`).

### Any MCP client

For Cursor, Windsurf, Claude Desktop, or anything that speaks MCP:

```json
{
  "mcpServers": {
    "kauri": { "command": "kauri", "args": ["serve"] }
  }
}
```

Or via Claude Code directly:

```bash
claude mcp add kauri -- kauri serve
```

## Git integration

`.kauri/store.db` is committed with the repo. A custom three-way merge driver
handles concurrent edits:

- New records on both branches — both kept
- Same record edited on both — last-writer-wins by timestamp
- ID collisions — incoming record re-numbered
- Taxonomy — union of both sides

```bash
# Auto-configured by kauri init. For existing repos:
kauri setup-git
```

## CLI reference

| Command                                 | What it does                                                           |
| --------------------------------------- | ---------------------------------------------------------------------- |
| `kauri init`                            | Create a store (`--scope user` for user-level)                         |
| `kauri record -t "..." -b "..." -T tag` | Record a decision (`-F` files, `-L` links, `--supersedes`)             |
| `kauri update <id>`                     | Edit a record's mutable fields (`-t`, `-b`, `-T`, `-F`, `-L`)          |
| `kauri query [--text "..."]`            | Search decisions (`--tag`, `--file`, `--status`, `--since`, `--scope`) |
| `kauri show <id>`                       | View a decision in full                                                |
| `kauri history <id>`                    | Walk the supersession chain                                            |
| `kauri validate <id> still_valid`       | Confirm a decision is current                                          |
| `kauri validate <id> deprecate`         | Retire a decision                                                      |
| `kauri pin <id>` / `kauri unpin <id>`   | Pin/unpin (pinned = body shown in projection)                          |
| `kauri project`                         | Compile decisions for agent context                                    |
| `kauri check`                           | Run staleness detection                                                |
| `kauri status`                          | Counts by status, stale count, taxonomy size                           |
| `kauri taxonomy`                        | List or manage the tag taxonomy                                        |
| `kauri setup-git`                       | Register the merge driver                                              |
| `kauri serve`                           | Start the MCP server (stdio)                                           |

Every command supports `--json` and `--help`.

## Documentation

- [`kauri-spec.md`](./kauri-spec.md) — full v0.1 specification
- [`plugins/claude-code/`](./plugins/claude-code/README.md) — Claude Code plugin

## License

[MIT](./LICENSE)
