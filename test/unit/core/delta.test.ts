import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeltaTracker } from "../../../src/core/delta";
import { computeIdentity, computeRecordHash } from "../../../src/domain/record/record-identity";
import { RecordSchema } from "../../../src/domain/record/record.schema";
import type { Record } from "../../../src/domain/record/record.schema";
import { StateStore } from "../../../src/state/store";

// ============================================================
// DeltaTracker — delta classification engine
// ============================================================
// Determines whether records are NEW, CHANGED, or UNCHANGED
// by comparing against StateStore state.
//
// API:
//   filter(records)           → DeltaResult { newRecords, changedRecords, unchangedCount }
//   markDelivered(records)    → persists delivery state
// ============================================================

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

/** Create a fresh temp directory for test isolation */
async function createTmpDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "relay-gent-test-"));
}

/** Build a valid revdiff record fixture */
function revdiffRecord(
  file: string,
  line: number,
  annotationType: "+" | "-" | " " | "file-level",
  comment: string,
): Record {
  return RecordSchema.parse({
    type: "revdiff",
    file,
    line,
    annotationType,
    comment,
  }) as Record;
}

/** Build a valid json-lines record fixture */
function jsonLinesRecord(message: string, timestamp?: string): Record {
  const base: { type: string; message: string; timestamp?: string } = {
    type: "json-lines",
    message,
  };
  if (timestamp) base.timestamp = timestamp;
  return RecordSchema.parse(base) as Record;
}

/** Build a valid markdown-headers record fixture */
function markdownHeadersRecord(header: string, body: string): Record {
  return RecordSchema.parse({
    type: "markdown-headers",
    header,
    level: 2,
    body,
  }) as Record;
}

// ------------------------------------------------------------------
// DeltaTracker — all scenarios
// ------------------------------------------------------------------

