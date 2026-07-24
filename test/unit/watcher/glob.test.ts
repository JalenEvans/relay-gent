import { describe, test, expect } from "bun:test";

// ============================================================
// Glob Pattern & Directory Support in WatcherManager
// ============================================================
// RED PHASE: The WatcherManager does NOT yet auto-detect glob
// patterns, directory paths, or single-file paths. All tests
// asserting auto-detection MUST fail.
// ============================================================

describe("Glob pattern auto-detection in watchFile", () => {
  test("watchFile with 'src/**/*.ts' auto-detects glob origin", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();

    // Pass path with glob pattern but NO explicit options
    await manager.watchFile("src/**/*.ts");

    const opts = manager.getWatcherOptions("src/**/*.ts");
    expect(opts).toBeDefined();
    // FAILS: auto-detection not yet implemented — opts.origin is undefined
    expect(opts!.origin).toBe("glob");
    expect(opts!.pattern).toBe("src/**/*.ts");
  });

  test("watchFile with '*.js' auto-detects glob origin", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();

    await manager.watchFile("*.js");

    const opts = manager.getWatcherOptions("*.js");
    // FAILS: no auto-detection — opts.origin is undefined
    expect(opts?.origin).toBe("glob");
  });

  test("watchFile with 'data/?.txt' (single-char wildcard) auto-detects glob", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();

    await manager.watchFile("data/?.txt");

    const opts = manager.getWatcherOptions("data/?.txt");
    // FAILS: no auto-detection of '?' wildcard
    expect(opts?.origin).toBe("glob");
    expect(opts?.pattern).toBe("data/?.txt");
  });

  test("watchFile with 'file.{ts,js}' (brace expansion) auto-detects glob", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();

    await manager.watchFile("file.{ts,js}");

    const opts = manager.getWatcherOptions("file.{ts,js}");
    // FAILS: no auto-detection of brace expansion
    expect(opts?.origin).toBe("glob");
  });
});

describe("Directory path auto-detection in watchFile", () => {
  test("watchFile with 'src/' (trailing slash) auto-detects directory origin", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();

    await manager.watchFile("src/");

    const opts = manager.getWatcherOptions("src/");
    expect(opts).toBeDefined();
    // FAILS: no auto-detection — opts.origin is undefined
    expect(opts!.origin).toBe("directory");
    expect(opts!.pattern).toBe("src/");
  });
});

describe("Single-file path detection in watchFile", () => {
  test("watchFile with '/tmp/test.log' auto-detects single-file origin", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();

    await manager.watchFile("/tmp/test.log");

    const opts = manager.getWatcherOptions("/tmp/test.log");
    expect(opts).toBeDefined();
    // FAILS: no auto-detection — opts.origin is undefined
    expect(opts!.origin).toBe("single-file");
  });
});

describe("Backward compatibility", () => {
  test("watchFile without options still registers the path", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();

    await manager.watchFile("/tmp/test.log");
    const paths = manager.getWatchedPaths();

    // PASSES: existing behavior — path is registered
    expect(paths).toContain("/tmp/test.log");
  });

  test("watchFile with explicit options still works", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();

    await manager.watchFile("/tmp/test.log", { origin: "single-file" });
    const opts = manager.getWatcherOptions("/tmp/test.log");

    // PASSES: existing behavior — explicit options are stored
    expect(opts).toBeDefined();
    expect(opts!.origin).toBe("single-file");
  });

  test("getWatchedPaths returns all registered paths", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();

    await manager.watchFile("/tmp/a.log", { origin: "single-file" });
    await manager.watchFile("/tmp/**/*.log", { origin: "glob", pattern: "/tmp/**/*.log" });

    const paths = manager.getWatchedPaths();

    // PASSES: existing behavior
    expect(paths).toContain("/tmp/a.log");
    expect(paths).toContain("/tmp/**/*.log");
  });
});

