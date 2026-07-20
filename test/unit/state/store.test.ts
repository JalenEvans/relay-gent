import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StateStore } from "../../../src/state/store";

// ============================================================
// StateStore — persistence layer for delivered record tracking
// ============================================================
// Stores delivered records as JSON at:
//   ~/.relay-gent/targets/<name>/state.json
//
// State shape:
//   { records: { [identity]: { delivered_at, hash } },
//     last_run: ISO timestamp | null,
//     total_delivered: number }
// ============================================================

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

/** Create a fresh temp directory for test isolation */
async function createTmpDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "relay-gent-test-"));
}

/** Build the expected state.json path for a given name inside a base dir */
function statePath(baseDir: string, name: string): string {
  return join(baseDir, "targets", name, "state.json");
}

/** Build the expected targets directory for a given name inside a base dir */
function targetsDir(baseDir: string, name: string): string {
  return join(baseDir, "targets", name);
}

// ------------------------------------------------------------------
// 1. Fresh state — file doesn't exist
// ------------------------------------------------------------------

describe("StateStore — fresh state", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty state when state file does not exist", async () => {
    const store = new StateStore("my-target", tmpDir);

    // Point the store at our temp dir instead of home directory
    // The store should support a base dir override for testing,
    // or we can use the name and let load() handle missing files gracefully.
    // For now, we test the logical behavior: load() on a missing file
    // should not throw and should leave the store in an empty state.
    //
    // NOTE: The actual implementation may use a baseDir constructor param
    // or env var override. Tests will adapt to the real API.
    await store.load();

    // After loading a non-existent file, state should be empty
    const allRecords = store.getAllRecords();
    expect(allRecords).toEqual({});
    expect(store.totalDelivered).toBe(0);
  });
});

// ------------------------------------------------------------------
// 2. Persistence — data survives a new instance
// ------------------------------------------------------------------

describe("StateStore — persistence", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("persists records across load/save cycles", async () => {
    const store1 = new StateStore("persist-test", tmpDir);

    store1.set("revdiff:src/main.ts:42:+", "abc123def456");
    store1.set("json-lines:2024-01-15T10:30:00Z:INFO", "789ghi012jkl");
    await store1.save();

    // Create a brand new instance and load from the same location
    const store2 = new StateStore("persist-test", tmpDir);
    await store2.load();

    const record1 = store2.get("revdiff:src/main.ts:42:+");
    expect(record1).toBeDefined();
    expect(record1!.hash).toBe("abc123def456");
    expect(record1!.delivered_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const record2 = store2.get("json-lines:2024-01-15T10:30:00Z:INFO");
    expect(record2).toBeDefined();
    expect(record2!.hash).toBe("789ghi012jkl");

    expect(store2.totalDelivered).toBe(2);
  });

  it("survives multiple save/load cycles", async () => {
    const store = new StateStore("multi-cycle", tmpDir);

    // First cycle
    store.set("identity-1", "hash-1");
    await store.save();

    // Second cycle — same instance, reload
    await store.load();
    expect(store.get("identity-1")).toBeDefined();

    // Add more and save again
    store.set("identity-2", "hash-2");
    await store.save();

    // Third cycle — new instance
    const store2 = new StateStore("multi-cycle", tmpDir);
    await store2.load();
    expect(store2.get("identity-1")).toBeDefined();
    expect(store2.get("identity-2")).toBeDefined();
    expect(store2.totalDelivered).toBe(2);
  });
});

// ------------------------------------------------------------------
// 3. Atomic write — temp file pattern
// ------------------------------------------------------------------

describe("StateStore — atomic write", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("leaves no .tmp files after save", async () => {
    const store = new StateStore("atomic-test", tmpDir);

    store.set("identity:1", "hash1");
    await store.save();

    const dir = targetsDir(tmpDir, "atomic-test");
    const files = await readdir(dir);

    // No .tmp files should remain after a successful save
    const tmpFiles = files.filter((f) => f.endsWith(".tmp"));
    expect(tmpFiles).toEqual([]);
  });

  it("produces a valid state.json after save", async () => {
    const store = new StateStore("atomic-valid", tmpDir);

    store.set("test:identity", "abc123");
    await store.save();

    const path = statePath(tmpDir, "atomic-valid");
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);

    expect(parsed).toHaveProperty("records");
    expect(parsed).toHaveProperty("last_run");
    expect(parsed).toHaveProperty("total_delivered");
  });

  it("does not leave partial writes on failure", async () => {
    const store = new StateStore("atomic-fail", tmpDir);

    // Save once to establish a valid file
    store.set("existing:record", "hash-exists");
    await store.save();

    const path = statePath(tmpDir, "atomic-fail");
    const contentBefore = await readFile(path, "utf-8");

    // A second save should either succeed or leave the original intact.
    // The key property: no half-written state.json should exist.
    store.set("new:record", "hash-new");

    try {
      await store.save();
    } catch {
      // Even if save fails, the original file should be intact
      const contentAfter = await readFile(path, "utf-8");
      expect(contentAfter).toBe(contentBefore);
    }
  });
});

