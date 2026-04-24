---
name: consult
description: Consult existing Kauri decisions before planning or implementing changes. Use BEFORE making architectural choices, changing conventions, picking libraries, or modifying files that might be covered by a recorded decision.
disable-model-invocation: false
user-invocable: true
allowed-tools: mcp__kauri__kauri_query mcp__kauri__kauri_show mcp__kauri__kauri_taxonomy_list
argument-hint: '[topic or file path]'
---

# Consult Existing Decisions

Before planning or implementing changes, check whether existing decisions
are relevant. This prevents accidentally contradicting past choices.

## Steps

1. **Search by topic**: Run `kauri_query` with `--text "$ARGUMENTS"` and
   `--scope both` to find decisions across project and user scopes. If the
   argument is a file path, also search with `--file` to find decisions
   associated with that file.

2. **Broaden if needed**: If the text search returns nothing, try searching by
   related tags (use `kauri_taxonomy_list` to see available tags, then
   `kauri_query` with `--tags`).

3. **Read the full body**: For every decision that looks relevant, call
   `kauri_show <id>` to read the complete rationale — not just the title.

4. **Report what you found**: Before proceeding with the plan, tell the user:
   - Which decisions are relevant and what they say
   - Whether the proposed work is **consistent** with those decisions
   - Whether any decisions **conflict** with the proposed approach
   - Whether any decisions should be **superseded** by the new work

5. **Proceed accordingly**:
   - **Consistent**: Continue with the plan, noting which decisions support it.
   - **Conflicts**: Ask the user whether to (a) adjust the plan to respect the
     decision, or (b) supersede the decision with `kauri_record --supersedes`.
   - **No relevant decisions found**: Proceed normally, and consider whether the
     new work itself warrants a new decision record.

## When to use this

- Before any architectural or design planning
- Before changing conventions, APIs, or boundaries
- Before modifying files that appear in the session-start decision index
- When the user says "let's add", "let's change", "let's refactor", or "how should we"
- When you're unsure whether a past decision covers the current topic
