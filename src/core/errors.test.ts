import { describe, expect, it } from "bun:test";
import { IdentityComputeError, SchemaValidationError } from "./errors";
import { RecordSchema } from "./record";

// ============================================================
// SchemaValidationError
// ============================================================
// Thrown when Zod schema parsing/validation fails.
// Wraps schema name, ZodIssue array, and raw input data.
// ============================================================

describe("SchemaValidationError", () => {
  it("has correct name", () => {
    const error = new SchemaValidationError("record", [], {});
    expect(error.name).toBe("SchemaValidationError");
  });

  it("has correct message format", () => {
    const error = new SchemaValidationError("config", [], {});
    expect(error.message).toBe("Schema validation failed for config");
  });

  it("has correct schema property", () => {
    const error = new SchemaValidationError("target", [], null);
    expect(error.schema).toBe("target");
  });

  it("has correct issues array", () => {
    const issues = [
      {
        code: "invalid_type" as const,
        expected: "string",
        received: "number",
        path: ["name"],
        message: "Expected string, received number",
      },
    ];
    const error = new SchemaValidationError("record", issues, {});
    expect(error.issues).toEqual(issues);
    expect(error.issues).toHaveLength(1);
  });

  it("has correct raw data", () => {
    const raw = { type: "revdiff", badField: true };
    const error = new SchemaValidationError("record", [], raw);
    expect(error.raw).toEqual(raw);
  });

  it("is instance of Error", () => {
    const error = new SchemaValidationError("record", [], {});
    expect(error).toBeInstanceOf(Error);
  });
});

// ============================================================
// IdentityComputeError
// ============================================================
// Thrown when record identity computation fails.
// Wraps the Record and a human-readable reason.
// ============================================================

describe("IdentityComputeError", () => {
  // Use a real parsed record for realistic fixture
  const sampleRecord = RecordSchema.parse({
    type: "revdiff",
    file: "src/main.ts",
    line: 42,
    annotationType: "+",
    comment: "Added missing null check",
  });

  it("has correct name", () => {
    const error = new IdentityComputeError(sampleRecord, "unsupported type");
    expect(error.name).toBe("IdentityComputeError");
  });

  it("has correct message format", () => {
    const reason = "could not extract body hash";
    const error = new IdentityComputeError(sampleRecord, reason);
    expect(error.message).toBe(`Failed to compute identity: ${reason}`);
  });

  it("has correct record property", () => {
    const error = new IdentityComputeError(sampleRecord, "unknown");
    expect(error.record).toEqual(sampleRecord);
    expect(error.record.type).toBe("revdiff");
  });

  it("has correct reason property", () => {
    const reason = "record missing required fields";
    const error = new IdentityComputeError(sampleRecord, reason);
    expect(error.reason).toBe(reason);
  });

  it("is instance of Error", () => {
    const error = new IdentityComputeError(sampleRecord, "test");
    expect(error).toBeInstanceOf(Error);
  });
});
