import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeltaTracker } from "../../src/core/delta";
import { StateStore } from "../../src/state/store";
import { RecordSchema } from "../../src/domain/record/record.schema";
import { computeIdentity } from "../../src/domain/record/record-identity";
import type { Record } from "../../src/domain/record/record.schema";

// ============================================================
// Integration: DeltaTracker + StateStore working together
// ============================================================
// Exercises the full cycle:
//   parse → filter → markDelivered → filter again
// across different record types and content changes.
// ============================================================

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

/** Create a fresh temp directory for test isolation */
async function createTmpDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "relay-gent-integration-"));
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
function jsonLinesRecord(
  message: string,
  timestamp?: string,
  level?: string,
): Record {
  return RecordSchema.parse({
    type: "json-lines",
    message,
    ...(timestamp ? { timestamp } : {}),
    ...(level ? { level } : {}),
  }) as Record;
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
// Tests
// ------------------------------------------------------------------

describe("DeltaTracker + StateStore integration", () => {
  let tmpDir: string;
  let store: StateStore;
  let tracker: DeltaTracker;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
    store = new StateStore("integration-test", tmpDir);
    await store.load();
    tracker = new DeltaTracker(store);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ----------------------------------------------------------------
  // 1. Full cycle — all new → markDelivered → all unchanged
  // ----------------------------------------------------------------
  describe("full delivery cycle", () => {
    it("all records are NEW on first pass, UNCHANGED on second", async () => {
      const records = [
        revdiffRecord("src/main.ts", 42, "+", "Added null check"),
        jsonLinesRecord("Server started", "2024-01-15T10:00:00Z", "info"),
        markdownHeadersRecord("Installation", "Run `npm install`."),
      ];

      // First pass — all should be NEW
      const firstPass = await tracker.filter(records);
      expect(firstPass.newRecords).toHaveLength(3);
      expect(firstPass.changedRecords).toHaveLength(0);
      expect(firstPass.unchangedCount).toBe(0);

      // Mark all as delivered
      await tracker.markDelivered(records);

      // Second pass — same records, all should be UNCHANGED
      const secondPass = await tracker.filter(records);
      expect(secondPass.newRecords).toHaveLength(0);
      expect(secondPass.changedRecords).toHaveLength(0);
      expect(secondPass.unchangedCount).toBe(3);
    });

    it("preserves record identity across load/save/filter cycle", async () => {
      const record = revdiffRecord("src/main.ts", 10, "-", "Remove debug log");

      // Filter → markDelivered → new store instance → filter
      await tracker.filter([record]);
      await tracker.markDelivered([record]);

      // Fresh store instance
      const store2 = new StateStore("integration-test", tmpDir);
      await store2.load();
      const tracker2 = new DeltaTracker(store2);

      const result = await tracker2.filter([record]);
      expect(result.newRecords).toHaveLength(0);
      expect(result.changedRecords).toHaveLength(0);
      expect(result.unchangedCount).toBe(1);
    });

    it("totalDelivered persists across instances after markDelivered", async () => {
      const records = [
        revdiffRecord("a.ts", 1, "+", "A"),
        revdiffRecord("b.ts", 2, "-", "B"),
        revdiffRecord("c.ts", 3, " ", "C"),
      ];

      await tracker.filter(records);
      await tracker.markDelivered(records);

      const store2 = new StateStore("integration-test", tmpDir);
      await store2.load();
      expect(store2.totalDelivered).toBe(3);
    });
  });

  // ----------------------------------------------------------------
  // 2. Edit detection — change content between runs
  // ----------------------------------------------------------------
  describe("edit detection across cycles", () => {
    it("detects a single edited record, keeps others unchanged", async () => {
      const originalRecords = [
        revdiffRecord("src/main.ts", 42, "+", "Original comment"),
        jsonLinesRecord("Request received", "2024-01-15T12:00:00Z", "debug"),
        markdownHeadersRecord("Usage", "Run `relay-gent --help`."),
      ];

      // First pass
      await tracker.filter(originalRecords);
      await tracker.markDelivered(originalRecords);

      // Edit the revdiff comment
      const editedRecords: Record[] = [
        revdiffRecord("src/main.ts", 42, "+", "Updated comment"), // changed
        jsonLinesRecord("Request received", "2024-01-15T12:00:00Z", "debug"), // unchanged
        markdownHeadersRecord("Usage", "Run `relay-gent --help`."), // unchanged
      ];

      const result = await tracker.filter(editedRecords);

      expect(result.newRecords).toHaveLength(0);
      expect(result.changedRecords).toHaveLength(1);
      expect(result.changedRecords[0]).toBe(editedRecords[0]);
      expect(result.unchangedCount).toBe(2);
    });

    it("detects changes across all three record types", async () => {
      const baseline = [
        revdiffRecord("f.ts", 1, "+", "v1"),
        jsonLinesRecord("msg1", "2024-01-01T00:00:00Z", "info"),
        markdownHeadersRecord("Header", "body v1"),
      ];

      await tracker.filter(baseline);
      await tracker.markDelivered(baseline);

      // Change all three
      const updated = [
        revdiffRecord("f.ts", 1, "+", "v2"), // changed
        jsonLinesRecord("msg2", "2024-01-01T00:00:00Z", "info"), // changed (message differs)
        markdownHeadersRecord("Header", "body v2"), // changed
      ];

      const result = await tracker.filter(updated);

      expect(result.newRecords).toHaveLength(0);
      expect(result.changedRecords).toHaveLength(3);
      expect(result.unchangedCount).toBe(0);

      // Identities should match
      const changedIdentities = result.changedRecords.map((r) => computeIdentity(r));
      expect(changedIdentities).toEqual([
        computeIdentity(updated[0]),
        computeIdentity(updated[1]),
        computeIdentity(updated[2]),
      ]);
    });
  });

  // ----------------------------------------------------------------
  // 3. Mixed types — full integration cycle
  // ----------------------------------------------------------------
  describe("mixed-type integration cycle", () => {
    it("handles revdiff, json-lines, and markdown-headers in one cycle", async () => {
      // First batch — mix of all types
      const batch1 = [
        revdiffRecord("src/a.ts", 1, "+", "Add feature A"),
        jsonLinesRecord("Deploy started", "2024-06-01T08:00:00Z", "info"),
        markdownHeadersRecord("Setup", "Step 1: configure"),
        revdiffRecord("src/b.ts", 5, "-", "Remove old code"),
      ];

      const result1 = await tracker.filter(batch1);
      expect(result1.newRecords).toHaveLength(4);
      expect(result1.changedRecords).toHaveLength(0);
      expect(result1.unchangedCount).toBe(0);

      await tracker.markDelivered(batch1);

      // Second batch — some new, some changed, some unchanged
      const unchangedRevdiff = revdiffRecord("src/a.ts", 1, "+", "Add feature A");
      const changedJsonLines = jsonLinesRecord(
        "Deploy completed",
        "2024-06-01T08:00:00Z",
        "info",
      );
      const unchangedMarkdown = markdownHeadersRecord("Setup", "Step 1: configure");
      const newRevdiff = revdiffRecord("src/c.ts", 10, "file-level", "New file annotation");

      const batch2 = [unchangedRevdiff, changedJsonLines, unchangedMarkdown, newRevdiff];

      const result2 = await tracker.filter(batch2);

      expect(result2.newRecords).toHaveLength(1);
      expect(result2.newRecords[0]).toBe(newRevdiff);

      expect(result2.changedRecords).toHaveLength(1);
      expect(result2.changedRecords[0]).toBe(changedJsonLines);

      expect(result2.unchangedCount).toBe(2);
    });

    it("rejects records with different types at the same identity key", async () => {
      // A revdiff and a json-lines with same "file:line" pattern won't collide
      // because identities are prefixed with type. Verify identity uniqueness.
      const rev = revdiffRecord("shared-key", 1, "+", "revdiff content");
      const json = jsonLinesRecord("json content", "shared-key", "info");

      const revIdentity = computeIdentity(rev);
      const jsonIdentity = computeIdentity(json);

      // Different types → different identities even if keys overlap
      expect(revIdentity).not.toBe(jsonIdentity);

      // Both can be delivered independently
      await tracker.filter([rev, json]);
      await tracker.markDelivered([rev, json]);

      // Verify both are now UNCHANGED
      const check = await tracker.filter([rev, json]);
      expect(check.newRecords).toHaveLength(0);
      expect(check.changedRecords).toHaveLength(0);
      expect(check.unchangedCount).toBe(2);
    });
  });
});