// ------------------------------------------------------------------
// 4. Clear — reset to empty state
// ------------------------------------------------------------------

describe("StateStore — clear", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("clears all records and counters", async () => {
    const store = new StateStore("clear-test", tmpDir);

    store.set("id-1", "hash-1");
    store.set("id-2", "hash-2");
    store.set("id-3", "hash-3");

    store.clear();

    expect(store.get("id-1")).toBeUndefined();
    expect(store.get("id-2")).toBeUndefined();
    expect(store.get("id-3")).toBeUndefined();
    expect(store.totalDelivered).toBe(0);
  });

  it("clear persists to disk after save", async () => {
    const store1 = new StateStore("clear-persist", tmpDir);

    store1.set("survivor", "hash-survivor");
    await store1.save();

    // Reload to confirm data is there
    const store2 = new StateStore("clear-persist", tmpDir);
    await store2.load();
    expect(store2.get("survivor")).toBeDefined();

    // Clear and save
    store2.clear();
    await store2.save();

    // Reload again — should be empty
    const store3 = new StateStore("clear-persist", tmpDir);
    await store3.load();
    expect(store3.get("survivor")).toBeUndefined();
    expect(store3.totalDelivered).toBe(0);
  });
});

// ------------------------------------------------------------------
// 5. Directory creation — auto-create target dir
// ------------------------------------------------------------------

describe("StateStore — directory creation", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates target directory automatically on save", async () => {
    const store = new StateStore("auto-create", tmpDir);

    // Directory should not exist yet
    const dir = targetsDir(tmpDir, "auto-create");

    // Save — should create the directory
    store.set("identity:1", "hash1");
    await store.save();

    // Verify directory was created and file exists
    const path = statePath(tmpDir, "auto-create");
    const raw = await readFile(path, "utf-8");
    expect(JSON.parse(raw)).toHaveProperty("records");
  });

  it("creates nested directories for deep target names", async () => {
    const store = new StateStore("deep/nested/target", tmpDir);

    store.set("id", "hash");
    await store.save();

    const path = statePath(tmpDir, "deep/nested/target");
    const raw = await readFile(path, "utf-8");
    expect(JSON.parse(raw)).toHaveProperty("records");
  });
});

// ------------------------------------------------------------------
// 6. Get / Set — record storage and retrieval
// ------------------------------------------------------------------

