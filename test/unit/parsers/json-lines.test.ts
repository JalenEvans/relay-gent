import { describe, expect, it } from "bun:test";
import type { z } from "zod";
import type { JsonLinesRecordSchema } from "../../../src/domain/record/record.schema";

// ============================================================
// json-lines Parser — parses newline-delimited JSON into Records
// ============================================================
// Each non-empty line is treated as a standalone JSON object.
// Required field: message (string)
// Optional fields: timestamp, level
// Extra fields are preserved via schema .passthrough()
// Malformed lines are silently skipped.
// ============================================================

type JsonLinesRecord = z.infer<typeof JsonLinesRecordSchema>;

import { createJsonLinesParser } from "../../../src/parsers/json-lines";

// --- test data ------------------------------------------------

const validContent =
  '{"message":"hello","timestamp":"2024-01-01","level":"info"}\n' +
  '{"message":"world"}\n' +
  '{"message":"third","extra":"field"}\n';

const emptyContent = "";

const emptyLinesContent = "\n\n\n";

const malformedContent =
  "not json\n" + '{"message":"valid"}\n' + "{broken\n" + '{"message":"also valid"}\n';

const extraFieldsContent =
  '{"message":"test","custom1":"a","custom2":123,"nested":{"key":"val"}}\n';

// --- tests ----------------------------------------------------

describe("json-lines parser", () => {
  // ------------------------------------------------------------------
  // 1. Parser identity
  // ------------------------------------------------------------------
  describe("parser identity", () => {
    it('has name "json-lines"', () => {
      const parser = createJsonLinesParser();
      expect(parser.name).toBe("json-lines");
    });
  });

  // ------------------------------------------------------------------
  // 2. Valid multi-line content
  // ------------------------------------------------------------------
  describe("valid content", () => {
    it("returns an array of records from valid multi-line content", () => {
      const parser = createJsonLinesParser();
      const records = parser.parse(validContent) as JsonLinesRecord[];
      expect(Array.isArray(records)).toBe(true);
      expect(records).toHaveLength(3);
    });

    it("each record has type json-lines", () => {
      const parser = createJsonLinesParser();
      const records = parser.parse(validContent) as JsonLinesRecord[];
      for (const record of records) {
        expect(record.type).toBe("json-lines");
      }
    });

    it("each record has schemaVersion 1", () => {
      const parser = createJsonLinesParser();
      const records = parser.parse(validContent) as JsonLinesRecord[];
      for (const record of records) {
        expect(record.schemaVersion).toBe(1);
      }
    });
  });

  // ------------------------------------------------------------------
  // 3. Field extraction
  // ------------------------------------------------------------------
  describe("field extraction", () => {
    it("parses the message field from each line", () => {
      const parser = createJsonLinesParser();
      const records = parser.parse(validContent) as JsonLinesRecord[];
      expect(records[0].message).toBe("hello");
      expect(records[1].message).toBe("world");
      expect(records[2].message).toBe("third");
    });

    it("includes timestamp when present on the line", () => {
      const parser = createJsonLinesParser();
      const records = parser.parse(validContent) as JsonLinesRecord[];
      expect(records[0].timestamp).toBe("2024-01-01");
    });

    it("includes level when present on the line", () => {
      const parser = createJsonLinesParser();
      const records = parser.parse(validContent) as JsonLinesRecord[];
      expect(records[0].level).toBe("info");
    });

    it("omits timestamp and level when not on the line", () => {
      const parser = createJsonLinesParser();
      const records = parser.parse(validContent) as JsonLinesRecord[];
      // Second record: {"message":"world"} — no timestamp or level
      expect(records[1].timestamp).toBeUndefined();
      expect(records[1].level).toBeUndefined();
    });

    it("parses a line with only the message field correctly", () => {
      const parser = createJsonLinesParser();
      const records = parser.parse('{"message":"minimal"}\n') as JsonLinesRecord[];
      expect(records).toHaveLength(1);
      expect(records[0].message).toBe("minimal");
      expect(records[0].timestamp).toBeUndefined();
      expect(records[0].level).toBeUndefined();
    });
  });

  // ------------------------------------------------------------------
  // 4. Passthrough — extra fields preserved
  // ------------------------------------------------------------------
  describe("passthrough", () => {
    it("preserves extra JSON fields that are not in the schema", () => {
      const parser = createJsonLinesParser();
      const records = parser.parse(extraFieldsContent) as JsonLinesRecord[];
      expect(records).toHaveLength(1);
      expect(records[0].message).toBe("test");
      expect(records[0].custom1).toBe("a");
      expect(records[0].custom2).toBe(123);
      expect(records[0].nested).toEqual({ key: "val" });
    });

    it("preserves extra fields on multi-line content", () => {
      const parser = createJsonLinesParser();
      const records = parser.parse(validContent) as JsonLinesRecord[];
      // Third line: {"message":"third","extra":"field"}
      expect(records[2].extra).toBe("field");
    });
  });

  // ------------------------------------------------------------------
  // 5. Edge cases
  // ------------------------------------------------------------------
  describe("edge cases", () => {
    it("returns an empty array for empty content", () => {
      const parser = createJsonLinesParser();
      const records = parser.parse(emptyContent) as JsonLinesRecord[];
      expect(records).toEqual([]);
    });

    it("skips empty lines silently", () => {
      const parser = createJsonLinesParser();
      const records = parser.parse(emptyLinesContent) as JsonLinesRecord[];
      expect(records).toEqual([]);
    });

    it("skips lines with only whitespace", () => {
      const parser = createJsonLinesParser();
      const records = parser.parse("   \n  \n\t\n") as JsonLinesRecord[];
      expect(records).toEqual([]);
    });
  });

  // ------------------------------------------------------------------
  // 6. Error handling — malformed lines
  // ------------------------------------------------------------------
  describe("malformed lines", () => {
    it("skips malformed JSON lines and still parses valid lines", () => {
      const parser = createJsonLinesParser();
      const records = parser.parse(malformedContent) as JsonLinesRecord[];
      // Only lines 2 and 4 are valid: {"message":"valid"} and {"message":"also valid"}
      expect(records).toHaveLength(2);
      expect(records[0].message).toBe("valid");
      expect(records[1].message).toBe("also valid");
    });

    it("does not throw on malformed input", () => {
      const parser = createJsonLinesParser();
      expect(() => parser.parse(malformedContent)).not.toThrow();
    });

    it("handles a file where every line is malformed", () => {
      const parser = createJsonLinesParser();
      const records = parser.parse("not json\nalso not json\n{bad}\n") as JsonLinesRecord[];
      expect(records).toEqual([]);
    });
  });

  // ------------------------------------------------------------------
  // 7. Integration — multiple valid lines
  // ------------------------------------------------------------------
  describe("integration", () => {
    it("multiple valid lines produce exactly one record per line", () => {
      const parser = createJsonLinesParser();
      const content = '{"message":"a"}\n{"message":"b"}\n{"message":"c"}\n';
      const records = parser.parse(content) as JsonLinesRecord[];
      expect(records).toHaveLength(3);
      expect(records[0].message).toBe("a");
      expect(records[1].message).toBe("b");
      expect(records[2].message).toBe("c");
    });

    it("handles content without a trailing newline", () => {
      const parser = createJsonLinesParser();
      const records = parser.parse('{"message":"no trailing newline"}') as JsonLinesRecord[];
      expect(records).toHaveLength(1);
      expect(records[0].message).toBe("no trailing newline");
    });
  });
});
