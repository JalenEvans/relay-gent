import { describe, expect, it } from "bun:test";
import { SchemaValidationError } from "../../../../src/domain/errors/schema-validation-error";

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
