---
name: review
description: Review recent code changes against Kauri decisions. Use after implementing changes, before committing, during PR review, or when asked "does this look right?" to verify consistency with recorded decisions.
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash(git diff *) Bash(git log *) mcp__kauri__kauri_query mcp__kauri__kauri_show mcp__kauri__kauri_validate Read
argument-hint: '[file or commit range]'
---

# Review Changes Against Decisions

After implementing changes, verify they are consistent with recorded
project decisions. This catches violations before they're committed.

## Steps

1. **Identify what changed**: If `$ARGUMENTS` is a file path, read it. If
   it's a commit range, run `git diff $ARGUMENTS`. If empty, run `git diff`
   to see unstaged changes, or `git diff --cached` for staged changes.

2. **Find related decisions**: For each changed file, query Kauri:
   - `kauri_query` with `--file <path>` for directly associated decisions.
   - `kauri_query` with `--text` using keywords from the changed code
     (function names, module names, concepts).

3. **Read the full decisions**: Call `kauri_show <id>` for every match.
   Don't skip any — a decision might look irrelevant from the title but
   contain a constraint in the body.

4. **Assess consistency**: For each relevant decision, determine:
   - **Consistent**: The changes respect the decision. Note this.
   - **Potential conflict**: The changes might violate the decision.
     Explain specifically what conflicts and why.
   - **Decision should be updated**: The changes are intentional
     improvements that make the old decision obsolete.

5. **Report to the user**:
   - List each relevant decision and your assessment.
   - For conflicts: recommend either adjusting the code or superseding
     the decision.
   - For decisions that should be updated: offer to record a superseding
     decision via `/kauri:propose`.
   - For decisions now validated by the changes: offer to run
     `kauri_validate still_valid` to refresh their timestamp.

## When to use this

- Before `git commit` on significant changes
- When reviewing a PR or diff
- When the user asks "does this look right?" or "anything I'm missing?"
- After refactoring that touches many files
- When the post-commit staleness hook reports stale decisions
