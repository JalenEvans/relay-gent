import { describe, test, expect } from "bun:test";

// ============================================================
// FileChangeCallback — event callback type for file changes
// ============================================================
// Expected type (exported from src/watcher/types):
//   FileChangeCallback = (event: string, path: string) => void
//
// Since type aliases are erased at runtime, we validate through
// the WatcherManager methods that consume this type.
// ============================================================

describe("FileChangeCallback", () => {
  test("setOnFileChange method exists on WatcherManager", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();
    expect(manager).toHaveProperty("setOnFileChange");
    expect(typeof manager.setOnFileChange).toBe("function");
  });

  test("getOnFileChange method exists on WatcherManager", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();
    expect(manager).toHaveProperty("getOnFileChange");
    expect(typeof manager.getOnFileChange).toBe("function");
  });

  test("setOnFileChange stores a callback function", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();
    const callback = (event: string, path: string) => {};
    manager.setOnFileChange(callback);
    const stored = manager.getOnFileChange();
    expect(stored).toBe(callback);
  });

  test("setOnFileChange overrides previous callback", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();
    const cb1 = (event: string, path: string) => {};
    const cb2 = (event: string, path: string) => {};
    manager.setOnFileChange(cb1);
    manager.setOnFileChange(cb2);
    expect(manager.getOnFileChange()).toBe(cb2);
    expect(manager.getOnFileChange()).not.toBe(cb1);
  });

  test("getOnFileChange returns undefined when no callback is set", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();
    expect(manager.getOnFileChange()).toBeUndefined();
  });

  test("stored callback receives event type and path", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();
    let captured: { event: string; path: string } | null = null;
    const callback = (event: string, path: string) => {
      captured = { event, path };
    };
    manager.setOnFileChange(callback);
    const stored = manager.getOnFileChange();
    expect(stored).toBeDefined();
    stored!("change", "/tmp/test.txt");
    expect(captured!).toEqual({ event: "change", path: "/tmp/test.txt" });
  });
});

// ============================================================
// WatcherOptions — configuration for watch origins
// ============================================================
// Expected interface (exported from src/watcher/types):
//   WatcherOptions {
//     origin?: "single-file" | "glob" | "directory";
//     pattern?: string;
//   }
//
// Validated through watchFile() overload + getWatcherOptions().
// ============================================================

describe("WatcherOptions", () => {
  test("watchFile accepts optional options parameter with origin", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();
    await manager.watchFile("/tmp/test.log", { origin: "single-file" });
    const opts = manager.getWatcherOptions("/tmp/test.log");
    expect(opts).toBeDefined();
    expect(opts?.origin).toBe("single-file");
  });

  test("watchFile accepts options with glob origin", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();
    await manager.watchFile("/tmp/**/*.log", { origin: "glob", pattern: "**/*.log" });
    const opts = manager.getWatcherOptions("/tmp/**/*.log");
    expect(opts).toBeDefined();
    expect(opts?.origin).toBe("glob");
    expect(opts?.pattern).toBe("**/*.log");
  });

  test("watchFile accepts options with directory origin", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();
    await manager.watchFile("/tmp/logs", { origin: "directory" });
    const opts = manager.getWatcherOptions("/tmp/logs");
    expect(opts).toBeDefined();
    expect(opts?.origin).toBe("directory");
  });

  test("watchFile accepts options with only pattern", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();
    await manager.watchFile("/tmp/data.json", { pattern: "*.json" });
    const opts = manager.getWatcherOptions("/tmp/data.json");
    expect(opts).toBeDefined();
    expect(opts?.pattern).toBe("*.json");
    // origin should be undefined when not provided
    expect(opts?.origin).toBeUndefined();
  });

  test("watchFile works without options parameter (backward compatibility)", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();
    await manager.watchFile("/tmp/test.log");
    const paths = manager.getWatchedPaths();
    expect(paths).toContain("/tmp/test.log");
  });

  test("getWatcherOptions is a function on WatcherManager", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();
    expect(manager).toHaveProperty("getWatcherOptions");
    expect(typeof manager.getWatcherOptions).toBe("function");
  });

  test("getWatcherOptions returns undefined for unwatched path", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();
    expect(manager.getWatcherOptions("/nonexistent")).toBeUndefined();
  });
});

// ============================================================
// WatcherState — enhanced with origin information
// ============================================================
// Expected additions to WatcherState (in src/watcher/types):
//   origin?: "single-file" | "glob" | "directory";
//   pattern?: string;
// ============================================================

describe("WatcherState with origin info", () => {
  test("getWatcherState returns state with origin when watching with origin", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();
    await manager.watchFile("/tmp/test.log", { origin: "directory" });
    const state = manager.getWatcherState("/tmp/test.log");
    expect(state).toBeDefined();
    expect(state?.origin).toBe("directory");
  });

  test("getWatcherState returns state with pattern when watching with pattern", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();
    await manager.watchFile("/tmp/test.log", { pattern: "*.log" });
    const state = manager.getWatcherState("/tmp/test.log");
    expect(state).toBeDefined();
    expect(state?.pattern).toBe("*.log");
  });

  test("getWatcherState returns state without origin when watching without options", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();
    await manager.watchFile("/tmp/test.log");
    const state = manager.getWatcherState("/tmp/test.log");
    expect(state).toBeDefined();
    expect(state?.origin).toBeUndefined();
    expect(state?.pattern).toBeUndefined();
  });
});

// ============================================================
// NotificationHandler wiring — connecting watcher events to MCP
// ============================================================
// The onFileChange callback from WatcherManager should wire into
// NotificationHandler.onFileChange for MCP resource notifications.
// ============================================================

describe("NotificationHandler wiring", () => {
  test("getOnFileChange returns a callable function when callback is set", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();
    const callback = (event: string, path: string) => {};
    manager.setOnFileChange(callback);
    const stored = manager.getOnFileChange();
    expect(typeof stored).toBe("function");
  });

  test("callback can be connected to NotificationHandler.onFileChange", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const { createNotificationHandler } = await import(
      "../../../src/mcp/notifications"
    );
    const manager = new WatcherManager();
    const handler = createNotificationHandler();

    // Wire the watcher callback to the notification handler
    manager.setOnFileChange((_event: string, filePath: string) => {
      handler.onFileChange(filePath);
    });

    const stored = manager.getOnFileChange();
    expect(stored).toBeDefined();

    // Simulate a file change event — should not throw
    stored!("change", "/tmp/test.log");
  });
});