describe("StateStore — get/set", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("set stores a record and get retrieves it", () => {
    const store = new StateStore("getset-test", tmpDir);

    store.set("revdiff:src/main.ts:42:+", "abc123hash");

    const record = store.get("revdiff:src/main.ts:42:+");
    expect(record).toBeDefined();
    expect(record!.hash).toBe("abc123hash");
    expect(record!.delivered_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("get returns undefined for nonexistent identity", () => {
    const store = new StateStore("getset-missing", tmpDir);

    const record = store.get("does:not:exist");
    expect(record).toBeUndefined();
  });

  it("set overwrites an existing record", () => {
    const store = new StateStore("getset-overwrite", tmpDir);

    store.set("identity:1", "original-hash");
    const before = store.get("identity:1");
    expect(before!.hash).toBe("original-hash");

    store.set("identity:1", "updated-hash");
    const after = store.get("identity:1");
    expect(after!.hash).toBe("updated-hash");
  });

  it("set records the delivered_at timestamp", () => {
    const store = new StateStore("getset-timestamp", tmpDir);

    const before = Date.now();
    store.set("ts:test", "hash-ts");
    const after = Date.now();

    const record = store.get("ts:test");
    const deliveredAt = new Date(record!.delivered_at).getTime();
    expect(deliveredAt).toBeGreaterThanOrEqual(before);
    expect(deliveredAt).toBeLessThanOrEqual(after);
  });

  it("getAllRecords returns all stored records", () => {
    const store = new StateStore("getset-all", tmpDir);

    store.set("a:1", "hash-a");
    store.set("b:2", "hash-b");
    store.set("c:3", "hash-c");

    const all = store.getAllRecords();
    expect(Object.keys(all)).toHaveLength(3);
    expect(all["a:1"].hash).toBe("hash-a");
    expect(all["b:2"].hash).toBe("hash-b");
    expect(all["c:3"].hash).toBe("hash-c");
  });
});

// ------------------------------------------------------------------
// 7. Last run timestamp — updated on save
// ------------------------------------------------------------------

describe("StateStore — last_run timestamp", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("last_run is null initially", async () => {
    const store = new StateStore("lastrun-null", tmpDir);
    await store.load();

    expect(store.lastRun).toBeNull();
  });

  it("save() updates last_run to current ISO timestamp", async () => {
    const store = new StateStore("lastrun-save", tmpDir);

    const before = Date.now();
    await store.save();
    const after = Date.now();

    const lastRun = new Date(store.lastRun!).getTime();
    expect(lastRun).toBeGreaterThanOrEqual(before);
    expect(lastRun).toBeLessThanOrEqual(after);
  });

  it("last_run is persisted across instances", async () => {
    const store1 = new StateStore("lastrun-persist", tmpDir);
    await store1.save();

    const store2 = new StateStore("lastrun-persist", tmpDir);
    await store2.load();

    expect(store2.lastRun).not.toBeNull();
    expect(store2.lastRun).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ------------------------------------------------------------------
// 8. Total delivered counter
// ------------------------------------------------------------------

describe("StateStore — total_delivered counter", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("starts at 0", () => {
    const store = new StateStore("counter-zero", tmpDir);
    expect(store.totalDelivered).toBe(0);
  });

  it("increments on each set() for new identities", () => {
    const store = new StateStore("counter-increment", tmpDir);

    store.set("id-1", "hash-1");
    expect(store.totalDelivered).toBe(1);

    store.set("id-2", "hash-2");
    expect(store.totalDelivered).toBe(2);

    store.set("id-3", "hash-3");
    expect(store.totalDelivered).toBe(3);
  });

  it("does not double-count when overwriting the same identity", () => {
    const store = new StateStore("counter-no-double", tmpDir);

    store.set("same-id", "hash-v1");
    expect(store.totalDelivered).toBe(1);

    store.set("same-id", "hash-v2");
    // Should still be 1 — we overwrote, not added a new record
    expect(store.totalDelivered).toBe(1);
  });

  it("counter persists across save/load", async () => {
    const store1 = new StateStore("counter-persist", tmpDir);

    store1.set("a:1", "hash-a");
    store1.set("b:2", "hash-b");
    store1.set("c:3", "hash-c");
    await store1.save();

    const store2 = new StateStore("counter-persist", tmpDir);
    await store2.load();

    expect(store2.totalDelivered).toBe(3);
  });

  it("counter reflects clear()", () => {
    const store = new StateStore("counter-clear", tmpDir);

    store.set("id-1", "hash-1");
    store.set("id-2", "hash-2");
    expect(store.totalDelivered).toBe(2);

    store.clear();
    expect(store.totalDelivered).toBe(0);
  });
});

// ------------------------------------------------------------------
// 9. Corrupted state file — invalid JSON / wrong schema recovery
// ------------------------------------------------------------------

describe("StateStore — corrupted state file", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("recovers gracefully from invalid JSON in state.json", async () => {
    const path = statePath(tmpDir, "corrupt-invalid-json");
    const dir = join(tmpDir, "targets", "corrupt-invalid-json");
    // Create a state.json with invalid JSON content
    await mkdir(dir, { recursive: true });
    await writeFile(path, "{ invalid json content here }", "utf-8");

    const store = new StateStore("corrupt-invalid-json", tmpDir);
    // Should not throw — must recover to fresh empty state
    await expect(store.load()).resolves.toBeUndefined();

    expect(store.getAllRecords()).toEqual({});
    expect(store.totalDelivered).toBe(0);
    expect(store.lastRun).toBeNull();
  });

  it("recovers when state.json has valid JSON but missing required fields", async () => {
    const path = statePath(tmpDir, "corrupt-missing-fields");
    const dir = join(tmpDir, "targets", "corrupt-missing-fields");
    // State with valid JSON structure but wrong/missing top-level fields
    await mkdir(dir, { recursive: true });
    await writeFile(path, JSON.stringify({ foo: "bar", baz: 42 }), "utf-8");

    const store = new StateStore("corrupt-missing-fields", tmpDir);
    await expect(store.load()).resolves.toBeUndefined();

    // Should have recovered with defaults
    expect(store.getAllRecords()).toEqual({});
    expect(store.totalDelivered).toBe(0);
    expect(store.lastRun).toBeNull();
  });

  it("recovers when state.json has null instead of records object", async () => {
    const path = statePath(tmpDir, "corrupt-null-records");
    const dir = join(tmpDir, "targets", "corrupt-null-records");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path,
      JSON.stringify({ records: null, last_run: null, total_delivered: 0 }),
      "utf-8",
    );

    const store = new StateStore("corrupt-null-records", tmpDir);
    await expect(store.load()).resolves.toBeUndefined();

    expect(store.getAllRecords()).toEqual({});
    expect(store.totalDelivered).toBe(0);
  });

  it("recovers when state.json has records as array instead of object", async () => {
    const path = statePath(tmpDir, "corrupt-array-records");
    const dir = join(tmpDir, "targets", "corrupt-array-records");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path,
      JSON.stringify({ records: ["not", "an", "object"], last_run: null, total_delivered: 0 }),
      "utf-8",
    );

    const store = new StateStore("corrupt-array-records", tmpDir);
    await expect(store.load()).resolves.toBeUndefined();

    // Should start fresh since records is not a plain object
    expect(store.getAllRecords()).toEqual({});
    expect(store.totalDelivered).toBe(0);
  });
});

// ------------------------------------------------------------------
// 10. Permission error — unreadable state.json
// ------------------------------------------------------------------

describe("StateStore — permission errors", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(async () => {
    // Restore permissions broadly so rm can clean up
    try {
      const filePath = statePath(tmpDir, "permission-test");
      await chmod(filePath, 0o644);
    } catch {
      // path may not exist
    }
    try {
      const dirPath = targetsDir(tmpDir, "dir-permission-test");
      await chmod(dirPath, 0o755);
    } catch {
      // path may not exist
    }
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("throws a clear error mentioning permissions when state.json is not readable", async () => {
    const store = new StateStore("permission-test", tmpDir);

    // Save a valid state first
    store.set("test:id", "test-hash");
    await store.save();

    // Remove read permissions
    const path = statePath(tmpDir, "permission-test");
    await chmod(path, 0o000);

    // Loading should throw a clear error about permissions
    try {
      await expect(store.load()).rejects.toThrow(/permission|EACCES|denied/i);
    } finally {
      // Restore for cleanup even if assertion fails
      await chmod(path, 0o644);
    }
  });

  it("is usable again after permission error is resolved", async () => {
    const store = new StateStore("permission-test", tmpDir);

    // Save and verify data exists
    store.set("survivor:id", "survivor-hash");
    await store.save();

    // Remove read permissions
    const path = statePath(tmpDir, "permission-test");
    await chmod(path, 0o000);

    // First load should throw due to permissions
    try {
      await expect(store.load()).rejects.toThrow();
    } finally {
      // Restore permissions even if assertion fails
      await chmod(path, 0o644);
    }

    // Second load should succeed and load the data
    await expect(store.load()).resolves.toBeUndefined();
    expect(store.get("survivor:id")).toBeDefined();
    expect(store.get("survivor:id")!.hash).toBe("survivor-hash");
    expect(store.totalDelivered).toBe(1);
  });

  it("handles permission error on the state directory gracefully", async () => {
    const store = new StateStore("dir-permission-test", tmpDir);

    // Save a valid state
    store.set("dir:id", "dir-hash");
    await store.save();

    // Remove execute permission from the target directory
    const dir = targetsDir(tmpDir, "dir-permission-test");
    await chmod(dir, 0o000);

    // Loading should throw a clear error (directory not searchable)
    try {
      await expect(store.load()).rejects.toThrow(/permission|EACCES|denied/i);
    } finally {
      // Restore for cleanup even if assertion fails
      await chmod(dir, 0o755);
    }
  });
});
