# Schema Reference

Complete reference for all Zod schemas in relay-gent.

## Record Schemas

### BaseRecordSchema

Base schema extended by all record types.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `schemaVersion` | `z.literal(1)` | `1` | Always `1`; auto-applied if omitted |

### RevdiffRecordSchema

Revision diff annotations from code review or file changes.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `type` | `z.literal("revdiff")` | Yes | Discriminant |
| `file` | `z.string()` | Yes | File path |
| `line` | `z.number()` | Yes | Line number |
| `endLine` | `z.number()` | No | End line for multi-line ranges |
| `annotationType` | `z.enum(["+", "-", " ", "file-level"])` | Yes | `+` added, `-` removed, ` ` context, `file-level` file-wide |
| `comment` | `z.string()` | Yes | Annotation text |

### JsonLinesRecordSchema

Newline-delimited JSON records. Uses `.passthrough()` — unknown fields are preserved.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `type` | `z.literal("json-lines")` | Yes | Discriminant |
| `message` | `z.string()` | Yes | Log/event message |
| `timestamp` | `z.string()` | No | ISO-8601 or any string |
| `level` | `z.string()` | No | Log level (info, warn, error, etc.) |
| `*` | any | No | Extra fields preserved via `.passthrough()` |

### MarkdownHeadersRecordSchema

Parsed markdown document sections.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `type` | `z.literal("markdown-headers")` | Yes | Discriminant |
| `header` | `z.string()` | Yes | Section header text |
| `level` | `z.number().nonnegative()` | Yes | Heading level (0, 1, 2, ...) |
| `body` | `z.string()` | Yes | Section body content |

### JunitRecordSchema

JUnit XML test result entries.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `type` | `z.literal("junit")` | Yes | Discriminant |
| `name` | `z.string()` | Yes | Test name |
| `classname` | `z.string()` | No | Test class |
| `time` | `z.number()` | No | Duration in seconds |
| `failure` | `z.string()` | No | Failure message |
| `error` | `z.string()` | No | Error message |

### RecordSchema (Discriminated Union)

```ts
z.discriminatedUnion("type", [
  RevdiffRecordSchema,
  JsonLinesRecordSchema,
  MarkdownHeadersRecordSchema,
  JunitRecordSchema,
]);
```

TypeScript type: `Record` (exported from `record.schema.ts`)

---

## Config Schemas

### ConfigSchema

Top-level configuration object.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `schemaVersion` | `z.literal(1)` | `1` | Config version |
| `defaultAdapter` | `z.string()` | `"opencode"` | Fallback adapter name |
| `defaults.debounceMs` | `z.number()` | `300` | Default debounce window |
| `defaults.maxRetries` | `z.number()` | `3` | Max delivery retries |
| `defaults.retryBackoffMs` | `z.number()` | `1000` | Base backoff between retries |
| `targets` | `z.record(TargetConfigSchema)` | — | Named target configurations |

### TargetConfigSchema (Discriminated Union)

Discriminated on the `adapter` field. Each variant shares `watchPath`, `parser`, and optional `debounceMs`.

#### OpencodeTargetSchema

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `adapter` | `z.literal("opencode")` | Yes | — | Discriminant |
| `watchPath` | `z.string()` | Yes | — | File to watch |
| `parser` | `z.string()` | Yes | — | Parser name |
| `debounceMs` | `z.number()` | No | — | Override global debounce |
| `server_url` | `z.string()` | No | `"http://localhost:4096"` | opencode server URL |
| `session_id` | `z.string()` | No | — | Session identifier |

#### RawCommandTargetSchema

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `adapter` | `z.literal("raw-command")` | Yes | — | Discriminant |
| `watchPath` | `z.string()` | Yes | — | File to watch |
| `parser` | `z.string()` | Yes | — | Parser name |
| `debounceMs` | `z.number()` | No | — | Override global debounce |
| `command` | `z.string()` | Yes | — | Shell command to execute |
| `shell` | `z.boolean()` | No | `true` | Run via shell |

#### CodexTargetSchema

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `adapter` | `z.literal("codex")` | Yes | — | Discriminant |
| `watchPath` | `z.string()` | Yes | — | File to watch |
| `parser` | `z.string()` | Yes | — | Parser name |
| `debounceMs` | `z.number()` | No | — | Override global debounce |
| `session_id` | `z.string()` | No | — | Session identifier |

#### ClaudeTargetSchema

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `adapter` | `z.literal("claude")` | Yes | — | Discriminant |
| `watchPath` | `z.string()` | Yes | — | File to watch |
| `parser` | `z.string()` | Yes | — | Parser name |
| `debounceMs` | `z.number()` | No | — | Override global debounce |
| `session_id` | `z.string()` | No | — | Session identifier |
