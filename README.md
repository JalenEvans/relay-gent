# relay-gent

An MCP (Model Context Protocol) server that watches files for changes, parses them into typed records, and relays those records to AI coding agents.

## What It Does

relay-gent runs as an MCP server over stdio transport. It exposes tools to watch files, query parsed records, and check status — designed for integration with Claude Code and other MCP-compatible agents.

When a watched file changes, relay-gent re-parses its contents, stores the updated records, and sends a `sendResourceUpdated` notification to the connected MCP host.

```
File System --> Watcher --> Parser --> Record[] --> MCP Server --> Agent
```

## Quick Start

```bash
# Install
bun install

# Run tests
bun test

# Typecheck + build
bun run build

# Start the MCP server (default command)
relay-gent
```

## Usage

```bash
# Start the MCP server over stdio transport
relay-gent

# Or explicitly:
relay-gent mcp
```

Once running, the MCP server exposes these tools and resources to the connected host (e.g., Claude Code):

### Tools

| Tool | Description |
|------|-------------|
| `watch_file` | Start watching a file for changes and relay its contents |
| `unwatch_file` | Stop watching a file |
| `get_records` | Get all tracked records |
| `get_status` | Get current watcher and record store status |

### Resources

| Resource | Description |
|----------|-------------|
| `relay-gent://records` | All records tracked by relay-gent (JSON) |
| `relay-gent://status` | Current watcher and record store status (JSON) |

### Notifications

When a watched file changes, the server sends a `sendResourceUpdated` notification for the `relay-gent://records` resource, signaling the host to refresh.

## Supported Formats

| Parser | Description |
|--------|-------------|
| `json-lines` | Newline-delimited JSON (each line = one record) |
| `typescript` | TypeScript file parsing (planned) |

More parsers coming. See [Adding Parsers](docs/development/adding-parsers.md).

## Project Structure

```
relay-gent/
  src/
    domain/         # Core business logic (no external deps)
      record/       # Record schemas + identity computation
      parser/       # Parser interface + registry
      errors/       # Custom error types
    mcp/            # MCP server layer
      server.ts     # Entry point, wires all components
      tools.ts      # Tool handlers (watch_file, unwatch_file, get_records, get_status)
      resources.ts  # Resource providers (relay-gent://records, relay-gent://status)
      notifications.ts  # File change notifications to MCP host
    watcher/        # Chokidar-based file watcher manager
    state/          # Record store with atomic replace-on-change persistence
    parsers/        # Parser implementations + barrel registration
    cli.ts          # Single mcp command (Commander, is default)
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
