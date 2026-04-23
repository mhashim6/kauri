---
name: check-staleness
description: Check if recorded Kauri decisions are stale. Use when assessing code changes, reviewing decisions, or when a staleness warning was raised by a hook.
disable-model-invocation: false
user-invocable: true
allowed-tools: mcp__kauri__kauri_check mcp__kauri__kauri_show mcp__kauri__kauri_validate
argument-hint: ''
---

# Check Decision Staleness

Run a staleness check on all active Kauri decisions and help the user resolve any stale records.

## Steps

1. **Run the check**: Use `kauri_check` to scan all active records.

2. **For each stale record**:
   - Use `kauri_show` to see the full decision content.
   - Assess whether the decision is still valid given the current code state.
   - Explain to the user what changed and why the record was flagged.

3. **Resolve each stale record** by asking the user to choose:
   - **Still valid**: Use `kauri_validate` with verdict `still_valid` to refresh the timestamp.
   - **Needs updating**: Use `kauri_record` with `supersedes` to create a new decision replacing the old one.
   - **No longer relevant**: Use `kauri_validate` with verdict `deprecate`.

## What "stale" means

A record is stale when:

- **Time-based**: More than `ttl_days` have passed since last validation (default 90 days).
- **File-based**: A file associated with the record has changed content since the last validation.

Stale does NOT mean wrong — it means "please review." The decision might still be perfectly valid.
