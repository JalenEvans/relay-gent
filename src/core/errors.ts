import type { ZodIssue } from "zod";
import type { Record } from "./record";

/**
 * SchemaValidationError — wraps Zod validation failures in a domain-specific error.
 *
 * Used when record parsing, config loading, or target validation fails.
 */
class SchemaValidationError extends Error {
  constructor(
    public readonly schema: string,
    public readonly issues: ZodIssue[],
    public readonly raw: unknown,
  ) {
    super(`Schema validation failed for ${schema}`);
    this.name = "SchemaValidationError";
  }
}

/**
 * IdentityComputeError — raised when identity computation fails.
 *
 * Should never happen with valid records; indicates a bug in the
 * getRecordKey/getRecordBody logic.
 */
class IdentityComputeError extends Error {
  constructor(
    public readonly record: Record,
    public readonly reason: string,
  ) {
    super(`Failed to compute identity: ${reason}`);
    this.name = "IdentityComputeError";
  }
}

export { SchemaValidationError, IdentityComputeError };
