# relay-gent

A plugin-based CLI tool that watches files for changes, parses them into typed records, and relays those records to coding agents.

## What It Does

relay-gent sits between your file system and AI coding agents. It watches files, transforms their content into structured records using pluggable parsers, and delivers those records to external agents (opencode, claude, codex, or raw commands) via pluggable adapters.

```
File System --> Watcher --> Parser --> Record[] --> Adapter --> Agent
```

## Installation

### Prerequisites

- [Bun](https://bun.sh/) v1.0+ — relay-gent is built with Bun and requires it at runtime

### From Source

```bash
git clone https://github.com/JalenEvans/relay-gent
cd relay-gent
bun install
npm link
```

After `npm link`, the `relay-gent` command is available globally on your system (npm registers bin entries in its global prefix directory). Run `relay-gent status` to verify.

> **Note:** `bun link` is not used here — Bun's `link` command is for library development (linking packages into other projects' `node_modules`), not for exposing CLI binaries globally. Use `npm link` instead, which correctly symlinks the `relay-gent` binary to a directory on your PATH.

### Standalone Binary (no Bun required)

Compile relay-gent into a single native binary with the Bun runtime embedded:

```bash
git clone https://github.com/JalenEvans/relay-gent
cd relay-gent
bun install
bun build ./bin/relay-gent.ts --compile --outfile relay-gent
./relay-gent status
```

The resulting `relay-gent` binary is fully self-contained — it runs on any matching OS/architecture **without Bun installed**. Move it anywhere on your PATH:

```bash
mv relay-gent ~/.local/bin/
relay-gent status
```

### From npm (when published)

```bash
npm install -g relay-gent
# or
bun install -g relay-gent
```

> **Note:** relay-gent has not yet been published to npm. Use the "From Source" or "Standalone Binary" methods above for now.

### Verify Installation

```bash
relay-gent status
```

If successful, you'll see the status dashboard with your configured targets.

## Usage Examples

```bash
# Show status dashboard
relay-gent status

# One-shot parse and deliver
relay-gent once ./data.ndjson --target my-app

# Watch a file continuously
relay-gent watch ./data.ndjson --target my-app

# Run watcher in background (daemonize)
relay-gent watch ./data.ndjson --target my-app --background

# View target logs
relay-gent log --target my-app

# Stop a running watcher
relay-gent stop --target my-app

# Stop all watchers
relay-gent stop --all

# Clean stale state directories
relay-gent clean --force
```

## Supported Formats

| Parser | Description |
|--------|-------------|
| `json-lines` | Newline-delimited JSON (each line = one record) |
| `typescript` | TypeScript file parsing (planned) |

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
