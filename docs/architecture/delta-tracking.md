# Delta Tracking System

Delta tracking is the mechanism that prevents duplicate delivery of records. After a parser produces records and an adapter delivers them, the delta system persists delivery state so that subsequent runs only emit records that are **new** or **changed**.

## Architecture Overview

```
┌──────────┐   Record[]    ┌──────────────────┐   DeltaResult    ┌──────────┐
│  Parser  │ ────────────> │ DeltaTracker     │ ───────────────> │ Adapter  │
└──────────┘               │ .filter()        │                  └──────────┘
                           └────────┬─────────┘                       │
                                    │ reads                           │ delivers
                                    ▼                                 ▼
                           ┌──────────────────┐              ┌──────────────────┐
                           │   StateStore     │              │   External       │
                           │   (in-memory)    │              │   System         │
                           └────────┬─────────┘              └──────────────────┘
                                    │                                  │
                                    │ .save()                          │
                                    ▼                                  │
                           ┌──────────────────┐                        │
                           │  state.json      │ ◄──────────────────────┘
                           │  (disk)          │   DeltaTracker
                           └──────────────────┘   .markDelivered()
```

### Flow Steps

1. **Parser** produces `Record[]` from raw input
2. **DeltaTracker.filter()** classifies each record against previously delivered state stored in `StateStore`
3. **Adapter** receives `DeltaResult` and delivers only `newRecords` and `changedRecords` to the external system
4. **DeltaTracker.markDelivered()** persists delivery state for all processed records via `StateStore.set()` + `StateStore.save()`
5. On next run, `filter()` checks state from disk and skips already-delivered records

## State Shape

State is persisted as JSON at `~/.relay-gent/targets/<name>/state.json`:

```json
{
  "records": {
    "revdiff:src/main.ts:42:+": {
      "delivered_at": "2025-07-20T10:30:00.000Z",
      "hash": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2"
    },
    "json-lines:2025-07-20T10:00:00Z:INFO": {
      "delivered_at": "2025-07-20T10:30:01.000Z",
      "hash": "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
    }
  },
  "last_run": "2025-07-20T10:30:01.000Z",
  "total_delivered": 2
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `records` | `Record<string, { delivered_at: string, hash: string }>` | Map of identity strings to their delivery metadata |
| `records[key].delivered_at` | ISO 8601 string | Timestamp when the record was first delivered |
| `records[key].hash` | string | 64-character SHA-256 hex hash of the normalized record body |
| `last_run` | ISO 8601 string \| null | Timestamp of the last `save()` call |
| `total_delivered` | number | Count of unique identities ever stored (never decrements) |

## StateStore API

`StateStore` is the persistence layer. It manages an in-memory map of delivered records and atomically persists to disk.

### Constructor

```ts
constructor(name: string, baseDir?: string)
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `name` | required | Target name — used as the subdirectory under `targets/` |
| `baseDir` | `~/.relay-gent` | Root directory for state persistence |

State file path: `<baseDir>/targets/<name>/state.json`

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `load()` | `async (): Promise<void>` | Load state from disk. Initialises empty state if file is missing or corrupt. Throws on permission errors. |
| `save()` | `async (): Promise<void>` | Atomically persist to disk (write to `.tmp`, then rename). Creates target directory if needed. Updates `last_run`. |
| `clear()` | `(): void` | Reset all in-memory state to defaults. Does NOT persist to disk — call `save()` separately. |
| `get(identity)` | `(identity: string): { delivered_at: string; hash: string } \| undefined` | Retrieve a stored record by identity string. |
| `set(identity, hash)` | `(identity: string, hash: string): void` | Store a record. Increments `totalDelivered` only if the identity is new. Sets `delivered_at` to the current timestamp. |
| `getAllRecords()` | `(): Record<string, { delivered_at: string; hash: string }>` | Return a shallow copy of all stored records. |

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `totalDelivered` | `number` | Total number of unique identities ever stored |
| `lastRun` | `string \| null` | ISO timestamp of the last `save()` call, or `null` if never saved |
| `statePath` | `string` | Full path to `state.json` on disk |
| `baseDir` | `string` | Root directory for state persistence |
| `name` | `string` | Target name for this store instance |

