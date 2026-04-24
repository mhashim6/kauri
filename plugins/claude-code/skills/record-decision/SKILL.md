---
name: record-decision
description: Record a project decision using Kauri. Use when you've chosen an architectural pattern, library, convention, boundary, or resolved a trade-off.
disable-model-invocation: false
user-invocable: true
allowed-tools: mcp__kauri__kauri_record mcp__kauri__kauri_taxonomy_list mcp__kauri__kauri_query
argument-hint: '[title of the decision]'
---

# Record a Decision

You are recording a project decision using Kauri. The decision should be a deliberate choice with rationale — not a trivial implementation detail.

## Before recording

1. Check the existing taxonomy: use `kauri_taxonomy_list` to see available tags.
2. Check for existing related decisions: use `kauri_query` with a text search to avoid duplicates.

## Recording the decision

Use `kauri_record` with:

- **title**: A short, scannable title (the user provided: "$ARGUMENTS")
- **body**: The full rationale in markdown. Include:
  - What was decided
  - Why this option was chosen over alternatives
  - Any constraints or trade-offs involved
- **tags**: One or more tags from the taxonomy. If nothing fits, use `allow_new_tags: true`.
- **files**: Any file paths this decision relates to (optional but valuable for staleness detection).
- **links**: IDs of related decisions (optional — creates bidirectional "see also" links).
- **source**: `agent:claude-code`
- **scope**: `project` (default). Use `user` only if the user explicitly asks for a personal/cross-project decision.

## When NOT to record

- Trivial implementation details (variable names, formatting)
- Temporary workarounds intended to be removed immediately
- Facts or observations (decisions are _choices_, not notes)

## After recording

Confirm the record was created and show the user the ID and title.
