# Architecture Overview

relay-gent uses a Domain-Driven Design (DDD) architecture with strict layer separation.

## DDD Layers

```
src/
  domain/           # Core business logic - zero external dependencies
    record/         # Record schemas + identity computation
    parser/         # Parser interface + registry
    adapter/        # Adapter interface
    config/         # Configuration schemas
    errors/         # Custom error types
  application/      # Orchestration (CLI, watch loop) - depends on domain
  infrastructure/   # External I/O (file watching, HTTP, shell) - depends on domain + application
  parsers/          # Concrete parser implementations + barrel registration
```

**Layer rules:**
- **Domain** has no dependencies on application, infrastructure, or parsers. It defines interfaces, schemas, and pure business logic.
- **Application** orchestrates domain objects but does no I/O itself.
- **Infrastructure** handles all external interactions (file system, network, shell).
- **Parsers** are concrete implementations that register into the domain's parser registry.

## Data Flow

```mermaid
graph LR
    FS[File System] --> W[Watcher]
    W --> P[Parser]
    P --> R[Record Array]
    R --> A[Adapter]
    A --> AG[External Agent]
```

1. **Watcher** monitors files for changes (infrastructure layer)
2. **Parser** transforms raw file content into typed `Record[]` (domain interface, concrete implementations in `parsers/`)
3. **Adapter** delivers the batch to an external system (domain interface, concrete implementations TBD)

## Plugin System

Two extension points, both defined as interfaces in the domain layer:

- **Parsers** (input): Transform raw content into `Record[]`. Registered via `createParserRegistry()`.
- **Adapters** (output): Deliver `Record[]` to external systems. Defined by the `Adapter` interface.

See [Plugin System](plugin-system.md) for details.

## Schema-First Design

All data models are defined as Zod schemas first, with TypeScript types inferred from them:

```ts
const JsonLinesRecordSchema = BaseRecordSchema.extend({
  type: z.literal("json-lines"),
  message: z.string(),
  timestamp: z.string().optional(),
  level: z.string().optional(),
}).passthrough();

type Record = z.infer<typeof RecordSchema>;
```

This ensures runtime validation matches compile-time types exactly.

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Factory pattern for registries | Each `createParserRegistry()` call returns an independent instance with no shared state |
| Map-based lookup | O(1) parser retrieval by name |
| Discriminated unions on `type`/`adapter` | Type-safe narrowing with exhaustive checks |
| `.passthrough()` on json-lines | Preserves unknown fields for extensibility |
| Barrel re-exports (`index.ts`) | Clean public API surface; domain layer decoupled from implementations |
| Stub in domain, real impl via barrel | Domain ships a no-op parser; concrete implementations overwrite it at registration time |

### Configuration Loading

Before any pipeline runs, configuration is loaded and validated:

```mermaid
graph LR
    TOML[~/.relay-gent/config.toml] --> M[Merge]
    ENV[RELAY_GENT_* vars] --> M
    CLI[CLI flags] --> M
    M --> V[Zod Validation]
    V --> C[Config object]
```

The `loadConfig()` function in `src/config/loader.ts` implements a three-tier merge: TOML file (lowest priority), environment variables (middle), and CLI overrides (highest). The result is validated against `ConfigSchema`.

## CLI Architecture

The CLI is implemented in `src/cli.ts` using the Commander library. The `createCli()` function configures 6 commands (`status`, `watch`, `once`, `stop`, `clean`, `log`) and is invoked from `bin/relay-gent.ts` via `parseAsync()`. Exit codes follow Unix conventions: 0 for success, 1 for any error.

The `Runner` class in `src/application/runner.ts` serves as the orchestration engine, wiring together parsers, the delta tracker, adapters, and the state store into a cohesive pipeline for the `watch` and `once` commands.

## Error Handling

Two domain-specific error types:

- `SchemaValidationError` - wraps Zod validation failures with schema name, issues array, and raw input
- `IdentityComputeError` - raised when record identity computation fails (should never happen with valid records)

Errors during the pipeline (file read, parse, delta, deliver) are caught and logged by the `Runner.onFileChange()` method and never rethrown, ensuring the watcher continues operating on subsequent file changes.

See [Record System](record-system.md) and [Plugin System](plugin-system.md) for implementation details. For a full reference on error types and handling patterns, see [Error Handling Reference](../reference/error-handling.md).
