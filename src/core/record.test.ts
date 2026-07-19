import { describe, expect, it } from "bun:test";
import { RecordSchema } from "./record";

// ============================================================
// RecordSchema — Zod discriminated union on `type` field
// ============================================================
// Variants:
//   - "revdiff"           (required: file, line, annotationType, comment)
//   - "json-lines"        (required: message; passthrough enabled)
//   - "markdown-headers"  (required: header, level, body)
//   - "junit"             (required: name)
//
// All variants default schemaVersion to 1.
// ============================================================

describe("RecordSchema", () => {
  // ------------------------------------------------------------------
  // 1. RevdiffRecord
  // ------------------------------------------------------------------
  describe("RevdiffRecord", () => {
    it("accepts a valid revdiff record with all fields", () => {
      const result = RecordSchema.parse({
        type: "revdiff",
        file: "src/main.ts",
        line: 42,
        annotationType: "+",
        comment: "Added missing null check",
      });
      expect(result).toMatchObject({
        type: "revdiff",
        file: "src/main.ts",
        line: 42,
        annotationType: "+",
        comment: "Added missing null check",
        schemaVersion: 1,
      });
    });

    it("accepts revdiff with optional endLine", () => {
      const result = RecordSchema.parse({
        type: "revdiff",
        file: "app.js",
        line: 10,
        endLine: 20,
        annotationType: "-",
        comment: "Removed dead code",
      });
      expect(result.endLine).toBe(20);
    });

    it("accepts file-level annotation type", () => {
      const result = RecordSchema.parse({
        type: "revdiff",
        file: "README.md",
        line: 0,
        annotationType: "file-level",
        comment: "File-level annotation",
      });
      expect(result.annotationType).toBe("file-level");
    });

    it("rejects revdiff missing required file field", () => {
      expect(() =>
        RecordSchema.parse({
          type: "revdiff",
          line: 1,
          annotationType: "+",
          comment: "missing file",
        }),
      ).toThrow();
    });

    it("rejects revdiff missing required comment field", () => {
      expect(() =>
        RecordSchema.parse({
          type: "revdiff",
          file: "f.txt",
          line: 1,
          annotationType: " ",
        }),
      ).toThrow();
    });

    it("rejects revdiff with invalid annotationType", () => {
      expect(() =>
        RecordSchema.parse({
          type: "revdiff",
          file: "f.txt",
          line: 1,
          annotationType: "unknown",
          comment: "bad annotation type",
        }),
      ).toThrow();
    });

    it("rejects revdiff with non-numeric line", () => {
      expect(() =>
        RecordSchema.parse({
          type: "revdiff",
          file: "f.txt",
          line: "abc",
          annotationType: "+",
          comment: "line should be a number",
        }),
      ).toThrow();
    });
  });

  // ------------------------------------------------------------------
  // 2. JsonLinesRecord
  // ------------------------------------------------------------------
  describe("JsonLinesRecord", () => {
    it("accepts a valid json-lines record with minimal fields", () => {
      const result = RecordSchema.parse({
        type: "json-lines",
        message: "Request completed",
      });
      expect(result).toMatchObject({
        type: "json-lines",
        message: "Request completed",
        schemaVersion: 1,
      });
    });

    it("accepts json-lines with optional timestamp and level", () => {
      const result = RecordSchema.parse({
        type: "json-lines",
        timestamp: "2024-01-15T10:30:00Z",
        level: "INFO",
        message: "User logged in",
      });
      expect(result.timestamp).toBe("2024-01-15T10:30:00Z");
      expect(result.level).toBe("INFO");
    });

    it("accepts json-lines with extra unknown fields (passthrough)", () => {
      const result = RecordSchema.parse({
        type: "json-lines",
        message: "Got it",
        extraField: "anything",
      });
      // passthrough() should allow unknown keys
      // @ts-expect-error — accessing a dynamic property
      expect(result.extraField).toBe("anything");
    });

    it("rejects json-lines missing message", () => {
      expect(() =>
        RecordSchema.parse({
          type: "json-lines",
        }),
      ).toThrow();
    });
  });

  // ------------------------------------------------------------------
  // 3. MarkdownHeadersRecord
  // ------------------------------------------------------------------
  describe("MarkdownHeadersRecord", () => {
    it("accepts a valid markdown-headers record", () => {
      const result = RecordSchema.parse({
        type: "markdown-headers",
        header: "Introduction",
        level: 2,
        body: "This is the intro section.",
      });
      expect(result).toMatchObject({
        type: "markdown-headers",
        header: "Introduction",
        level: 2,
        body: "This is the intro section.",
        schemaVersion: 1,
      });
    });

    it("rejects markdown-headers with negative level", () => {
      expect(() =>
        RecordSchema.parse({
          type: "markdown-headers",
          header: "Bad",
          level: -1,
          body: "Level cannot be negative.",
        }),
      ).toThrow();
    });

    it("rejects markdown-headers missing header", () => {
      expect(() =>
        RecordSchema.parse({
          type: "markdown-headers",
          level: 1,
          body: "no header",
        }),
      ).toThrow();
    });

    it("rejects markdown-headers missing body", () => {
      expect(() =>
        RecordSchema.parse({
          type: "markdown-headers",
          header: "Lonely",
          level: 1,
        }),
      ).toThrow();
    });
  });

  // ------------------------------------------------------------------
  // 4. JunitRecord
  // ------------------------------------------------------------------
  describe("JunitRecord", () => {
    it("accepts a minimal valid junit record", () => {
      const result = RecordSchema.parse({
        type: "junit",
        name: "testShouldPass",
      });
      expect(result).toMatchObject({
        type: "junit",
        name: "testShouldPass",
        schemaVersion: 1,
      });
    });

    it("accepts junit with all optional fields", () => {
      const result = RecordSchema.parse({
        type: "junit",
        name: "testShouldFail",
        classname: "com.example.TestSuite",
        time: 1.234,
        failure: "AssertionError",
        error: "something broke",
      });
      expect(result.classname).toBe("com.example.TestSuite");
      expect(result.time).toBe(1.234);
      expect(result.failure).toBe("AssertionError");
      expect(result.error).toBe("something broke");
    });

    it("rejects junit missing name", () => {
      expect(() =>
        RecordSchema.parse({
          type: "junit",
        }),
      ).toThrow();
    });
  });

  // ------------------------------------------------------------------
  // 5. Discriminated Union
  // ------------------------------------------------------------------
  describe("Discriminated Union", () => {
    it("rejects unknown type values", () => {
      expect(() =>
        RecordSchema.parse({
          type: "unknown",
        }),
      ).toThrow();
    });

    it("parses revdiff record as revdiff variant", () => {
      const result = RecordSchema.parse({
        type: "revdiff",
        file: "f.txt",
        line: 5,
        annotationType: "+",
        comment: "fix",
      });
      expect(result.type).toBe("revdiff");
    });

    it("parses json-lines record as json-lines variant", () => {
      const result = RecordSchema.parse({
        type: "json-lines",
        message: "hi",
      });
      expect(result.type).toBe("json-lines");
    });

    it("parses markdown-headers as markdown-headers variant", () => {
      const result = RecordSchema.parse({
        type: "markdown-headers",
        header: "Test",
        level: 1,
        body: "Body text.",
      });
      expect(result.type).toBe("markdown-headers");
    });

    it("parses junit record as junit variant", () => {
      const result = RecordSchema.parse({
        type: "junit",
        name: "t",
      });
      expect(result.type).toBe("junit");
    });
  });

  // ------------------------------------------------------------------
  // 6. schemaVersion
  // ------------------------------------------------------------------
  describe("schemaVersion", () => {
    it("defaults to 1 when not provided", () => {
      const result = RecordSchema.parse({
        type: "revdiff",
        file: "f.txt",
        line: 1,
        annotationType: "+",
        comment: "c",
      });
      expect(result.schemaVersion).toBe(1);
    });

    it("preserves explicitly set schemaVersion of 1", () => {
      const result = RecordSchema.parse({
        type: "junit",
        name: "t",
        schemaVersion: 1,
      });
      expect(result.schemaVersion).toBe(1);
    });

    it("defaults to 1 for json-lines variant", () => {
      const result = RecordSchema.parse({
        type: "json-lines",
        message: "m",
      });
      expect(result.schemaVersion).toBe(1);
    });

    it("defaults to 1 for markdown-headers variant", () => {
      const result = RecordSchema.parse({
        type: "markdown-headers",
        header: "H",
        level: 1,
        body: "B.",
      });
      expect(result.schemaVersion).toBe(1);
    });
  });

  // ------------------------------------------------------------------
  // 7. Fuzz: Malformed input
  // ------------------------------------------------------------------
  describe("Fuzz", () => {
    it("handles empty object gracefully", () => {
      expect(() => RecordSchema.parse({})).toThrow();
    });

    it("handles null gracefully", () => {
      expect(() => RecordSchema.parse(null)).toThrow();
    });

    it("handles undefined gracefully", () => {
      expect(() => RecordSchema.parse(undefined)).toThrow();
    });

    it("handles number gracefully", () => {
      expect(() => RecordSchema.parse(42)).toThrow();
    });

    it("handles string gracefully", () => {
      expect(() => RecordSchema.parse("not an object")).toThrow();
    });

    it("handles array gracefully", () => {
      expect(() => RecordSchema.parse([])).toThrow();
    });
  });
});
