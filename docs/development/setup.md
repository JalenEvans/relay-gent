# Development Setup

## Prerequisites

- [Bun](https://bun.sh/) v1.0+ (runtime + test runner + package manager)
- Node.js compatibility (Bun is API-compatible)

## Clone & Install

```bash
git clone <repo-url>
cd relay-gent
bun install
```

## Available Scripts

| Command | Description |
|---------|-------------|
| `bun test` | Run all unit and integration tests |
| `bun run check` | Biome lint check (no auto-fix) |
| `bun run check:fix` | Biome lint with auto-fix |
| `bun run format` | Biome format all source files |
| `bun run build` | Typecheck (`tsc --noEmit`) + bundle to `dist/` |

## IDE Setup

**VS Code** (recommended):
- Install the [Biome extension](https://marketplace.visualstudio.com/items?itemName=biomejs.biome) for linting and formatting inline
- Biome config is in `biome.json` at the project root

## Project Conventions

From `biome.json`:

| Setting | Value |
|---------|-------|
| Indent style | Spaces |
| Indent width | 2 |
| Line width | 100 |
| Quote style | Double quotes |
| Trailing commas | All |

Additional conventions:
- **Strict TypeScript** — `strict: true` in `tsconfig.json`
- **ESNext modules** — `"type": "module"` in `package.json`
- **Schema-first** — Zod schemas define the data model, TypeScript types are inferred
- **Domain purity** — `src/domain/` has zero external dependencies beyond `zod`
- **Test mirroring** — `test/unit/` mirrors `src/` directory structure

## Running Tests

```bash
# All tests
bun test

# Specific test file
bun test test/unit/domain/record/record.schema.test.ts

# Watch mode
bun test --watch
```

Tests use:
- `bun:test` — describe/it/expect
- `fast-check` — property-based testing for invariants

## Running the CLI

The `relay-gent` binary runs via the bin entry in `package.json` or directly with Bun:

```bash
# Run directly during development
bun run bin/relay-gent.ts <command> [options]

# Or if installed globally
relay-gent <command> [options]
```

### Configuration

Configuration is auto-loaded from `~/.relay-gent/config.toml`. Environment variables prefixed with `RELAY_GENT_` may override config file values. See the [Environment Variables Reference](../reference/environment-variables.md) for details.

CLI flags take the highest precedence: **CLI flags > Environment variables > Config file > Schema defaults**.

### Quick Examples

```bash
# Show status dashboard (default command)
relay-gent status

# One-shot parse and deliver
relay-gent once ./data.ndjson --target my-target

# Watch a file for changes (foreground)
relay-gent watch ./data.ndjson --target my-target

# View logs for a target
relay-gent log --target my-target

# Clean stale state directories
relay-gent clean --force
```

For a complete command reference, see [CLI Usage Reference](cli-usage.md).