### Usage Example

```ts
import { StateStore } from "./src/state/store";
import { DeltaTracker } from "./src/core/delta";
import { computeIdentity, computeRecordHash } from "./src/domain/record/record-identity";
import type { Record } from "./src/domain/record/record.schema";

// Initialise
const store = new StateStore("my-target");
await store.load();
const tracker = new DeltaTracker(store);

// Process records from a parser
const records: Record[] = parser.parse(rawContent);
const result = await tracker.filter(records);

console.log(result.newRecords.length);    // records never seen before
console.log(result.changedRecords.length); // records with updated content
console.log(result.unchangedCount);        // already delivered, skipped

// Deliver new/changed records to an adapter
await adapter.deliver([...result.newRecords, ...result.changedRecords]);

// Mark all as delivered
await tracker.markDelivered(records);
```

## DeltaTracker API

`DeltaTracker` is the delta classification engine. It sits on top of `StateStore` and uses identity/hash functions from `record-identity` to classify records.

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `filter(records)` | `async (records: Record[]): Promise<DeltaResult>` | Classify records as NEW, CHANGED, or UNCHANGED. Does NOT modify StateStore. |
| `markDelivered(records)` | `async (records: Record[]): Promise<void>` | Persist delivery state for each record via `store.set()` then `store.save()`. |

### DeltaResult Interface

```ts
interface DeltaResult {
  newRecords: Record[];       // Records not previously delivered
  changedRecords: Record[];   // Records with same identity but different content
  unchangedCount: number;     // Count of records already delivered with matching content
}
```

### Classification Logic

| Condition | Classification |
|-----------|---------------|
| Identity not found in StateStore | **NEW** — never delivered before |
| Identity found, hash matches stored hash | **UNCHANGED** — already delivered with same content |
| Identity found, hash differs from stored hash | **CHANGED** — same record, updated content |

### Contract Guarantees

- Input record object references are preserved in output arrays
- Order within `newRecords` and `changedRecords` matches input order
- `filter()` is read-only — it never modifies StateStore
- `markDelivered()` with an empty array is a no-op (does not throw)
- Unchanged records are never present in `newRecords` or `changedRecords`
- `newRecords.length + changedRecords.length + unchangedCount === input.length`

## Identity & Hashing

Two separate functions serve different purposes:

| Function | Purpose | Output |
|----------|---------|--------|
| `computeIdentity(record)` | Stable lookup key for StateStore | `<type>:<key>` (e.g. `"revdiff:src/main.ts:42:+"`) |
| `computeRecordHash(record)` | Content fingerprint for change detection | 64-char SHA-256 hex hash |

### Why Separate?

The identity string is the **lookup key** in the StateStore's `records` map. It must be short, stable, and deterministic for the same record source location. The hash is stored as the **value** alongside the identity and is compared on subsequent runs to detect content changes. Separating them means:

- Identity stays short and human-readable
- Hash changes don't affect the key structure
- You can inspect `state.json` and see at a glance which records were delivered

### Key Format per Record Type

| Type | Key Format | Example |
|------|-----------|---------|
| `revdiff` | `<file>:<line>:<annotationType>` | `"src/main.ts:42:+"` |
| `json-lines` | `<timestamp>:<level>` | `"2025-07-20T10:00:00Z:INFO"` |
| `markdown-headers` | `<header>` | `"Installation"` |
| `junit` | `<name>:<classname>` | `"testShouldPass:com.example.TestSuite"` |

Missing optional fields default to an empty string in the key (e.g. a json-lines record without timestamp or level produces `":"`).

### Body Source per Record Type

| Type | Body Source | Fallback |
|------|-------------|----------|
| `revdiff` | `comment` | — |
| `json-lines` | `message` | — |
| `markdown-headers` | `body` | — |
| `junit` | `failure` | `error`, then `""` |

### Normalization Pipeline

Before hashing, the body goes through a normalization pipeline to ensure records with semantically identical content produce the same hash:

```
Raw Body
   │
   ▼
1. NFC Normalization   — Unicode equivalence (e.g. cafe\u0301 → caf\u00e9)
   │
   ▼
2. CRLF → LF           — Consistent line endings
   │
   ▼
3. Trim                — Strip leading/trailing whitespace (spaces, tabs, newlines)
   │
   ▼
4. SHA-256             — 64-character hex hash via Bun.SHA256
   │
   ▼
Normalized Hash
```

