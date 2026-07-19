import { describe, expect, it } from "bun:test";
import { IdentityComputeError } from "../../../../src/domain/errors/identity-compute-error";
import { RecordSchema } from "../../../../src/domain/record/record.schema";

describe("IdentityComputeError", () => {
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
