import { z } from "zod";

// ============================================================
// Target Schemas
// ============================================================

const OpencodeTargetSchema = z.object({
  adapter: z.literal("opencode"),
  watchPath: z.string(),
  parser: z.string(),
  debounceMs: z.number().optional(),
  server_url: z.string().default("http://localhost:4096"),
  session_id: z.string().optional(),
});

const RawCommandTargetSchema = z.object({
  adapter: z.literal("raw-command"),
  watchPath: z.string(),
  parser: z.string(),
  debounceMs: z.number().optional(),
  command: z.string(),
  shell: z.boolean().default(true),
});

const CodexTargetSchema = z.object({
  adapter: z.literal("codex"),
  watchPath: z.string(),
  parser: z.string(),
  debounceMs: z.number().optional(),
  session_id: z.string().optional(),
});

const ClaudeTargetSchema = z.object({
  adapter: z.literal("claude"),
  watchPath: z.string(),
  parser: z.string(),
  debounceMs: z.number().optional(),
  session_id: z.string().optional(),
});

// ============================================================
// Discriminated Union
// ============================================================

const TargetConfigSchema = z.discriminatedUnion("adapter", [
  OpencodeTargetSchema,
  RawCommandTargetSchema,
  CodexTargetSchema,
  ClaudeTargetSchema,
]);

// ============================================================
// Config Schema
// ============================================================

const ConfigSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  defaultAdapter: z.string().default("opencode"),
  defaults: z
    .object({
      debounceMs: z.number().default(300),
      maxRetries: z.number().default(3),
      retryBackoffMs: z.number().default(1000),
    })
    .default({}),
  targets: z.record(TargetConfigSchema),
});

// ============================================================
// Types
// ============================================================

type TargetConfig = z.infer<typeof TargetConfigSchema>;
type Config = z.infer<typeof ConfigSchema>;

// ============================================================
// Exports
// ============================================================

export {
  OpencodeTargetSchema,
  RawCommandTargetSchema,
  CodexTargetSchema,
  ClaudeTargetSchema,
  TargetConfigSchema,
  ConfigSchema,
  type TargetConfig,
  type Config,
};
