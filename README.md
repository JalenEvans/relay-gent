# relay-gent

A plugin-based CLI tool that watches files for changes, parses them into typed records, and relays those records to coding agents.

## What It Does

relay-gent sits between your file system and AI coding agents. It watches files, transforms their content into structured records using pluggable parsers, and delivers those records to external agents (opencode, claude, codex, or raw commands) via pluggable adapters.

```
File System --> Watcher --> Parser --> Record[] --> Adapter --> Agent
```

## Quick Start

```bash
# Install
bun install

# Run tests
bun test

# Typecheck + build
bun run build
```

## Supported Formats

| Parser | Description |
|--------|-------------|
| `json-lines` | Newline-delimited JSON (each line = one record) |

More parsers coming. See [Adding Parsers](docs/development/adding-parsers.md).

## Supported Agents

| Adapter | Description |
|---------|-------------|
| `opencode` | opencode server (default: `http://localhost:4096`) |
| `claude` | Claude agent |
| `codex` | Codex agent |
| `raw-command` | Any shell command |

## Project Structure

```
relay-gent/
  src/
    domain/         # Core business logic (no external deps)
    application/    # Orchestration layer (CLI, watch loop)
    infrastructure/ # External integrations
    parsers/        # Parser implementations + barrel registration
    index.ts        # Public API exports
  test/
    unit/           # Unit tests (mirror src/ structure)
    integration/    # Integration tests with fixtures
    fixtures/       # Test data files
  docs/             # Documentation
```

## Development

See [Development Setup](docs/development/setup.md) for prerequisites, available scripts, and project conventions.

## Architecture

See [Architecture Overview](docs/architecture/overview.md) for DDD layers, plugin system, and design decisions.

## License

MIT
