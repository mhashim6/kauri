# Kauri

> A deterministic record database for LLM agents and humans.

Kauri is a lightweight, local-first record store that tracks project decisions
(and, in the future, other kinds of records) with structured lifecycle
semantics, optional file associations for staleness detection, full-text
search, and a controlled tag taxonomy. It exposes both a CLI and a stdio MCP
server, so the same data is reachable from a human terminal and from any
MCP-aware LLM agent.

Kauri does **not** contain or invoke an LLM. Every operation is deterministic.

## Status

**Pre-release.** v0.1 is under active implementation. The authoritative
specification lives in [`kauri-spec.md`](./kauri-spec.md).

## Documentation

- [`kauri-spec.md`](./kauri-spec.md) — full v0.1 specification.

## License

[MIT](./LICENSE)
