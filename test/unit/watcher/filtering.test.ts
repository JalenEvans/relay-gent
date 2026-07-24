import { describe, test, expect } from "bun:test";

describe("Extension filter - shouldIncludeFile", () => {
  test("shouldIncludeFile static method exists on WatcherManager", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    // FAILS: shouldIncludeFile does not exist yet
    expect(WatcherManager.shouldIncludeFile).toBeDefined();
    expect(typeof WatcherManager.shouldIncludeFile).toBe("function");
  });

  test("shouldIncludeFile returns true for matching extension", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    // FAILS: method doesn't exist
    expect(WatcherManager.shouldIncludeFile("/path/file.ts", [".ts"])).toBe(true);
  });

  test("shouldIncludeFile returns false for non-matching extension", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    // FAILS: method doesn't exist
    expect(WatcherManager.shouldIncludeFile("/path/file.js", [".ts"])).toBe(false);
  });

  test("shouldIncludeFile returns true for multiple extensions", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    // FAILS: method doesn't exist
    expect(WatcherManager.shouldIncludeFile("/path/file.js", [".ts", ".js"])).toBe(true);
  });

  test("shouldIncludeFile is case-insensitive", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    // FAILS: method doesn't exist
    expect(WatcherManager.shouldIncludeFile("/path/file.TS", [".ts"])).toBe(true);
  });

  test("shouldIncludeFile returns true when no extensions filter", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    // FAILS: method doesn't exist
    expect(WatcherManager.shouldIncludeFile("/path/file.ts")).toBe(true);
  });

  test("shouldIncludeFile returns true for empty extensions array", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    // FAILS: method doesn't exist
    expect(WatcherManager.shouldIncludeFile("/path/file.ts", [])).toBe(true);
  });
});

describe("WatcherOptions extensions field", () => {
  test("watchFile stores extensions in options", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();
    await manager.watchFile("/tmp/test.log", { extensions: [".ts"] });
    const opts = manager.getWatcherOptions("/tmp/test.log");
    expect(opts).toBeDefined();
    // FAILS: extensions is not stored in options
    expect(opts!.extensions).toEqual([".ts"]);
  });

  test("watchFile without extensions leaves it undefined", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();
    await manager.watchFile("/tmp/test.log");
    const opts = manager.getWatcherOptions("/tmp/test.log");
    expect(opts).toBeDefined();
    // PASSES after auto-detection - just check extensions is undefined
    expect(opts!.extensions).toBeUndefined();
  });
});

describe("Callback filtering integration", () => {
  test("callback is NOT invoked for non-matching extension", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();
    let called = false;
    manager.setOnFileChange(() => { called = true; });

    // Use shouldIncludeFile to simulate what the watcher does
    // FAILS: shouldIncludeFile doesn't exist yet
    const include = WatcherManager.shouldIncludeFile("/tmp/test.js", [".ts"]);
    if (include) {
      // This shouldn't fire for .js when filtering .ts
      const cb = manager.getOnFileChange();
      if (cb) cb("change", "/tmp/test.js");
    }
    expect(called).toBe(false);
  });

  test("callback IS invoked for matching extension", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();
    let called = false;
    manager.setOnFileChange(() => { called = true; });

    // Use shouldIncludeFile to simulate what the watcher does
    // FAILS: shouldIncludeFile doesn't exist yet
    const include = WatcherManager.shouldIncludeFile("/tmp/test.ts", [".ts"]);
    if (include) {
      const cb = manager.getOnFileChange();
      if (cb) cb("change", "/tmp/test.ts");
    }
    expect(called).toBe(true);
  });
});
