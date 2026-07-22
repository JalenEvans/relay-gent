import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Runner } from "../../src/application/runner";
import { RawCommandAdapter } from "../../src/adapters/raw-command";
import { DeltaTracker } from "../../src/core/delta";
import {
  RecordSchema,
  type Record,
} from "../../src/domain/record/record.schema";
import {
  computeIdentity,
  computeRecordHash,
} from "../../src/domain/record/record-identity";
import {
  TargetConfigSchema,
  type TargetConfig,
} from "../../src/domain/config/config.schema";
import { createJsonLinesParser } from "../../src/parsers/json-lines";
import { StateStore } from "../../src/state/store";

// ============================================================
// Integration: Runner — full pipeline with real components
// ============================================================
// Exercises the entire Runner pipeline using REAL parser (json-lines),
// REAL adapter (raw-command), REAL delta tracker, and REAL state store.
// No mocks — verifies the system works end-to-end from file-on-disk
// through parsing, delta-filtering, delivery via shell command, and
// state persistence.
// ============================================================

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

async function createTmpDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "relay-gent-integration-"));
}

/**
 * Poll for an output file to appear with non-empty content.
 * Used by foreground-mode tests where the delivery happens
 * asynchronously through chokidar events.
 */
async function waitForOutput(
  outputFile: string,
  timeoutMs = 5000,
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(outputFile)) {
      const content = readFileSync(outputFile, "utf-8");
      if (content.trim().length > 0) {
        return content;
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timeout waiting for output file: ${outputFile}`);
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------

describe("Runner integration — full pipeline with real components", () => {
  // ----------------------------------------------------------------
  // Test 1: one-shot mode — real parser and adapter work together
  // ----------------------------------------------------------------
  // Verifies the full pipeline: file → parse → filter → deliver → persist.
  // The raw-command adapter writes formatted records to an output file
  // via `cat >`. StateStore should have 2 deliveries after completion.
  // ----------------------------------------------------------------
  it("one-shot mode — real parser and adapter work together", async () => {
    const tmpDir = await createTmpDir();
    try {
      // Create input JSON-lines file with 2 records
      const inputFile = join(tmpDir, "input.jsonl");
      await writeFile(
        inputFile,
        [
          `{"message": "Server started", "timestamp": "2024-01-01T00:00:00Z", "level": "info"}`,
          `{"message": "Request received", "timestamp": "2024-01-01T00:01:00Z", "level": "debug"}`,
          "",
        ].join("\n"),
        "utf-8",
      );

      const outputFile = join(tmpDir, "output.txt");

      const config = TargetConfigSchema.parse({
        adapter: "raw-command",
        watchPath: inputFile,
        parser: "json-lines",
        command: `cat > "${outputFile}"`,
        shell: true,
      }) as TargetConfig;

      const store = new StateStore("integration-test", tmpDir);
      await store.load();
      const tracker = new DeltaTracker(store);
      const parser = createJsonLinesParser();
      const adapter = new RawCommandAdapter();

      const runner = new Runner(config, parser, adapter, tracker, store);
      await runner.start({ once: true });

      // Verify output file contains formatted records
      expect(existsSync(outputFile)).toBe(true);
      const output = readFileSync(outputFile, "utf-8");
      expect(output).toContain(
        "[2024-01-01T00:00:00Z] [info] Server started",
      );
      expect(output).toContain(
        "[2024-01-01T00:01:00Z] [debug] Request received",
      );

      // Verify StateStore has 2 deliveries persisted
      expect(store.totalDelivered).toBe(2);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  // ----------------------------------------------------------------
  // Test 2: delta filtering across two one-shot runs
  // ----------------------------------------------------------------
  // First run delivers both records. Second run (same file) should
  // detect both as unchanged and skip delivery. The output file
  // must retain only the first run's content, and totalDelivered
  // must remain at 2.
  // ----------------------------------------------------------------
  it("delta filtering across two one-shot runs", async () => {
    const tmpDir = await createTmpDir();
    try {
      // Create input file with 2 records
      const inputFile = join(tmpDir, "input.jsonl");
      const records = [
        `{"message": "Server started", "timestamp": "2024-01-01T00:00:00Z", "level": "info"}`,
        `{"message": "Request received", "timestamp": "2024-01-01T00:01:00Z", "level": "debug"}`,
      ];
      await writeFile(inputFile, records.join("\n") + "\n", "utf-8");

      const outputFile = join(tmpDir, "output.txt");

      const config = TargetConfigSchema.parse({
        adapter: "raw-command",
        watchPath: inputFile,
        parser: "json-lines",
        command: `cat > "${outputFile}"`,
        shell: true,
      }) as TargetConfig;

      const store = new StateStore("integration-test", tmpDir);
      await store.load();
      const tracker = new DeltaTracker(store);
      const parser = createJsonLinesParser();
      const adapter = new RawCommandAdapter();

      // First one-shot run → both records delivered
      const runner1 = new Runner(config, parser, adapter, tracker, store);
      await runner1.start({ once: true });

      expect(store.totalDelivered).toBe(2);
      const firstOutput = readFileSync(outputFile, "utf-8");
      expect(firstOutput).toContain(
        "[2024-01-01T00:00:00Z] [info] Server started",
      );
      expect(firstOutput).toContain(
        "[2024-01-01T00:01:00Z] [debug] Request received",
      );

      // Second one-shot run (same file, same store) → nothing new
      const runner2 = new Runner(config, parser, adapter, tracker, store);
      await runner2.start({ once: true });

      // Verify: output file has ONLY the first delivery content (unchanged)
      const secondOutput = readFileSync(outputFile, "utf-8");
      expect(secondOutput).toBe(firstOutput);

      // Verify: StateStore still has 2 totalDelivered (no new unique
      // identities were added)
      expect(store.totalDelivered).toBe(2);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  // ----------------------------------------------------------------
  // Test 3: foreground mode — new file detection
  // ----------------------------------------------------------------
  // Starts the runner watching a directory, writes a new JSON-lines
  // file into it, and verifies the chokidar watcher picks it up,
  // processes it through the pipeline, and delivers the formatted
  // output to the specified output file.
  // ----------------------------------------------------------------
  it("foreground mode — new file detection", async () => {
    const tmpDir = await createTmpDir();
    try {
      const watchDir = join(tmpDir, "watch");
      await mkdir(watchDir, { recursive: true });

      const outputFile = join(tmpDir, "output.txt");

      const config = TargetConfigSchema.parse({
        adapter: "raw-command",
        watchPath: watchDir,
        parser: "json-lines",
        command: `cat > "${outputFile}"`,
        shell: true,
      }) as TargetConfig;

      const store = new StateStore("integration-test", tmpDir);
      await store.load();
      const tracker = new DeltaTracker(store);
      const parser = createJsonLinesParser();
      const adapter = new RawCommandAdapter();

      const runner = new Runner(config, parser, adapter, tracker, store);

      // Start foreground mode (watches directory for new/changed files)
      await runner.start({ foreground: true });

      // Write a JSON-lines file to the watched directory — chokidar
      // should detect the "add" event and trigger the pipeline
      const newFile = join(watchDir, "data.jsonl");
      await writeFile(
        newFile,
        `{"message": "Foreground detected", "timestamp": "2024-02-01T12:00:00Z", "level": "info"}\n`,
        "utf-8",
      );

      // Wait for the output file to appear (adapter delivers via cat >)
      const output = await waitForOutput(outputFile);

      expect(output).toContain(
        "[2024-02-01T12:00:00Z] [info] Foreground detected",
      );

      await runner.stop();
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  // ----------------------------------------------------------------
  // Test 4: foreground mode — respects previously delivered state
  // ----------------------------------------------------------------
  // Pre-populates StateStore with a delivered record, creates a file
  // that contains both that same record (unchanged) and a new record.
  // The runner must only deliver the new record, filtering out the
  // one that was already delivered in a prior run.
  // ----------------------------------------------------------------
  it("foreground mode — respects previously delivered state", async () => {
    const tmpDir = await createTmpDir();
    try {
      const watchDir = join(tmpDir, "watch");
      await mkdir(watchDir, { recursive: true });

      const outputFile = join(tmpDir, "output.txt");

      const config = TargetConfigSchema.parse({
        adapter: "raw-command",
        watchPath: watchDir,
        parser: "json-lines",
        command: `cat > "${outputFile}"`,
        shell: true,
      }) as TargetConfig;

      // Pre-populate StateStore with a record that has the same
      // identity and hash as one of the records we'll create below.
      const store = new StateStore("integration-test", tmpDir);
      await store.load();
      const tracker = new DeltaTracker(store);

      const preDeliveredRecord = RecordSchema.parse({
        type: "json-lines",
        message: "This was already delivered",
        timestamp: "2024-03-01T08:00:00Z",
        level: "info",
      }) as Record;

      const preId = computeIdentity(preDeliveredRecord);
      const preHash = computeRecordHash(preDeliveredRecord);
      store.set(preId, preHash);
      await store.save();

      // Create a file that contains both the already-delivered record
      // (same identity + hash = unchanged) AND a new record
      const watchFile = join(watchDir, "data.jsonl");
      await writeFile(
        watchFile,
        [
          `{"message": "This was already delivered", "timestamp": "2024-03-01T08:00:00Z", "level": "info"}`,
          `{"message": "This is brand new", "timestamp": "2024-03-01T09:00:00Z", "level": "warn"}`,
          "",
        ].join("\n"),
        "utf-8",
      );

      const parser = createJsonLinesParser();
      const adapter = new RawCommandAdapter();

      const runner = new Runner(config, parser, adapter, tracker, store);

      // Start foreground mode — the initial file enumeration will
      // process the existing file. Only the new record should be
      // delivered (the old one is filtered out by DeltaTracker).
      await runner.start({ foreground: true });

      // Wait for the output file to appear
      const output = await waitForOutput(outputFile);

      // Verify: only the new record was delivered
      expect(output).toContain(
        "[2024-03-01T09:00:00Z] [warn] This is brand new",
      );

      // Verify: the already-delivered record was NOT re-delivered
      expect(output).not.toContain("This was already delivered");

      // Verify: totalDelivered is 2 (1 pre-populated + 1 new)
      expect(store.totalDelivered).toBe(2);

      await runner.stop();
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  // ----------------------------------------------------------------
  // Test 5: one-shot mode — missing file handled gracefully
  // ----------------------------------------------------------------
  // When watchPath points to a non-existent file, the pipeline must
  // not throw. The error is caught by onFileChange's try/catch and
  // logged via console.error.
  // ----------------------------------------------------------------
  it("one-shot mode — missing file handled gracefully", async () => {
    const tmpDir = await createTmpDir();
    try {
      const missingPath = join(tmpDir, "nonexistent.jsonl");

      const config = TargetConfigSchema.parse({
        adapter: "raw-command",
        watchPath: missingPath,
        parser: "json-lines",
        command: `cat > "${join(tmpDir, "output.txt")}"`,
        shell: true,
      }) as TargetConfig;

      const store = new StateStore("integration-test", tmpDir);
      await store.load();
      const tracker = new DeltaTracker(store);
      const parser = createJsonLinesParser();
      const adapter = new RawCommandAdapter();

      const errorSpy = spyOn(console, "error").mockImplementation(() => {});

      const runner = new Runner(config, parser, adapter, tracker, store);

      // Must resolve without throwing — error is caught internally
      await expect(runner.start({ once: true })).resolves.toBeUndefined();

      // Must have logged the file-not-found error
      expect(errorSpy).toHaveBeenCalled();

      errorSpy.mockRestore();
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  // ----------------------------------------------------------------
  // Test 6: full lifecycle — one-shot with multiple record types
  // ----------------------------------------------------------------
  // Creates two separate JSON-lines files with different entries,
  // runs one-shot on each, and verifies that both are correctly
  // delivered and counted in totalDelivered.
  // ----------------------------------------------------------------
  it("full lifecycle — one-shot with multiple record types", async () => {
    const tmpDir = await createTmpDir();
    try {
      // First file with 3 records (various log levels)
      const file1 = join(tmpDir, "file1.jsonl");
      await writeFile(
        file1,
        [
          `{"message": "Server started", "timestamp": "2024-04-01T08:00:00Z", "level": "info"}`,
          `{"message": "User login", "timestamp": "2024-04-01T08:05:00Z", "level": "info"}`,
          `{"message": "Disk space low", "timestamp": "2024-04-01T08:10:00Z", "level": "warn"}`,
          "",
        ].join("\n"),
        "utf-8",
      );

      // Second file with 2 records (different content)
      const file2 = join(tmpDir, "file2.jsonl");
      await writeFile(
        file2,
        [
          `{"message": "Deploy started", "timestamp": "2024-04-02T10:00:00Z", "level": "info"}`,
          `{"message": "Deploy completed", "timestamp": "2024-04-02T10:30:00Z", "level": "info"}`,
          "",
        ].join("\n"),
        "utf-8",
      );

      const outputFile1 = join(tmpDir, "output1.txt");
      const outputFile2 = join(tmpDir, "output2.txt");

      const store = new StateStore("integration-test", tmpDir);
      await store.load();
      const parser = createJsonLinesParser();
      const adapter = new RawCommandAdapter();

      // ---- First run: file1 ----
      const config1 = TargetConfigSchema.parse({
        adapter: "raw-command",
        watchPath: file1,
        parser: "json-lines",
        command: `cat > "${outputFile1}"`,
        shell: true,
      }) as TargetConfig;

      const tracker1 = new DeltaTracker(store);
      const runner1 = new Runner(config1, parser, adapter, tracker1, store);
      await runner1.start({ once: true });

      // Verify first run output has all 3 records
      const out1 = readFileSync(outputFile1, "utf-8");
      expect(out1).toContain(
        "[2024-04-01T08:00:00Z] [info] Server started",
      );
      expect(out1).toContain(
        "[2024-04-01T08:05:00Z] [info] User login",
      );
      expect(out1).toContain(
        "[2024-04-01T08:10:00Z] [warn] Disk space low",
      );

      // ---- Second run: file2 ----
      const config2 = TargetConfigSchema.parse({
        adapter: "raw-command",
        watchPath: file2,
        parser: "json-lines",
        command: `cat > "${outputFile2}"`,
        shell: true,
      }) as TargetConfig;

      const tracker2 = new DeltaTracker(store);
      const runner2 = new Runner(config2, parser, adapter, tracker2, store);
      await runner2.start({ once: true });

      // Verify second run output has both records
      const out2 = readFileSync(outputFile2, "utf-8");
      expect(out2).toContain(
        "[2024-04-02T10:00:00Z] [info] Deploy started",
      );
      expect(out2).toContain(
        "[2024-04-02T10:30:00Z] [info] Deploy completed",
      );

      // Total delivered should be 3 + 2 = 5
      expect(store.totalDelivered).toBe(5);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
