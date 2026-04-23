---
name: propose
description: Draft a Kauri decision for human review before recording it. This skill should be used proactively — when the user makes, confirms, or rejects a non-trivial choice (picking a library, rejecting an approach, choosing an architecture, resolving a trade-off, establishing a convention), invoke this skill to draft a decision for their approval. Signals include "let's go with X", "let's use X", "X is better", rejecting an alternative after discussion, or choosing between trade-offs. Do NOT propose for trivial choices, temporary workarounds, or single-line fixes.
disable-model-invocation: false
user-invocable: true
allowed-tools: mcp__kauri__kauri_taxonomy_list mcp__kauri__kauri_query mcp__kauri__kauri_record
argument-hint: "[topic of the decision]"
---

# Propose a Decision

Draft a decision record and present it for human approval before writing
it to the database. This is the quality gate that prevents low-value or
poorly-worded records from accumulating.

## Steps

1. **Understand the context**: Based on `$ARGUMENTS` and the conversation
   so far, identify what decision was made, why, and what alternatives
   were considered.

2. **Check for duplicates**: Run `kauri_query --text "$ARGUMENTS"` to
   see if a similar decision already exists. If it does, ask whether
   to supersede it or skip recording.

3. **Check the taxonomy**: Run `kauri_taxonomy_list` to see available
   tags. Pick the most fitting ones.

4. **Draft the record**: Present the following to the user for review:

   ```
   Title: [short, scannable — what was decided]
   Body:
     [What was decided and why]
     [What alternatives were considered]
     [Key constraints or trade-offs]
   Tags: [tag1, tag2]
   Files: [any associated file paths]
   Links: [IDs of related decisions, if any]
   Pin: [yes/no — only if this is a critical rule the agent must always see]
   Status: [active or draft if still tentative]
   ```

5. **Ask for approval**: Present the draft and ask:
   - "Record this decision?" (proceed)
   - "Edit something?" (revise and re-present)
   - "Skip" (don't record)

6. **Record if approved**: Call `kauri_record` with the approved values.
   If superseding, include `--supersedes <id>`.

## Quality guidelines

A good decision record:
- **Title**: One sentence, starts with a verb or states the choice clearly.
  Good: "Use JWT with 15-minute refresh tokens". Bad: "Auth stuff".
- **Body**: Explains WHY, not just WHAT. Includes the trade-off or
  constraint that drove the choice.
- **Tags**: 1-3 tags from the taxonomy. Don't force-fit — if nothing
  matches, propose a new tag and explain why.
- **Files**: Only files directly governed by this decision. Don't list
  every file that touches the feature.
- **Pin**: Reserve for critical rules (security constraints, hard
  boundaries). Most decisions should NOT be pinned.

## When NOT to record

- Trivial choices (variable naming, import order)
- Temporary workarounds with a known fix date
- Facts or observations — decisions are *choices with rationale*
