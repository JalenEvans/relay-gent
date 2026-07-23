/**
 * relay-gent — public API surface.
 *
 * Re-exports domain-layer modules for consumers importing from `relay-gent`:
 * - Domain records, schemas, and identity computation
 * - Configuration schema and types
 * - Parser interface and registry
 * - Adapter interface and formatter utilities
 * - Custom error types (SchemaValidationError, IdentityComputeError)
 */
export * from "./domain/record";
export * from "./domain/config";
export * from "./domain/parser";
export * from "./domain/adapter";
export * from "./domain/errors";
