# Plugin System

relay-gent has two extension points: **Parsers** (input transformation) and **Adapters** (output delivery).

## Parser Interface

Defined in `src/domain/parser/parser.interface.ts`:

```ts
type Parser = {
  /** Unique name identifying this parser (e.g., "revdiff", "json-lines") */
  name: string;

  /** Parse raw content into an array of Records */
  parse(content: string): Record[];
};
```

A parser takes raw string content (from a file) and returns an array of validated `Record` objects. Parsers should silently skip malformed entries rather than throwing.

## Adapter Interface

Defined in `src/domain/adapter/adapter.interface.ts`:

```ts
interface Adapter {
  /** Unique name identifying this adapter (e.g., "opencode", "claude") */
  name: string;

  /** Deliver a batch of records to the target system */
  deliver(batch: Record[], ctx: TargetConfig): Promise<DeliveredId[]>;

  /** Optional readiness check — returns true if adapter is ready */
  ready?(ctx: TargetConfig): Promise<boolean>;
}
```

- `deliver()` returns `DeliveredId[]` (string identifiers) for tracking what was sent
- `ready()` is optional — used to verify connections before starting the watch loop

## Parser Registry

### Factory Pattern

```ts
function createParserRegistry(): ParserRegistry {
  // Returns an independent Map-backed registry
}
```

Each call to `createParserRegistry()` creates a new, isolated registry with no shared state. This prevents test pollution and allows multiple independent registries.

### API

```ts
type ParserRegistry = {
  getParser(name: string): Parser;    // Throws Error if unknown
  registerParser(parser: Parser): void; // Add or overwrite
  listParsers(): string[];            // All registered names
};
```

### Default Behavior

Every new registry ships with a pre-registered `json-lines` stub parser that returns an empty array:

```ts
const jsonLinesStub: Parser = {
  name: "json-lines",
  parse: () => [],
};
```

This stub is overwritten when the real implementation registers via the barrel.

## Auto-Registration via Barrels

The parser barrel (`src/parsers/index.ts`) handles concrete registration:

```ts
import { createParserRegistry } from "../domain/parser/parser-registry";
import { createJsonLinesParser } from "./json-lines";

const registry = createParserRegistry();
registry.registerParser(createJsonLinesParser());

export { registry };
```

**Why this pattern:**
- Domain layer defines the interface and a stub registry
- Concrete implementations live in `src/parsers/`
- The barrel creates a real registry, registers the real parser, and exports it
- Consumers import from the barrel to get fully-initialized parsers
- Domain remains decoupled from implementations

## Adding a New Parser

1. Create `src/parsers/<name>.ts`
2. Implement the `Parser` interface with a factory function
3. Register it in `src/parsers/index.ts`
4. If the parser produces a new record type, extend the `RecordSchema`
5. Add tests in `test/unit/parsers/` and fixtures in `test/fixtures/<name>/`

See [Adding Parsers](../development/adding-parsers.md) for the full step-by-step guide.

## Adding a New Adapter

1. Add a target schema variant to `src/domain/config/config.schema.ts`
2. Add it to the `TargetConfigSchema` discriminated union
3. Create `src/adapters/<name>.ts` implementing the `Adapter` interface
4. Register it in an adapter barrel (pattern similar to parsers)
5. Add tests

See [Adding Adapters](../development/adding-adapters.md) for the full step-by-step guide.

> **Note:** While "plugin system" describes the interface-based extension design, there is currently no dynamic plugin discovery or runtime loading mechanism. Adapters are registered via hard-coded resolution functions in `cli.ts` and `runner-worker.ts`. A formal adapter registry (similar to `ParserRegistry`) is planned for future work.
