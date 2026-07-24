/**
 * relay-gent — public API surface.
 *
 * Re-exports domain-layer modules for consumers:
 * - Domain records, schemas, and identity computation
 * - Parser interface and registry
 * - Custom error types (SchemaValidationError, IdentityComputeError)
 * - MCP server and components
 * - Watcher manager
 */
export * from "./domain/record";
export * from "./domain/parser";
export * from "./domain/errors";
export { createApp } from "./mcp/server.js";
export type { AppComponents } from "./mcp/server.js";
export { WatcherManager } from "./watcher/index.js";
export type { WatcherState } from "./watcher/types.js";
export { RecordStore } from "./state/record-store.js";
