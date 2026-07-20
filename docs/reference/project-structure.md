# Project Structure

```
relay-gent/
├── src/
│   ├── index.ts                        # Public API barrel — exports domain layer
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
│   ├── application/                    # Orchestration layer (CLI, watch loop)
│   │   └── index.ts                    # Empty — future: CLI entry point, watch orchestration
│   │
│   ├── infrastructure/                 # External I/O (file watching, HTTP, shell)
│   │   └── index.ts                    # Empty — future: watchers, HTTP clients, process runners
│   │
│   └── parsers/                        # Concrete parser implementations
│       ├── json-lines.ts              # createJsonLinesParser() — NDJSON parser
│       └── index.ts                   # Barrel — creates registry, registers parsers, exports it
│
├── test/
│   ├── unit/
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
│   │   │   └── errors/
│   │   │       ├── schema-validation-error.test.ts
│   │   │       └── identity-compute-error.test.ts
│   │   └── parsers/
│   │       └── json-lines.test.ts             # Parser unit tests
│   │
│   ├── integration/
│   │   └── parser-fixtures.test.ts    # Parser + registry integration with fixture files
│   │
│   └── fixtures/
│       └── json-lines/
│           ├── valid.ndjson           # 3 valid NDJSON lines
│           ├── empty.ndjson           # Empty file
│           ├── malformed.ndjson       # Mix of valid + invalid lines
│           └── with-extra-fields.ndjson  # Records with extra fields (passthrough)
│
├── docs/                               # This documentation
│   ├── architecture/
│   │   ├── overview.md
│   │   ├── record-system.md
│   │   └── plugin-system.md
│   ├── development/
│   │   ├── setup.md
│   │   ├── adding-parsers.md
│   │   └── adding-adapters.md
│   └── reference/
│       ├── schemas.md
│       └── project-structure.md
│
├── biome.json                          # Linter/formatter (Biome 1.9)
├── tsconfig.json                       # TypeScript config (strict, ESNext, bundler)
├── package.json                        # Dependencies + scripts
├── bun.lock                            # Bun lockfile
├── LICENSE                             # MIT
└── README.md                           # Project front door
```

## Directory Purposes

### `src/domain/`

The heart of the system. Contains interfaces, schemas, and pure business logic with zero dependencies on external I/O or application orchestration. Everything here is testable in isolation.

- **`record/`** — Data model. Zod schemas define the 4 record types; identity computation provides stable hashing.
- **`parser/`** — Input contract. The `Parser` type and `createParserRegistry()` factory. Domain ships a stub; real parsers register via barrel.
- **`adapter/`** — Output contract. The `Adapter` interface and `DeliveredId` type. No registry yet (future work).
- **`config/`** — Configuration schemas. `ConfigSchema` with `TargetConfigSchema` discriminated union.
- **`errors/`** — Domain-specific error types wrapping Zod failures and identity computation issues.

### `src/application/`

Orchestration layer. Will contain the CLI entry point, watch loop, and coordination between parsers and adapters. Currently empty (future work).

### `src/infrastructure/`

External integrations. Will contain file system watchers, HTTP clients for adapter delivery, and process runners for shell commands. Currently empty (future work).

### `src/parsers/`

Concrete parser implementations. Each file exports a factory function. The barrel (`index.ts`) creates a registry, registers all parsers, and exports it for consumers.

### `test/`

Tests mirror the `src/` directory structure. Unit tests validate individual functions; integration tests use fixture files from `test/fixtures/`. Property-based tests (`fast-check`) verify invariants across random inputs. Performance benchmarks ensure hot paths stay under 100ms for 10k operations.