This ensures:
- `"hello"` and `"  hello  "` produce the same hash
- `"line1\r\nline2"` and `"line1\nline2"` produce the same hash
- `"caf\u00e9"` (NFC) and `"cafe\u0301"` (NFD) produce the same hash

## Error Handling

### Corrupted State File

When `state.json` contains invalid JSON or has a malformed structure (e.g. `records` is `null`, an array, or missing), `load()` silently recovers to an empty state:

```ts
await store.load();
// Corrupted file → store is empty and usable
```

### Permission Errors

- **EACCES / EPERM on read**: `load()` throws a descriptive error: `"Cannot read state file at <path>: permission denied"`
- **Permission error on directory**: `load()` throws the permission error
- **Permission error on write**: `save()` propagates the filesystem error (caller should handle)

After a permission error is resolved (e.g. file permissions restored), the store is fully usable again — subsequent `load()` calls succeed.

### Missing Directory

If the target directory does not exist, `load()` treats it as empty state (ENOENT). The directory is automatically created on the next `save()` call via `mkdir(dir, { recursive: true })`.

### Atomic Write Safety

`save()` uses a write-to-then-rename pattern:

1. Write to `state.json.tmp`
2. Rename `.tmp` → `state.json`

This prevents partial/corrupt writes from being visible as `state.json`. If the process crashes mid-write, only the `.tmp` file is lost — the original `state.json` remains intact.

## Testing

### Unit Tests

| File | Coverage |
|------|----------|
| `test/unit/core/delta.test.ts` | DeltaTracker classification: fresh state, duplicate detection, modified records, mixed batches, empty input, result format contract |
| `test/unit/state/store.test.ts` | StateStore: fresh state, persistence, atomic writes, clear, directory creation, get/set, last_run, total_delivered counter, corrupted state recovery, permission errors |
| `test/unit/domain/record/record-identity.test.ts` | Identity functions: getRecordKey, getRecordBody, normalizeBody (NFC, CRLF, trim, SHA-256), computeIdentity format, computeRecordHash |

### Integration Tests

| File | Coverage |
|------|----------|
| `test/integration/delta-state-store.test.ts` | Full DeltaTracker + StateStore cycle: new → markDelivered → unchanged, edit detection across cycles, mixed-type cycles, identity uniqueness across record types |

### Running Tests

```bash
# Run all tests
bun test

# Run specific test file
bun test test/unit/core/delta.test.ts
bun test test/unit/state/store.test.ts
bun test test/unit/domain/record/record-identity.test.ts
bun test test/integration/delta-state-store.test.ts

# Run with watch mode
bun test --watch
```

## Adding a New Record Type

To add delta tracking support for a new record type, follow these steps:

### 1. Define the Schema

In `src/domain/record/record.schema.ts`:

```ts
const MyRecordSchema = BaseRecordSchema.extend({
  type: z.literal("my-type"),
  // ... fields
});
```

### 2. Register in the Union

```ts
const RecordSchema = z.discriminatedUnion("type", [
  // ...existing schemas,
  MyRecordSchema,
]);
```

### 3. Add Key Extraction

In `src/domain/record/record-identity.ts`, add a case to `getRecordKey()`:

```ts
case "my-type":
  return `${record.field1}:${record.field2}`;
```

### 4. Add Body Extraction

In `src/domain/record/record-identity.ts`, add a case to `getRecordBody()`:

```ts
case "my-type":
  return record.comment ?? "";
```

### 5. Export

Export the new schema from the barrel (`src/domain/record/index.ts`).

### 6. Test

Add test coverage:

- Add test cases to `test/unit/domain/record/record-identity.test.ts` for key/body extraction and identity/hash
- Add test cases to `test/unit/core/delta.test.ts` for classification scenarios with the new type
- Add test cases to `test/integration/delta-state-store.test.ts` for end-to-end cycles

### 7. Verify

```bash
bun test
```

Delta tracking works automatically for any record type — no changes to `StateStore`, `DeltaTracker`, or the normalization pipeline are needed.
