#!/bin/bash
# Kauri post-commit staleness check hook.
#
# Called after Bash tool use. Checks whether the Bash command was a
# git commit. If so, runs a staleness check and injects the result
# as additionalContext so Claude knows about stale decisions.
#
# Non-blocking: always exits 0 so it never interrupts the workflow.

set -euo pipefail

# Read the hook input from stdin.
INPUT=$(cat)

# Check if the Bash command was a git commit.
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null || true)
if [[ "$COMMAND" != *"git commit"* ]]; then
  exit 0
fi

# Check if kauri is available and a store exists.
if ! command -v kauri &>/dev/null; then
  exit 0
fi

# Run staleness check.
STALE_OUTPUT=$(kauri check --json --source "hook:claude-code-post-commit" 2>/dev/null || true)
STALE_COUNT=$(echo "$STALE_OUTPUT" | jq -r '.staleCount // 0' 2>/dev/null || echo "0")

if [ "$STALE_COUNT" = "0" ] || [ -z "$STALE_COUNT" ]; then
  exit 0
fi

# Inject staleness report into context.
cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": $(echo "Kauri staleness check: $STALE_COUNT record(s) may be stale after this commit. Run \`kauri check\` or use the kauri_check tool to see details." | jq -Rs .)
  }
}
EOF