describe("DeltaTracker", () => {
  let tmpDir: string;
  let store: StateStore;
  let tracker: DeltaTracker;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
    store = new StateStore("delta-test", tmpDir);
    await store.load();
    tracker = new DeltaTracker(store);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ----------------------------------------------------------------
  // 1. Fresh state — no existing state → all records are NEW
  // ----------------------------------------------------------------
  describe("fresh state", () => {
    it("classifies all records as NEW when StateStore is empty", async () => {
      const records = [
        revdiffRecord("src/main.ts", 42, "+", "Added null check"),
        jsonLinesRecord("Request completed"),
        markdownHeadersRecord("Installation", "Run `npm install`."),
      ];

      const result = await tracker.filter(records);

      expect(result.newRecords).toHaveLength(3);
      expect(result.changedRecords).toHaveLength(0);
      expect(result.unchangedCount).toBe(0);
    });

    it("returns the original record objects in newRecords", async () => {
      const record = revdiffRecord("src/main.ts", 10, " ", "No-op comment");
      const result = await tracker.filter([record]);

      expect(result.newRecords[0]).toBe(record);
      const first = result.newRecords[0];
      if (first.type === "revdiff") {
        expect(first.file).toBe("src/main.ts");
      }
    });
  });

  // ----------------------------------------------------------------
  // 2. Duplicate run — after markDelivered(), same input → UNCHANGED
  // ----------------------------------------------------------------
  describe("duplicate detection", () => {
    it("classifies all records as UNCHANGED after markDelivered", async () => {
      const records = [
        revdiffRecord("src/main.ts", 42, "+", "Added null check"),
        jsonLinesRecord("Request completed"),
      ];

      // First pass — persist delivery state
      await tracker.filter(records);
      await tracker.markDelivered(records);

      // Second pass — same records
      const result = await tracker.filter(records);

      expect(result.newRecords).toHaveLength(0);
      expect(result.changedRecords).toHaveLength(0);
      expect(result.unchangedCount).toBe(2);
    });

    it("classifies a subset as unchanged when partially delivered", async () => {
      const recordA = revdiffRecord("a.ts", 1, "+", "Change A");
      const recordB = revdiffRecord("b.ts", 2, "-", "Change B");

      // Deliver only record A
      await tracker.filter([recordA]);
      await tracker.markDelivered([recordA]);

      // Filter both
      const result = await tracker.filter([recordA, recordB]);

      expect(result.newRecords).toHaveLength(1);
      expect(result.newRecords[0]).toBe(recordB);
      expect(result.changedRecords).toHaveLength(0);
      expect(result.unchangedCount).toBe(1);
    });
  });

  // ----------------------------------------------------------------
  // 3. Modified record — same identity, different body hash → CHANGED
  // ----------------------------------------------------------------
  describe("modified records", () => {
    it("classifies a record as CHANGED when body content differs", async () => {
      const original = revdiffRecord("src/main.ts", 42, "+", "Original comment");
      const updated = revdiffRecord("src/main.ts", 42, "+", "Updated comment");

      // Deliver the original
      await tracker.filter([original]);
      await tracker.markDelivered([original]);

      // Now check the updated version
      const result = await tracker.filter([updated]);

      expect(result.newRecords).toHaveLength(0);
      expect(result.changedRecords).toHaveLength(1);
      expect(result.changedRecords[0]).toBe(updated);
      expect(result.unchangedCount).toBe(0);
    });

    it("detects changes in json-lines message", async () => {
      const original = jsonLinesRecord("First message");
      const updated = jsonLinesRecord("Different message");

      await tracker.filter([original]);
      await tracker.markDelivered([original]);

      const result = await tracker.filter([updated]);

      expect(result.changedRecords).toHaveLength(1);
      expect(result.changedRecords[0]).toBe(updated);
    });

    it("detects changes in markdown-headers body", async () => {
      const original = markdownHeadersRecord("Section", "Original body");
      const updated = markdownHeadersRecord("Section", "Updated body");

      await tracker.filter([original]);
      await tracker.markDelivered([original]);

      const result = await tracker.filter([updated]);

      expect(result.changedRecords).toHaveLength(1);
      expect(result.changedRecords[0]).toBe(updated);
    });

    it("does not classify as changed when only whitespace differs", async () => {
      const original = revdiffRecord("f.ts", 1, "+", "Same comment");
      const whitespace = revdiffRecord("f.ts", 1, "+", "  Same comment  ");

      await tracker.filter([original]);
      await tracker.markDelivered([original]);

      const result = await tracker.filter([whitespace]);

      // Normalization should make these identical — unchanged
      expect(result.changedRecords).toHaveLength(0);
      expect(result.unchangedCount).toBe(1);
    });

    it("does not classify as changed when Unicode NFC/NFD varies", async () => {
      const nfcRecord = RecordSchema.parse({
        type: "revdiff",
        file: "cafe.ts",
        line: 1,
        annotationType: "+",
        comment: "caf\u00e9", // NFC: é as single codepoint
      }) as Record;

      const nfdRecord = RecordSchema.parse({
        type: "revdiff",
        file: "cafe.ts",
        line: 1,
        annotationType: "+",
        comment: "cafe\u0301", // NFD: e + combining acute accent
      }) as Record;

      await tracker.filter([nfcRecord]);
      await tracker.markDelivered([nfcRecord]);

      const result = await tracker.filter([nfdRecord]);

      // Normalization should make these identical — unchanged
      expect(result.changedRecords).toHaveLength(0);
      expect(result.unchangedCount).toBe(1);
    });
  });

  // ----------------------------------------------------------------
  // 4. Mixed batch — some new, some changed, some unchanged
  // ----------------------------------------------------------------
  describe("mixed batch", () => {
    it("correctly groups new, changed, and unchanged records", async () => {
      const existing = revdiffRecord("existing.ts", 1, "+", "Already delivered");
      const toModify = jsonLinesRecord("Will be updated");

      // Deliver a baseline set
      await tracker.filter([existing, toModify]);
      await tracker.markDelivered([existing, toModify]);

      // Now process a mixed batch
      const same = existing; // unchanged
      const modified = jsonLinesRecord("Updated content"); // changed
      const brandNew = markdownHeadersRecord("New", "Brand new record"); // new

      const result = await tracker.filter([same, modified, brandNew]);

      expect(result.newRecords).toHaveLength(1);
      expect(result.newRecords[0]).toBe(brandNew);

      expect(result.changedRecords).toHaveLength(1);
      expect(result.changedRecords[0]).toBe(modified);

      expect(result.unchangedCount).toBe(1);
    });

    it("preserves record order in output arrays", async () => {
      const old = revdiffRecord("old.ts", 1, "+", "Old");
      await tracker.filter([old]);
      await tracker.markDelivered([old]);

      const new1 = revdiffRecord("new1.ts", 1, "+", "New one");
      const changed = revdiffRecord("old.ts", 1, "+", "Changed content");
      const new2 = revdiffRecord("new2.ts", 1, "+", "New two");

      const result = await tracker.filter([new1, changed, new2]);

      // newRecords should contain new1, new2 in order
      expect(result.newRecords[0]).toBe(new1);
      expect(result.newRecords[1]).toBe(new2);

      // changedRecords should contain the modified record
      expect(result.changedRecords[0]).toBe(changed);
    });
  });

  // ----------------------------------------------------------------
  // 5. Empty input — empty record array → no changes
  // ----------------------------------------------------------------
  describe("empty input", () => {
    it("returns empty result for empty record array", async () => {
      const result = await tracker.filter([]);

      expect(result.newRecords).toEqual([]);
      expect(result.changedRecords).toEqual([]);
      expect(result.unchangedCount).toBe(0);
    });

    it("markDelivered handles empty array gracefully", async () => {
      // Should not throw
      await tracker.markDelivered([]);

      const result = await tracker.filter([]);
      expect(result.newRecords).toEqual([]);
      expect(result.changedRecords).toEqual([]);
      expect(result.unchangedCount).toBe(0);
    });
  });

  // ----------------------------------------------------------------
  // 6. Return format — filter() contract verification
  // ----------------------------------------------------------------
  describe("return format", () => {
    it("returns only new and changed records in arrays", async () => {
      const delivered = revdiffRecord("delivered.ts", 1, "+", "Delivered");
      const toChange = jsonLinesRecord("To change");
      const completelyNew = markdownHeadersRecord("NewSection", "Fresh");

      await tracker.filter([delivered, toChange]);
      await tracker.markDelivered([delivered, toChange]);

      const modified = jsonLinesRecord("Changed");
      const result = await tracker.filter([delivered, modified, completelyNew]);

      // Arrays should contain only new and changed (not the unchanged one)
      expect(result.newRecords.map((r) => computeIdentity(r))).toEqual([
        computeIdentity(completelyNew),
      ]);
      expect(result.changedRecords.map((r) => computeIdentity(r))).toEqual([
        computeIdentity(modified),
      ]);
      // Unchanged count should be 1
      expect(result.unchangedCount).toBe(1);
      // Combined total should equal input length
      expect(result.newRecords.length + result.changedRecords.length + result.unchangedCount).toBe(
        3,
      );
    });

    it("unchanged records are never present in newRecords or changedRecords", async () => {
      const record = revdiffRecord("stable.ts", 5, "+", "Stable record");

      // Two full cycles
      await tracker.filter([record]);
      await tracker.markDelivered([record]);

      const result = await tracker.filter([record]);

      expect(result.newRecords).not.toContain(record);
      expect(result.changedRecords).not.toContain(record);
      expect(result.unchangedCount).toBe(1);
    });

    it("DeltaResult shape has all required fields", async () => {
      const record = revdiffRecord("shape.ts", 1, "+", "Shape test");
      const result = await tracker.filter([record]);

      expect(result).toHaveProperty("newRecords");
      expect(result).toHaveProperty("changedRecords");
      expect(result).toHaveProperty("unchangedCount");
      expect(Array.isArray(result.newRecords)).toBe(true);
      expect(Array.isArray(result.changedRecords)).toBe(true);
      expect(typeof result.unchangedCount).toBe("number");
    });
  });
});
