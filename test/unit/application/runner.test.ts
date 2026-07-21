import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

  // ----------------------------------------------------------------
  // 6. start — one-shot processing of watchPath
  // ----------------------------------------------------------------
  describe("start", () => {
    // ------------------------------------------------------------------
    // Test 1: Happy path — loads state, processes watchPath, delivers
    // ------------------------------------------------------------------
    it("start({ once: true }) loads state and processes watchPath", async () => {
      const filePath = join(tmpDir, "watch-source.md");
      await writeFile(filePath, "test content for start", "utf-8");
      config = testConfig({ watchPath: filePath });

      const expectedRecords: Record[] = [
        RecordSchema.parse({
          type: "revdiff",
          file: "src/main.ts",
          line: 42,
          annotationType: "+",
          comment: "start mode record",
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
      await runner.start({ once: true });

      // State must be loaded before processing (load() is called internally)
      // Pipeline must have read the watchPath file and forwarded to parser
      expect(parsedContent).toBe("test content for start");

      // Records must have been delivered to the adapter
      expect(deliveredRecords).toHaveLength(1);
      expect(deliveredRecords).toEqual(expectedRecords);

      // Records must be persisted in the store
      for (const record of expectedRecords) {
        const identity = computeIdentity(record);
        const stored = store.get(identity);
        expect(stored).toBeDefined();
        expect(stored!.hash).toBe(computeRecordHash(record));
      }

      // Store has non-empty state after start completes
      expect(store.totalDelivered).toBeGreaterThan(0);
    });

    // ------------------------------------------------------------------
    // Test 2: Respects previously delivered state
    // ------------------------------------------------------------------
    it("start({ once: true }) respects previously delivered state", async () => {
      const filePath = join(tmpDir, "watch-source.md");
      await writeFile(filePath, "test content", "utf-8");
      config = testConfig({ watchPath: filePath });

      // Pre-deliver one record to simulate prior delivery
      const priorRecord = RecordSchema.parse({
        type: "revdiff",
        file: "src/old.ts",
        line: 1,
        annotationType: "+",
        comment: "already delivered",
      }) as Record;

      const priorIdentity = computeIdentity(priorRecord);
      const priorHash = computeRecordHash(priorRecord);
      store.set(priorIdentity, priorHash);
      await store.save();

      // A brand-new record that has never been seen
      const newRecord = RecordSchema.parse({
        type: "revdiff",
        file: "src/new.ts",
        line: 10,
        annotationType: "+",
        comment: "brand new record",
      }) as Record;

      let parseCallCount = 0;
      const parser: Parser = {
        name: "test-parser",
        parse: () => {
          parseCallCount++;
          return [priorRecord, newRecord];
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
      await runner.start({ once: true });

      // Parser must have been called once
      expect(parseCallCount).toBe(1);

      // Only the new record should be delivered (previously delivered one is
      // filtered out by DeltaTracker)
      expect(deliveredRecords).toHaveLength(1);
      expect(deliveredRecords[0]).toEqual(newRecord);
      expect(deliveredRecords).not.toContainEqual(priorRecord);
    });

    // ------------------------------------------------------------------
    // Test 3: Missing watchPath — error is caught and logged
    // ------------------------------------------------------------------
    it("start({ once: true }) handles missing watchPath gracefully", async () => {
      const missingPath = join(tmpDir, "nonexistent.md");
      config = testConfig({ watchPath: missingPath });

      const parser: Parser = { name: "test-parser", parse: () => [] };
      const adapter: Adapter = {
        name: "test-adapter",
        deliver: async (batch: Record[], _ctx: TargetConfig) =>
          batch.map((_, i) => `mock-${i}`),
        ready: async () => true,
      };

      const errorSpy = spyOn(console, "error");

      const runner = new Runner(config, parser, adapter, tracker, store);

      // Must NOT throw — error is caught and logged internally (same pattern
      // as onFileChange for missing files)
      await expect(runner.start({ once: true })).resolves.toBeUndefined();

      // Must have logged the file-not-found error
      expect(errorSpy).toHaveBeenCalled();

      errorSpy.mockRestore();
    });

    // ------------------------------------------------------------------
    // Test 4: Idempotent — calling start twice does not error
    // ------------------------------------------------------------------
    it("start({ once: true }) can be called multiple times without error", async () => {
      const filePath = join(tmpDir, "watch-source.md");
      await writeFile(filePath, "idempotent test content", "utf-8");
      config = testConfig({ watchPath: filePath });

      const parser: Parser = {
        name: "test-parser",
        parse: () => [
          RecordSchema.parse({
            type: "revdiff",
            file: "src/main.ts",
            line: 42,
            annotationType: "+",
            comment: "idempotent test record",
          }) as Record,
        ],
      };

      const adapter: Adapter = {
        name: "test-adapter",
        deliver: async (batch: Record[], _ctx: TargetConfig) =>
          batch.map((_, i) => `mock-${i}`),
        ready: async () => true,
      };

      const runner = new Runner(config, parser, adapter, tracker, store);

      // First call must resolve
      await expect(runner.start({ once: true })).resolves.toBeUndefined();

      // Second call must also resolve (idempotent — processes again or is no-op)
      await expect(runner.start({ once: true })).resolves.toBeUndefined();
    });
  });

  // ----------------------------------------------------------------
  // 7. start — foreground mode (file watching)
  // ----------------------------------------------------------------
  describe("start — foreground mode", () => {
    // ------------------------------------------------------------------
    // Helper: create a deferred promise for async coordination
    // ------------------------------------------------------------------
    function defer<T>(): {
      promise: Promise<T>;
      resolve: (value: T) => void;
    } {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    }

    // ------------------------------------------------------------------
    // Test 1: Initial file at watchPath is processed on startup
    // ------------------------------------------------------------------
    it("processes initial file at watchPath on startup", async () => {
      const filePath = join(tmpDir, "foreground-init.md");
      await writeFile(filePath, "initial content for foreground mode", "utf-8");
      config = testConfig({ watchPath: filePath });

      const { promise: delivered, resolve: resolveDelivered } =
        defer<Record[]>();

      const expectedRecords: Record[] = [
        RecordSchema.parse({
          type: "revdiff",
          file: "src/main.ts",
          line: 42,
          annotationType: "+",
          comment: "foreground initial record",
        }) as Record,
      ];

      const parser: Parser = {
        name: "test-parser",
        parse: () => expectedRecords,
      };

      const adapter: Adapter = {
        name: "test-adapter",
        deliver: async (batch: Record[], _ctx: TargetConfig) => {
          resolveDelivered(batch);
          return batch.map((_, i) => `mock-${i}`);
        },
        ready: async () => true,
      };

      const runner = new Runner(config, parser, adapter, tracker, store);
      await runner.start({ foreground: true });

      // Wait for delivery with timeout
      const records = await Promise.race([
        delivered,
        new Promise<null>(
          (_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    "Timeout: initial file was never delivered",
                  ),
                ),
              3000,
            ),
        ),
      ]);

      expect(records).toBeDefined();
      expect(records).toHaveLength(1);
      expect(records![0]).toEqual(expectedRecords[0]);

      // Delivery state must be persisted
      const identity = computeIdentity(expectedRecords[0]);
      const stored = store.get(identity);
      expect(stored).toBeDefined();
      expect(stored!.hash).toBe(computeRecordHash(expectedRecords[0]));

      await runner.stop();
    });

    // ------------------------------------------------------------------
    // Test 2: Newly created files in watch directory
    // ------------------------------------------------------------------
    it("detects newly created files in watch directory", async () => {
      const watchDir = join(tmpDir, "watch-new-files");
      await mkdir(watchDir, { recursive: true });
      config = testConfig({ watchPath: watchDir });

      const { promise: delivered, resolve: resolveDelivered } =
        defer<Record[]>();

      const parser: Parser = {
        name: "test-parser",
        parse: (content: string) => [
          RecordSchema.parse({
            type: "revdiff",
            file: "tmp.md",
            line: 1,
            annotationType: "+",
            comment: `detected: ${content.trim()}`,
          }) as Record,
        ],
      };

      const adapter: Adapter = {
        name: "test-adapter",
        deliver: async (batch: Record[], _ctx: TargetConfig) => {
          resolveDelivered(batch);
          return batch.map((_, i) => `mock-${i}`);
        },
        ready: async () => true,
      };

      const runner = new Runner(config, parser, adapter, tracker, store);
      await runner.start({ foreground: true });

      // Write a new file — watcher should pick it up
      const filePath = join(watchDir, "new-output.md");
      await writeFile(filePath, "new file content", "utf-8");

      const records = await Promise.race([
        delivered,
        new Promise<null>(
          (_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    "Timeout: new file was never delivered",
                  ),
                ),
              3000,
            ),
        ),
      ]);

      expect(records).toBeDefined();
      expect(records).toHaveLength(1);

      await runner.stop();
    });

    // ------------------------------------------------------------------
    // Test 3: Modified files in watch directory
    // ------------------------------------------------------------------
    it("processes modified files", async () => {
      const watchDir = join(tmpDir, "watch-modified");
      await mkdir(watchDir, { recursive: true });
      config = testConfig({ watchPath: watchDir });

      let deliveryCount = 0;
      const { promise: secondDelivery, resolve: resolveSecondDelivery } =
        defer<Record[]>();

      const parser: Parser = {
        name: "test-parser",
        parse: (content: string) => [
          RecordSchema.parse({
            type: "revdiff",
            file: "modified.md",
            line: 1,
            annotationType: "+",
            comment: `content: ${content.trim()}`,
          }) as Record,
        ],
      };

      const adapter: Adapter = {
        name: "test-adapter",
        deliver: async (batch: Record[], _ctx: TargetConfig) => {
          deliveryCount++;
          if (deliveryCount === 2) {
            resolveSecondDelivery(batch);
          }
          return batch.map((_, i) => `mock-${i}`);
        },
        ready: async () => true,
      };

      const runner = new Runner(config, parser, adapter, tracker, store);
      await runner.start({ foreground: true });

      // Write initial file
      const filePath = join(watchDir, "modified.md");
      await writeFile(filePath, "version 1", "utf-8");

      // Wait a beat for the initial event, then modify
      await new Promise((r) => setTimeout(r, 300));
      await writeFile(filePath, "version 2 — modified", "utf-8");

      // Wait for the second delivery (modification)
      const records = await Promise.race([
        secondDelivery,
        new Promise<null>(
          (_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    "Timeout: modified file was never delivered",
                  ),
                ),
              5000,
            ),
        ),
      ]);

      expect(records).toBeDefined();
      expect(records).toHaveLength(1);
      expect((records![0] as { comment: string }).comment).toContain("version 2");

      await runner.stop();
    });

    // ------------------------------------------------------------------
    // Test 4: Loads state before watching (skips already-delivered)
    // ------------------------------------------------------------------
    it("start({ foreground: true }) loads state before watching", async () => {
      const watchDir = join(tmpDir, "watch-state");
      await mkdir(watchDir, { recursive: true });
      config = testConfig({ watchPath: watchDir });

      // Pre-populate store with a delivered record
      const priorRecord = RecordSchema.parse({
        type: "revdiff",
        file: "src/prior.ts",
        line: 1,
        annotationType: "+",
        comment: "already delivered content",
      }) as Record;

      const priorIdentity = computeIdentity(priorRecord);
      const priorHash = computeRecordHash(priorRecord);
      store.set(priorIdentity, priorHash);
      await store.save();

      const newRecord = RecordSchema.parse({
        type: "revdiff",
        file: "src/new.ts",
        line: 10,
        annotationType: "+",
        comment: "brand new content",
      }) as Record;

      const deliveredRecords: Record[] = [];
      const { promise: allDeliveries, resolve: resolveDeliveries } =
        defer<void>();

      const parser: Parser = {
        name: "test-parser",
        parse: (_content: string) => [priorRecord, newRecord],
      };

      const adapter: Adapter = {
        name: "test-adapter",
        deliver: async (batch: Record[], _ctx: TargetConfig) => {
          deliveredRecords.push(...batch);
          resolveDeliveries();
          return batch.map((_, i) => `mock-${i}`);
        },
        ready: async () => true,
      };

      // Pre-populate a file with content that produces both record types
      const filePath = join(watchDir, "state-test.md");
      await writeFile(
        filePath,
        "content that produces unchanged + new records",
        "utf-8",
      );

      const runner = new Runner(config, parser, adapter, tracker, store);
      await runner.start({ foreground: true });

      // Wait for the initial file to be processed
      await Promise.race([
        allDeliveries,
        new Promise<null>(
          (_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    "Timeout: delivery never happened for state-aware test",
                  ),
                ),
              3000,
            ),
        ),
      ]);

      // Only the new record should be delivered (unchanged one filtered out)
      expect(deliveredRecords).toHaveLength(1);
      expect(deliveredRecords[0]).toEqual(newRecord);
      expect(deliveredRecords).not.toContainEqual(priorRecord);

      await runner.stop();
    });

    // ------------------------------------------------------------------
    // Test 5: No delivery after stop()
    // ------------------------------------------------------------------
    it("does not process events after stop()", async () => {
      const watchDir = join(tmpDir, "watch-after-stop");
      await mkdir(watchDir, { recursive: true });
      config = testConfig({ watchPath: watchDir });

      let deliveredAfterStop = false;

      const parser: Parser = {
        name: "test-parser",
        parse: () => [
          RecordSchema.parse({
            type: "revdiff",
            file: "after-stop.md",
            line: 1,
            annotationType: "+",
            comment: "should not be delivered",
          }) as Record,
        ],
      };

      const adapter: Adapter = {
        name: "test-adapter",
        deliver: async (batch: Record[], _ctx: TargetConfig) => {
          deliveredAfterStop = true;
          return batch.map((_, i) => `mock-${i}`);
        },
        ready: async () => true,
      };

      const runner = new Runner(config, parser, adapter, tracker, store);
      await runner.start({ foreground: true });

      // Stop the runner immediately
      await runner.stop();

      // Write a file after stop
      const afterStopFile = join(watchDir, "after-stop.md");
      await writeFile(afterStopFile, "content written after stop", "utf-8");

      // Wait a bit to allow any errant watcher events to fire
      await new Promise((r) => setTimeout(r, 1000));

      // No delivery should have happened after stop
      expect(deliveredAfterStop).toBe(false);
    });
  });
});
