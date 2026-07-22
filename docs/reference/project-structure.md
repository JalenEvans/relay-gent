# Project Structure

```
relay-gent/
├── bin/
│   └── relay-gent.ts                   # CLI entry point (shebang, parseAsync with error handling)
│
├── src/
│   ├── index.ts                        # Public API barrel — exports domain layer
│   │
│   ├── cli.ts                          # Commander CLI definition (383 lines, 6 commands)
│   │
│   ├── domain/                         # Core business logic (no external deps beyond zod)
│   │   ├── record/
│   │   │   ├── record.schema.ts        # All record Zod schemas + discriminated union
│   │   │   ├── record-identity.ts      # computeIdentity(), getRecordKey(), getRecordBody()
│   │   │   └── index.ts               # Barrel re-export
│   │   │
│   │   ├── parser/
│   │   │   ├── parser.interface.ts     # Parser type definition
│   │   │   ├── parser-registry.ts      # createParserRegistry() factory
│   │   │   └── index.ts               # Barrel re-export
│   │   │
│   │   ├── adapter/
│   │   │   ├── adapter.interface.ts    # Adapter + DeliveredId type definitions
│   │   │   └── index.ts               # Barrel re-export
│   │   │
│   │   ├── config/
│   │   │   ├── config.schema.ts        # Config + TargetConfig schemas (discriminated union)
│   │   │   └── index.ts               # Barrel re-export
│   │   │
│   │   └── errors/
│   │       ├── schema-validation-error.ts  # Wraps Zod validation failures
│   │       ├── identity-compute-error.ts   # Identity computation failures
│   │       └── index.ts                    # Barrel re-export
│   │
│   ├── application/                    # Orchestration layer
│   │   ├── index.ts                    # Empty — CLI moved to src/cli.ts
│   │   └── runner.ts                   # Runner class — wires Parser → Adapter → DeltaTracker → StateStore
│   │
│   ├── config/
│   │   ├── loader.ts                   # Config loader: TOML → env → CLI → Zod validation
│   │   └── index.ts                    # Barrel re-export
│   │
│   ├── core/
│   │   └── delta.ts                    # DeltaTracker — computes record deltas
│   │
│   ├── state/
│   │   └── store.ts                    # StateStore — persistence for delivered record tracking
│   │
│   ├── adapters/                       # Concrete adapter implementations
│   │   └── raw-command.ts             # RawCommandAdapter — pipes records to shell commands
│   │
│   ├── parsers/                        # Concrete parser implementations
│   │   ├── json-lines.ts              # createJsonLinesParser() — NDJSON parser
│   │   └── index.ts                   # Barrel — creates registry, registers parsers, exports it
│   │
│   └── infrastructure/                 # External I/O (file watching, HTTP, shell)
│       └── index.ts                    # Empty — future: watchers, HTTP clients, process runners
│
├── test/
│   ├── unit/
│   │   ├── cli.test.ts                # CLI structural tests
│   │   ├── cli.core.test.ts           # CLI core commands (status, watch, once)
│   │   ├── cli.mgmt.test.ts           # CLI management commands (stop, clean, log)
│   │   ├── config/
│   │   │   └── loader.test.ts         # Config loader tests
│   │   ├── domain/
│   │   │   ├── record/
│   │   │   │   ├── record.schema.test.ts      # RecordSchema validation + fuzz tests
│   │   │   │   ├── record-identity.test.ts    # Identity computation tests
│   │   │   │   ├── property.test.ts           # fast-check property-based invariants
│   │   │   │   └── performance.test.ts        # Benchmarks (10k ops < 100ms)
│   │   │   ├── parser/
│   │   │   │   └── parser-registry.test.ts    # Registry get/register/list
│   │   │   ├── config/
│   │   │   │   └── config.schema.test.ts      # Config validation + fuzz tests
│   │   │   ├── adapter/
│   │   │   │   └── formatter.test.ts          # Adapter formatter tests
│   │   │   └── errors/
│   │   │       ├── schema-validation-error.test.ts  # Schema validation error tests
│   │   │       └── identity-compute-error.test.ts   # Identity computation error tests
│   │   ├── application/
│   │   │   └── runner.test.ts           # Runner orchestration tests
│   │   ├── core/
│   │   │   └── delta.test.ts            # DeltaTracker unit tests
│   │   ├── adapters/
│   │   │   └── raw-command.test.ts      # RawCommandAdapter tests
│   │   ├── state/
│   │   │   └── store.test.ts            # StateStore tests
│   │   └── parsers/
│   │       └── json-lines.test.ts       # Parser unit tests
│   │
│   ├── integration/
│   │   ├── cli.test.ts                  # CLI end-to-end integration tests
│   │   ├── parser-fixtures.test.ts      # Parser + registry integration with fixture files
│   │   ├── delta-state-store.test.ts    # Delta + StateStore integration
│   │   └── runner.test.ts              # Full pipeline integration
│   │
│   └── fixtures/
│       └── json-lines/
│           ├── valid.ndjson             # 3 valid NDJSON lines
│           ├── empty.ndjson             # Empty file
│           ├── malformed.ndjson         # Mix of valid + invalid lines
│           └── with-extra-fields.ndjson # Records with extra fields (passthrough)
│
├── docs/                                # This documentation
│   ├── architecture/
│   │   ├── overview.md
│   │   ├── delta-tracking.md
│   │   ├── record-system.md
│   │   └── plugin-system.md
│   ├── development/
│   │   ├── setup.md
│   │   ├── cli-usage.md
│   │   ├── adding-parsers.md
│   │   └── adding-adapters.md
│   └── reference/
│       ├── schemas.md
│       ├── project-structure.md
│       └── environment-variables.md
│
├── biome.json                           # Linter/formatter (Biome 1.9)
├── tsconfig.json                        # TypeScript config (strict, ESNext, bundler)
├── package.json                         # Dependencies + scripts
├── bun.lock                             # Bun lockfile
├── LICENSE                              # MIT
└── README.md                            # Project front door
```

