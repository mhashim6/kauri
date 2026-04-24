#!/bin/bash
# Kauri session-start hook — inject the decision projection into context.
#
# Called by Claude Code at session start (and on context compaction).
# Runs `kauri project` and returns the output as additionalContext so
# Claude sees all active decisions + pinned bodies without having to
# query them explicitly.
#
# If kauri is not installed or no store exists, this is a silent no-op
# (exit 0, empty output).

set -euo pipefail

# Check if kauri is available.
if ! command -v kauri &>/dev/null; then
  exit 0
fi

# Check if we're inside a kauri project (has .kauri/store.db).
if ! kauri status --json &>/dev/null 2>&1; then
  exit 0
fi

# Get the projection and emit it as additionalContext.
PROJECTION=$(kauri project --scope both --source "hook:claude-code-session-start" 2>/dev/null || true)

if [ -z "$PROJECTION" ]; then
  exit 0
fi

# Append guidance so Claude knows to fetch full bodies when relevant.
GUIDANCE="
---
The index above shows decision TITLES only. Before making changes that
touch architecture, conventions, APIs, or any file listed in a decision:
1. Use kauri_query with --text to find relevant decisions by topic.
2. Use kauri_show <id> to read the full body of relevant decisions.
3. Ensure your changes are consistent with active decisions.
If a decision needs updating, use kauri_record --supersedes <id>."

FULL_CONTEXT="${PROJECTION}${GUIDANCE}"

# Output structured hook response with additionalContext.
# The projection + guidance becomes part of Claude's system context.
cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": $(echo "$FULL_CONTEXT" | jq -Rs .)
  }
}
EOF
