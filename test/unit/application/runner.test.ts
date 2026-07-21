import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ============================================================
// Runner — orchestrator for file-change processing pipeline
// ============================================================
// Accepts a TargetConfig, Parser, Adapter, DeltaTracker, and
// StateStore, then exposes onFileChange() and stop().
//
// Phase 1 tests: constructor acceptance + method shape.
// ============================================================

// ------------------------------------------------------------------
// Imports (these will fail until Runner is implemented — RED phase)
// ------------------------------------------------------------------

import { Runner } from "../../../src/application/runner";
import type { Adapter } from "../../../src/domain/adapter/adapter.interface";
import { TargetConfigSchema } from "../../../src/domain/config/config.schema";
import type { TargetConfig } from "../../../src/domain/config/config.schema";
import type { Parser } from "../../../src/domain/parser/parser.interface";
import { RecordSchema, type Record } from "../../../src/domain/record/record.schema";
import { computeIdentity, computeRecordHash } from "../../../src/domain/record/record-identity";
import { DeltaTracker } from "../../../src/core/delta";
import { StateStore } from "../../../src/state/store";

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

/** Create a fresh temp directory for test isolation */
async function createTmpDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "relay-gent-test-"));
}

/** Build a minimal valid TargetConfig for testing */
function testConfig(overrides?: Partial<TargetConfig>): TargetConfig {
  return TargetConfigSchema.parse({
    adapter: "opencode",
    watchPath: "/tmp/test-file.md",
    parser: "revdiff",
    server_url: "http://localhost:4096",
    ...overrides,
  }) as TargetConfig;
}

// ------------------------------------------------------------------
// Mocks
// ------------------------------------------------------------------

/** Stub Parser — returns empty records by default */
const mockParser: Parser = {
  name: "test-parser",
  parse: (_content: string): Record[] => [],
};

/** Stub Adapter — returns mock delivery IDs */
const mockAdapter: Adapter = {
  name: "test-adapter",
  deliver: async (_batch: Record[], _ctx: TargetConfig) =>
    _batch.map((_, i) => `mock-delivery-${i}`),
  ready: async (_ctx: TargetConfig) => true,
};

// ------------------------------------------------------------------
// Runner — constructor + shape
// ------------------------------------------------------------------