## Directory Purposes

### `src/domain/`

The heart of the system. Contains interfaces, schemas, and pure business logic with zero dependencies on external I/O or application orchestration. Everything here is testable in isolation.

- **`record/`** — Data model. Zod schemas define the 4 record types; identity computation provides stable hashing.
- **`parser/`** — Input contract. The `Parser` type and `createParserRegistry()` factory. Domain ships a stub; real parsers register via barrel.
- **`adapter/`** — Output contract. The `Adapter` interface and `DeliveredId` type. No registry yet (future work).
- **`config/`** — Configuration schemas. `ConfigSchema` with `TargetConfigSchema` discriminated union.
- **`errors/`** — Domain-specific error types wrapping Zod failures and identity computation issues.

### `src/cli.ts`

Command-line interface definition using Commander. Exports `createCli()` which configures 6 commands: `status`, `watch`, `once`, `stop`, `clean`, and `log`. Called from `bin/relay-gent.ts`.

### `src/application/`

Orchestration layer. The `runner.ts` module provides the `Runner` class that wires the parse → delta → deliver pipeline. The CLI itself lives in `src/cli.ts`, not here.

### `src/config/`

Configuration layer. `loader.ts` implements the TOML → environment variable → CLI flag → Zod validation pipeline with deep merge logic.

### `src/core/`

Cross-cutting concerns. `delta.ts` provides `DeltaTracker` for computing what changed between two record sets.

### `src/state/`

Persistence layer. `store.ts` provides `StateStore` for tracking delivered records via JSON state files at `~/.relay-gent/targets/<name>/state.json`.

### `src/infrastructure/`

External integrations. Will contain file system watchers, HTTP clients for adapter delivery, and process runners for shell commands. Currently empty (future work).

### `src/parsers/`

Concrete parser implementations. Each file exports a factory function. The barrel (`index.ts`) creates a registry, registers all parsers, and exports it for consumers.

### `bin/`

Executable entry points. `relay-gent.ts` is the shebang entry point (`#!/usr/bin/env bun`) that creates the CLI and calls `parseAsync()`.

### `test/`

Tests mirror the `src/` directory structure. Unit tests validate individual functions; integration tests use fixture files from `test/fixtures/`. Property-based tests (`fast-check`) verify invariants across random inputs. Performance benchmarks ensure hot paths stay under 100ms for 10k operations.
