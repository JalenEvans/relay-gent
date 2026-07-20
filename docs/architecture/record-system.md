# Record System

Records are the core data unit in relay-gent. Every parser produces them, every adapter consumes them.

## BaseRecordSchema

All record types extend a common base:

```ts
const BaseRecordSchema = z.object({
  schemaVersion: z.literal(1).default(1),
});
```

- `schemaVersion` is always `1` (literal, not a range)
- Defaults to `1` if omitted in input

## Record Types

| Type | Discriminant | Required Fields | Optional Fields | Notes |
|------|-------------|----------------|-----------------|-------|
| `revdiff` | `type: "revdiff"` | `file`, `line`, `annotationType` (`+`/`-`/` `/`file-level`), `comment` | `endLine` | Revision diff annotations |
| `json-lines` | `type: "json-lines"` | `message` | `timestamp`, `level` | Uses `.passthrough()` for extra fields |
| `markdown-headers` | `type: "markdown-headers"` | `header`, `level` (>=0), `body` | — | Parsed markdown sections |
| `junit` | `type: "junit"` | `name` | `classname`, `time`, `failure`, `error` | JUnit test results |

## Discriminated Union

`RecordSchema` is a Zod discriminated union on the `type` field:

```ts
const RecordSchema = z.discriminatedUnion("type", [
  RevdiffRecordSchema,
  JsonLinesRecordSchema,
  MarkdownHeadersRecordSchema,
  JunitRecordSchema,
]);
```

**Why discriminated unions:**
- Type-safe narrowing: `if (record.type === "revdiff")` gives you full access to revdiff fields
- Exhaustive checks: TypeScript warns if you miss a case in a switch
- Fast validation: Zod only validates the matching variant, not all four

## `.passthrough()` on json-lines

The `JsonLinesRecordSchema` uses `.passthrough()`, which means unknown fields are preserved in the parsed output:

```ts
// Input: {"message": "hi", "custom": "value"}
// Output: { type: "json-lines", message: "hi", custom: "value", schemaVersion: 1 }
```

This is intentional: different JSON formats may carry extra metadata that downstream adapters or consumers need. Other record types strip unknown fields (default Zod behavior).

## Record Identity

Every record gets a stable identity string via `computeIdentity()`:

```
<type>:<key>:<sha256-hash>
```

### Key Extraction (`getRecordKey`)

| Type | Key Format |
|------|-----------|
| `revdiff` | `<file>:<line>:<annotationType>` |
| `json-lines` | `<timestamp>:<level>` (empty string for missing optionals) |
| `markdown-headers` | `<header>` |
| `junit` | `<name>:<classname>` (empty string if classname missing) |

### Body Extraction (`getRecordBody`)

| Type | Body Source |
|------|-----------|
| `revdiff` | `comment` |
| `json-lines` | `message` |
| `markdown-headers` | `body` |
| `junit` | `failure` (fallback: `error`, fallback: `""`) |

### Normalization (`normalizeBody`)

Before hashing, the body goes through:

1. **NFC normalization** - Unicode equivalence (e.g., `cafe\u0301` becomes `caf\u00e9`)
2. **CRLF to LF** - Consistent line endings
3. **Trim** - Strip leading/trailing whitespace
4. **SHA-256** - 64-character hex hash

This ensures records with semantically identical content produce the same identity regardless of encoding differences.

### Example

```ts
computeIdentity({
  type: "revdiff",
  file: "src/main.ts",
  line: 42,
  annotationType: "+",
  comment: "Added null check",
  schemaVersion: 1,
})
// => "revdiff:src/main.ts:42:+:a1b2c3d4...<64-char hex>"
```

## Adding a New Record Type

1. Define the schema in `src/domain/record/record.schema.ts`:
   ```ts
   const MyRecordSchema = BaseRecordSchema.extend({
     type: z.literal("my-type"),
     // ... fields
   });
   ```
2. Add it to the discriminated union:
   ```ts
   const RecordSchema = z.discriminatedUnion("type", [
     // ...existing schemas,
     MyRecordSchema,
   ]);
   ```
3. Add key/body extraction to `src/domain/record/record-identity.ts`:
   - Add a case to `getRecordKey()`
   - Add a case to `getRecordBody()`
4. Export the new schema from the barrel
5. Add tests in `test/unit/domain/record/`
