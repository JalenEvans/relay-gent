import type { ZodIssue } from "zod";

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

export { SchemaValidationError };