describe("Runner", () => {
  let tmpDir: string;
  let store: StateStore;
  let tracker: DeltaTracker;
  let config: TargetConfig;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
    store = new StateStore("runner-test", tmpDir);
    await store.load();
    tracker = new DeltaTracker(store);
    config = testConfig();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ----------------------------------------------------------------
  // 1. Constructor — accepts all dependencies without error
  // ----------------------------------------------------------------
  describe("constructor", () => {
    it("creates an instance without throwing", () => {
      const runner = new Runner(config, mockParser, mockAdapter, tracker, store);
      expect(runner).toBeDefined();
      expect(runner).toBeInstanceOf(Runner);
    });

    it("stores the provided config", () => {
      const runner = new Runner(config, mockParser, mockAdapter, tracker, store);
      // The Runner should expose the config (public or via getter).
      // If config is private, this assertion still works at runtime
      // and will guide the GREEN implementation to expose it.
      expect(runner).toHaveProperty("config");
      expect(runner.config).toEqual(config);
    });
  });

  // ----------------------------------------------------------------
  // 2. Method shape — public API surface
  // ----------------------------------------------------------------
  describe("methods", () => {
    it("onFileChange exists as a method", () => {
      const runner = new Runner(config, mockParser, mockAdapter, tracker, store);
      expect(runner.onFileChange).toBeDefined();
      expect(typeof runner.onFileChange).toBe("function");
    });

    it("stop exists as a method", () => {
      const runner = new Runner(config, mockParser, mockAdapter, tracker, store);
      expect(runner.stop).toBeDefined();
      expect(typeof runner.stop).toBe("function");
    });
  });

  // ----------------------------------------------------------------
  // 3. onFileChange — full pipeline (reads → parses → filters → delivers → marks)
  // ----------------------------------------------------------------
  describe("onFileChange", () => {
    // ------------------------------------------------------------------
    // Test 1: Happy path — read, parse, filter, deliver, mark delivered
    // ------------------------------------------------------------------
    it("reads file, parses, filters, delivers, and marks delivered", async () => {
      const content = "test file content\nwith multiple lines\n";
      const filePath = join(tmpDir, "source.md");
      await writeFile(filePath, content, "utf-8");

      const expectedRecords: Record[] = [
        RecordSchema.parse({
          type: "revdiff",
          file: "src/main.ts",
          line: 42,
          annotationType: "+",
          comment: "first record",
        }) as Record,
        RecordSchema.parse({
          type: "revdiff",
          file: "src/utils.ts",
          line: 10,
          annotationType: "-",
          comment: "second record",
        }) as Record,
      ];

      let parsedContent = "";
      const parser: Parser = {
        name: "test-parser",
        parse: (c: string) => {
          parsedContent = c;
          return expectedRecords;
        },
      };

      const deliveredRecords: Record[] = [];
      const adapter: Adapter = {
        name: "test-adapter",
        deliver: async (batch: Record[], _ctx: TargetConfig) => {
          deliveredRecords.push(...batch);
          return batch.map((_, i) => `mock-${i}`);
        },
        ready: async () => true,
      };

      const runner = new Runner(config, parser, adapter, tracker, store);
      await runner.onFileChange(filePath);

      // Pipeline must have read the file and forwarded content to the parser
      expect(parsedContent).toBe(content);

      // Both records must be delivered
      expect(deliveredRecords).toHaveLength(2);
      expect(deliveredRecords).toEqual(expectedRecords);

      // Delivery markers must be persisted in the store
      for (const record of expectedRecords) {
        const identity = computeIdentity(record);
        const stored = store.get(identity);
        expect(stored).toBeDefined();
        expect(stored!.hash).toBe(computeRecordHash(record));
      }
    });

    // ------------------------------------------------------------------
    // Test 2: Unchanged records — delta filter must skip delivery
    // ------------------------------------------------------------------
    it("does not deliver unchanged records", async () => {
      const record = RecordSchema.parse({
        type: "revdiff",
        file: "src/main.ts",
        line: 42,
        annotationType: "+",
        comment: "already delivered content",
      }) as Record;

      // Pre-insert into store to simulate prior delivery
      const identity = computeIdentity(record);
      const hash = computeRecordHash(record);
      store.set(identity, hash);
      await store.save();

      const filePath = join(tmpDir, "unchanged.md");
      await writeFile(filePath, "some content", "utf-8");

      let parseCount = 0;
      const parser: Parser = {
        name: "test-parser",
        parse: () => {
          parseCount++;
          return [record];
        },
      };

      const deliveredRecords: Record[] = [];
      const adapter: Adapter = {
        name: "test-adapter",
        deliver: async (batch: Record[], _ctx: TargetConfig) => {
          deliveredRecords.push(...batch);
          return batch.map((_, i) => `mock-${i}`);
        },
        ready: async () => true,
      };

      const runner = new Runner(config, parser, adapter, tracker, store);
      await runner.onFileChange(filePath);

      // Pipeline must have run parse
      expect(parseCount).toBe(1);

      // No records should be delivered (all are unchanged)
      expect(deliveredRecords).toHaveLength(0);
    });

    // ------------------------------------------------------------------
    // Test 3: Empty file — should not crash or deliver
    // ------------------------------------------------------------------
    it("handles empty file — no delivery", async () => {
      const filePath = join(tmpDir, "empty.md");
      await writeFile(filePath, "", "utf-8");

      let parseCount = 0;
      const parser: Parser = {
        name: "test-parser",
        parse: (content: string) => {
          parseCount++;
          expect(content).toBe("");
          return [];
        },
      };

      const deliveredRecords: Record[] = [];
      const adapter: Adapter = {
        name: "test-adapter",
        deliver: async (batch: Record[], _ctx: TargetConfig) => {
          deliveredRecords.push(...batch);
          return batch.map((_, i) => `mock-${i}`);
        },
        ready: async () => true,
      };

      const runner = new Runner(config, parser, adapter, tracker, store);
      await runner.onFileChange(filePath);

      // Pipeline must have run parse
      expect(parseCount).toBe(1);

      // Empty set → nothing to deliver
      expect(deliveredRecords).toHaveLength(0);
    });

    // ------------------------------------------------------------------
    // Test 4: Missing file — error must be caught, not thrown
    // ------------------------------------------------------------------
    it("handles missing file gracefully", async () => {
      const missingPath = join(tmpDir, "nonexistent.md");

      const parser: Parser = { name: "test-parser", parse: () => [] };
      const adapter: Adapter = {
        name: "test-adapter",
        deliver: async (batch: Record[], _ctx: TargetConfig) =>
          batch.map((_, i) => `mock-${i}`),
        ready: async () => true,
      };

      const runner = new Runner(config, parser, adapter, tracker, store);

      // Spy on console.error to verify the error is logged
      const errorSpy = spyOn(console, "error");

      // Must NOT throw — error is caught and logged internally
      await expect(runner.onFileChange(missingPath)).resolves.toBeUndefined();

      // Must have logged the file-not-found error
      expect(errorSpy).toHaveBeenCalled();

      errorSpy.mockRestore();
    });

    // ------------------------------------------------------------------
    // Test 5: Mix of unchanged, new, and changed — deliver only new+changed
    // ------------------------------------------------------------------
    it("delivers both new and changed records", async () => {
      // Pre-deliver one record (will be unchanged when re-parsed)
      const unchangedRecord = RecordSchema.parse({
        type: "revdiff",
        file: "src/main.ts",
        line: 42,
        annotationType: "+",
        comment: "This is the original content",
      }) as Record;

      const unchangedIdentity = computeIdentity(unchangedRecord);
      const unchangedHash = computeRecordHash(unchangedRecord);
      store.set(unchangedIdentity, unchangedHash);
      await store.save();

      // A brand-new record (never seen before)
      const newRecord = RecordSchema.parse({
        type: "revdiff",
        file: "src/new.ts",
        line: 1,
        annotationType: "+",
        comment: "brand new record content",
      }) as Record;

      // A changed record (same identity as unchanged, different body → different hash)
      const changedRecord = RecordSchema.parse({
        type: "revdiff",
        file: "src/main.ts",
        line: 42,
        annotationType: "+",
        comment: "This content has been modified",
      }) as Record;

      const filePath = join(tmpDir, "mixed.md");
      await writeFile(filePath, "some content", "utf-8");

      const parser: Parser = {
        name: "test-parser",
        parse: () => [unchangedRecord, newRecord, changedRecord],
      };

      const deliveredRecords: Record[] = [];
      const adapter: Adapter = {
        name: "test-adapter",
        deliver: async (batch: Record[], _ctx: TargetConfig) => {
          deliveredRecords.push(...batch);
          return batch.map((_, i) => `mock-${i}`);
        },
        ready: async () => true,
      };

      const runner = new Runner(config, parser, adapter, tracker, store);
      await runner.onFileChange(filePath);

      // Only 2 should be delivered: new + changed, NOT the unchanged one
      expect(deliveredRecords).toHaveLength(2);
      expect(deliveredRecords).toContainEqual(newRecord);
      expect(deliveredRecords).toContainEqual(changedRecord);
      expect(deliveredRecords).not.toContainEqual(unchangedRecord);
    });
  });

  // ----------------------------------------------------------------
  // 4. stop — state persistence and idempotency
  // ----------------------------------------------------------------
  describe("stop", () => {
    it("persists state after onFileChange has delivered records", async () => {
      const content = "some content\n";
      const filePath = join(tmpDir, "source.md");
      await writeFile(filePath, content, "utf-8");

      const record = RecordSchema.parse({
        type: "revdiff",
        file: "src/main.ts",
        line: 42,
        annotationType: "+",
        comment: "persisted record",
      }) as Record;

      const parser: Parser = {
        name: "test-parser",
        parse: () => [record],
      };

      const adapter: Adapter = {
        name: "test-adapter",
        deliver: async (batch: Record[], _ctx: TargetConfig) =>
          batch.map((_, i) => `mock-${i}`),
        ready: async () => true,
      };

      const runner = new Runner(config, parser, adapter, tracker, store);
      await runner.onFileChange(filePath);
      await runner.stop();

      // Create a fresh StateStore from the same location to verify persistence
      const store2 = new StateStore("runner-test", tmpDir);
      await store2.load();

      const identity = computeIdentity(record);
      const stored = store2.get(identity);
      expect(stored).toBeDefined();
      expect(stored!.hash).toBe(computeRecordHash(record));
    });

    it("can be called multiple times without error", async () => {
      const runner = new Runner(config, mockParser, mockAdapter, tracker, store);

      // First call must resolve
      await expect(runner.stop()).resolves.toBeUndefined();

      // Second call must also resolve (idempotent)
      await expect(runner.stop()).resolves.toBeUndefined();
    });
  });

  // ----------------------------------------------------------------
  // 5. error handling — individual pipeline stages propagate errors
  // ----------------------------------------------------------------
  describe("error handling", () => {
    it("parser error is caught and logged", async () => {
      const filePath = join(tmpDir, "source.md");
      await writeFile(filePath, "content with records", "utf-8");

      const throwingParser: Parser = {
        name: "throwing-parser",
        parse: (_content: string): Record[] => {
          throw new Error("parse error");
        },
      };

      const errorSpy = spyOn(console, "error");

      const runner = new Runner(config, throwingParser, mockAdapter, tracker, store);
      await expect(runner.onFileChange(filePath)).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalled();

      errorSpy.mockRestore();
    });

    it("adapter deliver error is caught and logged", async () => {
      const filePath = join(tmpDir, "source.md");
      await writeFile(filePath, "content with records", "utf-8");

      const producingParser: Parser = {
        name: "producing-parser",
        parse: () => [
          RecordSchema.parse({
            type: "revdiff",
            file: "src/main.ts",
            line: 1,
            annotationType: "+",
            comment: "test record",
          }) as Record,
        ],
      };

      const throwingAdapter: Adapter = {
        name: "throwing-adapter",
        deliver: async (_batch: Record[], _ctx: TargetConfig) => {
          throw new Error("deliver failed");
        },
        ready: async () => true,
      };

      const errorSpy = spyOn(console, "error");

      const runner = new Runner(config, producingParser, throwingAdapter, tracker, store);
      await expect(runner.onFileChange(filePath)).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalled();

      errorSpy.mockRestore();
    });

    it("delta filter error is caught and logged", async () => {
      const filePath = join(tmpDir, "source.md");
      await writeFile(filePath, "content with records", "utf-8");

      const producingParser: Parser = {
        name: "producing-parser",
        parse: () => [
          RecordSchema.parse({
            type: "revdiff",
            file: "src/main.ts",
            line: 1,
            annotationType: "+",
            comment: "test record",
          }) as Record,
        ],
      };

      const filterSpy = spyOn(tracker, "filter").mockRejectedValue(
        new Error("filter failed"),
      );

      const errorSpy = spyOn(console, "error");

      const runner = new Runner(config, producingParser, mockAdapter, tracker, store);
      await expect(runner.onFileChange(filePath)).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalled();

      filterSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });
});
