import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { z } from "zod";
import type { JsonLinesRecordSchema } from "../../src/domain/record/record.schema";
import { registry } from "../../src/parsers/index";
import { createJsonLinesParser } from "../../src/parsers/json-lines";

type JsonLinesRecord = z.infer<typeof JsonLinesRecordSchema>;

// ============================================================
// integration: json-lines parser with NDJSON fixtures + registry
// ============================================================
// Loads each fixture file from disk, parses with the real parser,
// and verifies the output matches expected behavior.
//
// Also tests the shared registry from src/parsers/index.
// ============================================================

// --- fixture loader ------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "../fixtures/json-lines");

function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf-8");
}

// --- tests ---------------------------------------------------

describe("parser integration with ndjson fixtures", () => {
  // ------------------------------------------------------------------
  // 1. valid.ndjson — happy path
  // ------------------------------------------------------------------
  describe("valid.ndjson", () => {
    it("produces 3 records", () => {
      const parser = createJsonLinesParser();
      const records = parser.parse(loadFixture("valid.ndjson")) as JsonLinesRecord[];
      expect(records).toHaveLength(3);
    });

    it("records have correct message values", () => {
      const parser = createJsonLinesParser();
      const records = parser.parse(loadFixture("valid.ndjson")) as JsonLinesRecord[];
      expect(records[0].message).toBe("Server started");
      expect(records[1].message).toBe("Request received");
      expect(records[2].message).toBe("Disk space low");
    });

    it("records have type 'json-lines'", () => {
      const parser = createJsonLinesParser();
      const records = parser.parse(loadFixture("valid.ndjson")) as JsonLinesRecord[];
      for (const record of records) {
        expect(record.type).toBe("json-lines");
      }
    });

    it("records have schemaVersion 1", () => {
      const parser = createJsonLinesParser();
      const records = parser.parse(loadFixture("valid.ndjson")) as JsonLinesRecord[];
      for (const record of records) {
        expect(record.schemaVersion).toBe(1);
      }
    });

    it("records preserve timestamp and level fields", () => {
      const parser = createJsonLinesParser();
      const records = parser.parse(loadFixture("valid.ndjson")) as JsonLinesRecord[];
      expect(records[0].timestamp).toBe("2024-01-15T10:00:00Z");
      expect(records[0].level).toBe("info");
      expect(records[1].level).toBe("debug");
      expect(records[2].level).toBe("warn");
    });
  });

  // ------------------------------------------------------------------
  // 2. empty.ndjson — edge case
  // ------------------------------------------------------------------
  describe("empty.ndjson", () => {
    it("produces an empty array", () => {
      const parser = createJsonLinesParser();
      const records = parser.parse(loadFixture("empty.ndjson")) as JsonLinesRecord[];
      expect(records).toEqual([]);
    });
  });

  // ------------------------------------------------------------------
  // 3. malformed.ndjson — error handling
  // ------------------------------------------------------------------
  describe("malformed.ndjson", () => {
    it("returns only valid records (2 records)", () => {
      const parser = createJsonLinesParser();
      const records = parser.parse(loadFixture("malformed.ndjson")) as JsonLinesRecord[];
      expect(records).toHaveLength(2);
    });

    it("valid records have correct messages", () => {
      const parser = createJsonLinesParser();
      const records = parser.parse(loadFixture("malformed.ndjson")) as JsonLinesRecord[];
      expect(records[0].message).toBe("good line");
      expect(records[1].message).toBe("another good line");
    });

    it("valid records still have type and schemaVersion", () => {
      const parser = createJsonLinesParser();
      const records = parser.parse(loadFixture("malformed.ndjson")) as JsonLinesRecord[];
      expect(records[0].type).toBe("json-lines");
      expect(records[0].schemaVersion).toBe(1);
    });
  });

  // ------------------------------------------------------------------
  // 4. with-extra-fields.ndjson — passthrough
  // ------------------------------------------------------------------
  describe("with-extra-fields.ndjson", () => {
    it("preserves extra fields on the enriched record", () => {
      const parser = createJsonLinesParser();
      const records = parser.parse(loadFixture("with-extra-fields.ndjson")) as JsonLinesRecord[];
      expect(records).toHaveLength(2);
      expect(records[0].source).toBe("api");
      expect(records[0].requestId).toBe("abc-123");
      expect(records[0].tags).toEqual(["auth", "login"]);
    });

    it("parses the minimal record correctly", () => {
      const parser = createJsonLinesParser();
      const records = parser.parse(loadFixture("with-extra-fields.ndjson")) as JsonLinesRecord[];
      expect(records[1].message).toBe("minimal record");
      expect(records[1].timestamp).toBeUndefined();
      expect(records[1].level).toBeUndefined();
    });
  });
});

// ------------------------------------------------------------------
// 5. Registry integration
// ------------------------------------------------------------------
describe("parser registry integration", () => {
  it("getParser('json-lines') returns a parser", () => {
    const parser = registry.getParser("json-lines");
    expect(parser).toBeDefined();
    expect(parser.name).toBe("json-lines");
    expect(typeof parser.parse).toBe("function");
  });

  it("getParser('unknown') throws Error", () => {
    expect(() => registry.getParser("unknown")).toThrow(Error);
  });

  it("getParser('unknown') throws with a message including the name", () => {
    expect(() => registry.getParser("bogus")).toThrow("bogus");
  });

  it("listParsers includes 'json-lines'", () => {
    const names = registry.listParsers();
    expect(names).toContain("json-lines");
  });
});
