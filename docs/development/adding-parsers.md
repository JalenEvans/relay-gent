# Adding a Parser

Step-by-step guide to implementing a new parser for relay-gent.

## 1. Choose a Parser Name

Use kebab-case. This name is used for registry lookup and config references.

Examples: `json-lines`, `revdiff`, `markdown-headers`, `junit`

## 2. Create the Parser File

Create `src/parsers/<name>.ts`:

```ts
import type { Parser } from "../domain/parser/parser.interface";
import { JsonLinesRecordSchema } from "../domain/record/record.schema";

function createMyParser(): Parser {
  return {
    name: "my-parser",
    parse(content: string) {
      // Parse content into Record[]

      // Use safeParse for validation — skip invalid entries silently
      const result = MyRecordSchema.safeParse(parsed);
      if (result.success) {
        records.push(result.data);
      }

      return records;
    },
  };
}

export { createMyParser };
```

**Key rules:**
- Import `Parser` from `../domain/parser/parser.interface`
- Import the relevant `RecordSchema` from `../domain/record/record.schema`
- Export a factory function (`create<Name>Parser()`)
- Use `safeParse` for validation, skip invalid entries silently (never throw on bad input)
- The `name` property must match what users put in config

## 3. Register via Barrel

Add your parser to `src/parsers/index.ts`:

```ts
import { createParserRegistry } from "../domain/parser/parser-registry";
import { createJsonLinesParser } from "./json-lines";
import { createMyParser } from "./my-parser";

const registry = createParserRegistry();
registry.registerParser(createJsonLinesParser());
registry.registerParser(createMyParser());

export { registry };
```

This overwrites the domain stub with your real implementation.

## 4. Add the Record Type (if new)

If your parser produces a record type that doesn't exist yet:

1. Define the schema in `src/domain/record/record.schema.ts`:
   ```ts
   const MyRecordSchema = BaseRecordSchema.extend({
     type: z.literal("my-type"),
     myField: z.string(),
     optionalField: z.number().optional(),
   });
   ```

2. Add it to the discriminated union:
   ```ts
   const RecordSchema = z.discriminatedUnion("type", [
     // ...existing schemas,
     MyRecordSchema,
   ]);
   ```

3. Add key/body extraction in `src/domain/record/record-identity.ts`:
   - Add a case to `getRecordKey()` for your record type
   - Add a case to `getRecordBody()` for your record type

4. Export the new schema from the barrel

## 5. Write Tests

Create test files following the existing patterns:

**Unit tests** in `test/unit/parsers/<name>.test.ts`:
```ts
import { describe, expect, it } from "bun:test";
import { createMyParser } from "../../../src/parsers/my-parser";

describe("my-parser", () => {
  it("has correct name", () => {
    const parser = createMyParser();
    expect(parser.name).toBe("my-parser");
  });

  it("parses valid content", () => {
    const parser = createMyParser();
    const records = parser.parse("...");
    expect(records).toHaveLength(1);
    expect(records[0].type).toBe("my-type");
  });

  it("skips malformed lines silently", () => {
    const parser = createMyParser();
    expect(() => parser.parse("not valid")).not.toThrow();
  });
});
```

**Integration tests** with fixtures in `test/fixtures/<name>/`:
```ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("my-parser integration", () => {
  it("parses fixture file", () => {
    const content = readFileSync(join("test/fixtures/my-parser/sample.txt"), "utf-8");
    const parser = createMyParser();
    const records = parser.parse(content);
    expect(records.length).toBeGreaterThan(0);
  });
});
```

## 6. Verify

```bash
# Run all tests
bun test

# Typecheck
bunx tsc --noEmit

# Lint
bunx biome check src/
```

## Reference: json-lines Parser

The `json-lines` parser in `src/parsers/json-lines.ts` is a complete example:

```ts
function createJsonLinesParser(): Parser {
  return {
    name: "json-lines",
    parse(content: string) {
      const lines = content.split("\n");
      const records: ReturnType<typeof JsonLinesRecordSchema.parse>[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === "") continue;

        try {
          const parsed: unknown = JSON.parse(trimmed);
          const withType = { ...(parsed as Record<string, unknown>), type: "json-lines" as const };
          const result = JsonLinesRecordSchema.safeParse(withType);
          if (result.success) {
            records.push(result.data);
          }
        } catch {
          // Skip malformed JSON lines silently
        }
      }

      return records;
    },
  };
}
```

Key patterns demonstrated:
- Empty line skipping
- Try/catch for malformed input
- `safeParse` for schema validation
- Type injection (`type: "json-lines"`) before validation
