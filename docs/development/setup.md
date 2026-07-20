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
