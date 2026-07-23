# Error Handling Reference

relay-gent defines two custom error classes in `src/domain/errors/` that extend the built-in `Error` class.

## Error Class Hierarchy

```
Error
  ├── SchemaValidationError
  └── IdentityComputeError
```

All domain errors are re-exported from `src/domain/errors/index.ts` and are available via the public API surface at `src/index.ts`.

## SchemaValidationError

**Source:** `src/domain/errors/schema-validation-error.ts`

Thrown when Zod validation fails during record parsing, configuration loading, or target validation.

```typescript
class SchemaValidationError extends Error {
  constructor(
    public readonly schema: string,    // Name of the schema that failed (e.g., "RecordSchema")
    public readonly issues: ZodIssue[], // Array of Zod validation issues
    public readonly raw: unknown,       // The raw input that failed validation
  ) {
    super(`Schema validation failed for ${schema}`);
    this.name = "SchemaValidationError";
  }
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `schema` | `string` | Human-readable name of the schema that failed (e.g., `"RecordSchema"`, `"ConfigSchema"`) |
| `issues` | `ZodIssue[]` | The full array of validation issues from Zod. Each issue contains `path`, `message`, and `code` |
| `raw` | `unknown` | The original input that failed validation, preserved for debugging |
| `message` | `string` | Inherited from `Error` — set to `"Schema validation failed for <schema>"` |
| `name` | `string` | Always `"SchemaValidationError"` |

### When It's Thrown

- **Record parsing** — when a parser produces records that fail `RecordSchema` validation
- **Configuration loading** — when `loadConfig()` receives invalid config data (but note: `loadConfig()` typically throws generic `Error` with a parsing message; `SchemaValidationError` is used for Zod-level validation failures)
- **Target validation** — when target-specific schema validation fails

### Catching and Inspecting

```typescript
import { SchemaValidationError } from "../domain/errors";

try {
  const records = parser.parse(content);
  // ...
} catch (error) {
  if (error instanceof SchemaValidationError) {
    console.error(`Validation failed for schema: ${error.schema}`);
    console.error(`Issues:`, error.issues);
    console.error(`Raw input:`, error.raw);

    // Inspect individual issues
    for (const issue of error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message} (${issue.code})`);
    }
  } else {
    throw error; // Re-throw unexpected error types
  }
}
```

## IdentityComputeError

**Source:** `src/domain/errors/identity-compute-error.ts`

Thrown when identity computation fails for a record. With valid records this should never happen — it indicates a bug in the `getRecordKey()` or `getRecordBody()` logic.

```typescript
class IdentityComputeError extends Error {
  constructor(
    public readonly record: Record,  // The record that caused the failure
    public readonly reason: string,  // Human-readable explanation of what went wrong
  ) {
    super(`Failed to compute identity: ${reason}`);
    this.name = "IdentityComputeError";
  }
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `record` | `Record` | The record object that caused the identity computation to fail |
| `reason` | `string` | A human-readable explanation of what went wrong |
| `message` | `string` | Inherited from `Error` — set to `"Failed to compute identity: <reason>"` |
| `name` | `string` | Always `"IdentityComputeError"` |

### When It's Thrown

- Inside `getRecordKey()` when the record identity field is missing or invalid
- Inside `getRecordBody()` when the record body cannot be derived
- These indicate a **bug** — the record should have been caught by schema validation earlier

### Catching and Inspecting

```typescript
import { IdentityComputeError } from "../domain/errors";

try {
  const key = getRecordKey(record);
} catch (error) {
  if (error instanceof IdentityComputeError) {
    console.error(`Identity computation failed for record:`);
    console.error(`  Reason: ${error.reason}`);
    console.error(`  Record:`, error.record);
    // This indicates a bug — file an issue
  }
}
```

## Error Handling in the Runner

The `Runner.onFileChange()` method in `src/application/runner.ts` implements a **catch-and-log** pattern:

```typescript
async onFileChange(filePath: string): Promise<void> {
  try {
    const content = await readFile(filePath, "utf-8");
    const records = this.parser.parse(content);
    // ... delta filter, deliver, mark delivered ...
  } catch (error) {
    console.error(error); // Errors are caught and logged, NEVER rethrown
  }
}
```

This ensures that:
- A single bad file change does not crash the watcher
- The watcher continues operating on subsequent file changes
- Both `SchemaValidationError` and `IdentityComputeError` (and any other errors) are handled uniformly

## Example: Combined Error Handling

```typescript
import { SchemaValidationError, IdentityComputeError } from "relay-gent";

function processRecords(rawContent: string): void {
  try {
    const records = parseRawContent(rawContent);

    for (const record of records) {
      const key = computeIdentity(record);
      deliverRecord(key, record);
    }
  } catch (error) {
    if (error instanceof SchemaValidationError) {
      // Invalid input — log and skip
      console.warn(`Skipping invalid records: ${error.message}`);
      for (const issue of error.issues) {
        console.warn(`  ${issue.path.join(".")}: ${issue.message}`);
      }
    } else if (error instanceof IdentityComputeError) {
      // Bug — log details for debugging
      console.error(`Identity bug: ${error.reason}`, error.record);
    } else {
      // Unexpected error — rethrow
      throw error;
    }
  }
}
```

## Import Paths

```typescript
// Via the public API
import { SchemaValidationError, IdentityComputeError } from "relay-gent";

// Direct import from source
import { SchemaValidationError } from "../domain/errors/schema-validation-error";
import { IdentityComputeError } from "../domain/errors/identity-compute-error";

// Barrel import
import { SchemaValidationError, IdentityComputeError } from "../domain/errors";
```
