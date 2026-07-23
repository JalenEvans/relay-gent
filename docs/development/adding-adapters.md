# Adding an Adapter

Step-by-step guide to implementing a new adapter for relay-gent.

## 1. Choose an Adapter Name

Use kebab-case. Examples: `opencode`, `claude`, `codex`, `raw-command`, `slack`

## 2. Add the Target Schema

Add a new target schema to `src/domain/config/config.schema.ts`:

```ts
const SlackTargetSchema = z.object({
  adapter: z.literal("slack"),
  watchPath: z.string(),
  parser: z.string(),
  debounceMs: z.number().optional(),
  webhook_url: z.string(),
  channel: z.string().optional(),
});
```

**Required fields:**
- `adapter: z.literal("your-name")` — discriminant for the union
- `watchPath: z.string()` — file to watch (shared across all targets)
- `parser: z.string()` — parser name to use (shared across all targets)

**Optional fields:**
- `debounceMs: z.number().optional()` — override global debounce
- Any adapter-specific fields (e.g., `webhook_url`, `session_id`, `command`)

## 3. Add to the Discriminated Union

Add your schema to the `TargetConfigSchema` union in the same file:

```ts
const TargetConfigSchema = z.discriminatedUnion("adapter", [
  OpencodeTargetSchema,
  RawCommandTargetSchema,
  CodexTargetSchema,
  ClaudeTargetSchema,
  SlackTargetSchema,  // <-- add here
]);
```

## 4. Create the Adapter File

Create `src/adapters/<name>.ts`:

```ts
import type { Adapter } from "../domain/adapter/adapter.interface";
import type { TargetConfig } from "../domain/config/config.schema";
import type { Record } from "../domain/record/record.schema";

function createSlackAdapter(): Adapter {
  return {
    name: "slack",

    async deliver(batch: Record[], ctx: TargetConfig): Promise<string[]> {
      // ctx is typed as the discriminated union — narrow with adapter check
      if (ctx.adapter !== "slack") {
        throw new Error("Invalid adapter type");
      }

      // ctx.webhook_url is now guaranteed to exist

      // Implement delivery logic:
      // - Format records for the target
      // - Send via HTTP, shell, or SDK
      // - Return array of delivered IDs

      return batch.map((_, i) => `slack-${Date.now()}-${i}`);
    },

    async ready(ctx: TargetConfig): Promise<boolean> {
      // Optional: verify connection before starting watch loop
      // e.g., ping the webhook URL, check auth tokens
      return true;
    },
  };
}

export { createSlackAdapter };
```

**Key points:**
- `deliver()` receives the full `Record[]` batch and the target config
- `ctx` is a discriminated union — narrow with `ctx.adapter === "your-name"` to access adapter-specific fields
- Return `DeliveredId[]` (strings) for tracking
- `ready()` is optional but recommended for connection validation

## 5. Register via the Resolution Function

Unlike parsers (which use a `ParserRegistry` with a Map lookup), adapters use a **hardcoded resolution function** in `src/cli.ts` and `src/runner-worker.ts`. To register a new adapter:

### 5a. Export from the barrel

Add your adapter export to `src/adapters/index.ts`:

```ts
export { RawCommandAdapter } from "./raw-command";
export { createSlackAdapter } from "./slack";        // <-- add here
```

### 5b. Update the resolution function

Add your adapter to the `resolveAdapter()` function (found in both `src/cli.ts` and `src/runner-worker.ts`):

```ts
function resolveAdapter(name: string): Adapter | undefined {
  switch (name) {
    case "raw-command":
      return new RawCommandAdapter();
    case "slack":                                    // <-- add here
      return createSlackAdapter();                   // <-- add here
    case "opencode":
    case "codex":
    case "claude":
      return { name, deliver: /* ... */ };
    default:
      return undefined;
  }
}
```

> **Note:** This hardcoded switch-based resolution is a known architectural limitation. Unlike parsers, adapters do not currently use a Map-based registry. Adding a new adapter requires updating the `resolveAdapter()` function in **both** `cli.ts` and `runner-worker.ts`. A formal adapter registry (similar to `ParserRegistry`) is planned for future work to eliminate this duplication.

## 6. Write Tests

**Unit tests** in `test/unit/adapters/<name>.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { createSlackAdapter } from "../../../src/adapters/slack";

describe("slack adapter", () => {
  it("has correct name", () => {
    const adapter = createSlackAdapter();
    expect(adapter.name).toBe("slack");
  });

  it("deliver returns delivered IDs", async () => {
    const adapter = createSlackAdapter();
    const batch = [/* ...records... */];
    const ctx = { adapter: "slack", watchPath: "test.log", parser: "json-lines", webhook_url: "https://hooks.slack.com/..." };
    const ids = await adapter.deliver(batch, ctx);
    expect(ids.length).toBe(batch.length);
  });
});
```

**Config tests** in `test/unit/domain/config/config.schema.test.ts`:

```ts
it("accepts valid slack target", () => {
  const result = ConfigSchema.parse({
    targets: {
      notifications: {
        adapter: "slack",
        watchPath: "app.log",
        parser: "json-lines",
        webhook_url: "https://hooks.slack.com/services/...",
      },
    },
  });
  expect(result.targets.notifications).toMatchObject({ adapter: "slack" });
});

it("rejects slack target missing webhook_url", () => {
  expect(() =>
    ConfigSchema.parse({
      targets: {
        bad: { adapter: "slack", watchPath: "x", parser: "json-lines" },
      },
    }),
  ).toThrow();
});
```

## 7. Verify

```bash
bun test
bunx tsc --noEmit
bunx biome check src/
```
