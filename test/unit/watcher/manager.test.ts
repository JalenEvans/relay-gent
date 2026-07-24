import { describe, test, expect, beforeAll } from "bun:test";

describe("WatcherManager", () => {
  test("can be imported from src/watcher", async () => {
    const mod = await import("../../../src/watcher");
    expect(mod).toBeDefined();
    expect(mod.WatcherManager).toBeDefined();
  });

  test("WatcherManager is a class", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    expect(typeof WatcherManager).toBe("function");
  });

  test("WatcherManager can be instantiated", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();
    expect(manager).toBeDefined();
    expect(manager.watchFile).toBeDefined();
    expect(manager.unwatchFile).toBeDefined();
    expect(manager.getWatchedPaths).toBeDefined();
  });

  test("watchFile registers a path", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();
    await manager.watchFile("/tmp/test-file.log");
    const paths = manager.getWatchedPaths();
    expect(paths).toContain("/tmp/test-file.log");
  });

  test("unwatchFile removes a path", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();
    await manager.watchFile("/tmp/test-file.log");
    await manager.unwatchFile("/tmp/test-file.log");
    const paths = manager.getWatchedPaths();
    expect(paths).not.toContain("/tmp/test-file.log");
  });
});