describe("isGlobPattern detection helper", () => {
  test("isGlobPattern static method exists on WatcherManager", async () => {
    const { WatcherManager } = await import("../../../src/watcher");

    // FAILS: isGlobPattern does not exist yet
    expect(WatcherManager.isGlobPattern).toBeDefined();
    expect(typeof WatcherManager.isGlobPattern).toBe("function");
  });

  test("isGlobPattern returns true for 'src/**/*.ts'", async () => {
    const { WatcherManager } = await import("../../../src/watcher");

    // FAILS: method doesn't exist
    expect(WatcherManager.isGlobPattern("src/**/*.ts")).toBe(true);
  });

  test("isGlobPattern returns false for '/absolute/path/file.ts'", async () => {
    const { WatcherManager } = await import("../../../src/watcher");

    // FAILS: method doesn't exist
    expect(WatcherManager.isGlobPattern("/absolute/path/file.ts")).toBe(false);
  });

  test("isGlobPattern returns true for '*.min.js'", async () => {
    const { WatcherManager } = await import("../../../src/watcher");

    // FAILS: method doesn't exist
    expect(WatcherManager.isGlobPattern("*.min.js")).toBe(true);
  });

  test("isGlobPattern returns false for '/tmp'", async () => {
    const { WatcherManager } = await import("../../../src/watcher");

    // FAILS: method doesn't exist
    expect(WatcherManager.isGlobPattern("/tmp")).toBe(false);
  });

  test("isGlobPattern returns true for pattern with '?' wildcard", async () => {
    const { WatcherManager } = await import("../../../src/watcher");

    // FAILS: method doesn't exist
    expect(WatcherManager.isGlobPattern("data/?.txt")).toBe(true);
  });

  test("isGlobPattern returns true for brace expansion pattern", async () => {
    const { WatcherManager } = await import("../../../src/watcher");

    // FAILS: method doesn't exist
    expect(WatcherManager.isGlobPattern("file.{ts,js}")).toBe(true);
  });

  test("isGlobPattern returns true for character class pattern", async () => {
    const { WatcherManager } = await import("../../../src/watcher");

    // FAILS: method doesn't exist
    expect(WatcherManager.isGlobPattern("file[0-9].txt")).toBe(true);
  });
});

describe("Dual watch independence", () => {
  test("watching single file and glob — both appear in getWatchedPaths", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();

    await manager.watchFile("/tmp/test.log", { origin: "single-file" });
    await manager.watchFile("src/**/*.ts", { origin: "glob", pattern: "src/**/*.ts" });

    const paths = manager.getWatchedPaths();

    // PASSES: existing behavior — both paths are registered independently
    expect(paths).toContain("/tmp/test.log");
    expect(paths).toContain("src/**/*.ts");
  });

  test("unwatching single file does not affect glob watch", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();

    await manager.watchFile("/tmp/test.log", { origin: "single-file" });
    await manager.watchFile("src/**/*.ts", { origin: "glob", pattern: "src/**/*.ts" });

    await manager.unwatchFile("/tmp/test.log");

    const paths = manager.getWatchedPaths();

    // PASSES: existing behavior — paths are independent
    expect(paths).not.toContain("/tmp/test.log");
    expect(paths).toContain("src/**/*.ts");
  });

  test("unwatching glob does not affect single file watch", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();

    await manager.watchFile("/tmp/test.log", { origin: "single-file" });
    await manager.watchFile("src/**/*.ts", { origin: "glob", pattern: "src/**/*.ts" });

    await manager.unwatchFile("src/**/*.ts");

    const paths = manager.getWatchedPaths();

    // PASSES: existing behavior — paths are independent
    expect(paths).toContain("/tmp/test.log");
    expect(paths).not.toContain("src/**/*.ts");
  });
});

describe("Invalid patterns", () => {
  test("watchFile does not crash with empty string path", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();

    // PASSES: shouldn't throw
    expect(async () => {
      await manager.watchFile("");
    }).not.toThrow();
  });

  test("watchFile does not crash with malformed glob pattern", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();

    // PASSES: shouldn't throw
    expect(async () => {
      await manager.watchFile("[invalid");
    }).not.toThrow();
  });

  test("watchFile handles very long path gracefully", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();
    const longPath = "/tmp/" + "a".repeat(500) + "/file.log";

    // PASSES: shouldn't throw
    expect(async () => {
      await manager.watchFile(longPath);
    }).not.toThrow();
  });
});
