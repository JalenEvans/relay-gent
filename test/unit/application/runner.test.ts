import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
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
import type { Record } from "../../../src/domain/record/record.schema";
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
});
