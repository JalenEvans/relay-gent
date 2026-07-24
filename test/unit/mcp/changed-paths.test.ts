import { describe, test, expect } from "bun:test";

/**
 * Tests for changed paths exposure in WatcherManager, MCP tools, and notifications.
 *
 * RED PHASE: These tests all fail because the features don't exist yet.
 * - WatcherManager has no getRecentChanges() method
 * - MCP get_status tool doesn't include recentChanges in response
 * - NotificationHandler doesn't store the changed path
 */

describe("Changed Paths Exposure", () => {
  // ================================================================
  // WatcherManager — changed path tracking
  // ================================================================

  describe("WatcherManager tracks changed paths", () => {
    test("getRecentChanges() returns an array (initially empty)", async () => {
      const { WatcherManager } = await import("../../../src/watcher");
      const manager = new WatcherManager();

      // FAILS: getRecentChanges() does not exist on WatcherManager
      const changes = manager.getRecentChanges();

      expect(Array.isArray(changes)).toBe(true);
      expect(changes).toHaveLength(0);
    });

    test("after a callback fires with a path, getRecentChanges() includes that path", async () => {
      const { WatcherManager } = await import("../../../src/watcher");
      const manager = new WatcherManager();
      const testPath = "/tmp/test.ts";

      // Set up the global file change callback
      manager.setOnFileChange((_event: string, path: string) => {
        // The implementation will store this path internally
      });

      // Fire the callback by retrieving and invoking it
      const cb = manager.getOnFileChange();
      expect(cb).toBeDefined();

      // Simulate a file change event
      cb!("change", testPath);

      // FAILS: getRecentChanges() doesn't exist, so paths aren't tracked
      const changes = manager.getRecentChanges();
      expect(changes).toContain(testPath);
    });

    test("multiple changes accumulate in the tracking array", async () => {
      const { WatcherManager } = await import("../../../src/watcher");
      const manager = new WatcherManager();
      const paths = ["/tmp/a.ts", "/tmp/b.ts", "/tmp/c.ts"];

      // Set up and fire callback for each path
      manager.setOnFileChange((_event: string, _path: string) => {
        // The implementation will accumulate these paths
      });

      const cb = manager.getOnFileChange()!;
      for (const p of paths) {
        cb("change", p);
      }

      // FAILS: getRecentChanges() doesn't exist
      const changes = manager.getRecentChanges();
      expect(changes.length).toBeGreaterThanOrEqual(3);
      for (const p of paths) {
        expect(changes).toContain(p);
      }
    });

    test("getRecentChanges() does not throw when no changes have occurred", async () => {
      const { WatcherManager } = await import("../../../src/watcher");
      const manager = new WatcherManager();

      // FAILS: getRecentChanges() doesn't exist — will throw TypeError
      expect(() => {
        manager.getRecentChanges();
      }).not.toThrow();
    });
  });

  // ================================================================
  // MCP get_status tool — recent changes in response
  // ================================================================

  describe("MCP get_status includes recent changes", () => {
    test("get_status tool handler returns an object with recentChanges property", async () => {
      const { registerTools } = await import("../../../src/mcp/tools");
      const { WatcherManager } = await import("../../../src/watcher");
      const { RecordStore } = await import("../../../src/state/record-store");

      // Capture tool handlers via mock server
      const handlers = new Map<string, Function>();
      const mockServer = {
        registerTool: (name: string, _config: any, cb: Function) => {
          handlers.set(name, cb);
        },
      };

      const watcher = new WatcherManager();
      const store = new RecordStore("test-get-status", "/tmp");
      registerTools(mockServer as any, watcher, store);

      const handler = handlers.get("get_status");
      expect(handler).toBeDefined();

      const result = await handler!({});
      const data = JSON.parse(result.content[0].text);

      // FAILS: get_status response has no recentChanges property
      expect(data).toHaveProperty("recentChanges");
    });

    test("recentChanges is an empty array when no changes have occurred", async () => {
      const { registerTools } = await import("../../../src/mcp/tools");
      const { WatcherManager } = await import("../../../src/watcher");
      const { RecordStore } = await import("../../../src/state/record-store");

      const handlers = new Map<string, Function>();
      const mockServer = {
        registerTool: (name: string, _config: any, cb: Function) => {
          handlers.set(name, cb);
        },
      };

      const watcher = new WatcherManager();
      const store = new RecordStore("test-empty-changes", "/tmp");
      registerTools(mockServer as any, watcher, store);

      const handler = handlers.get("get_status")!;
      const result = await handler({});
      const data = JSON.parse(result.content[0].text);

      // FAILS: recentChanges doesn't exist in the response
      expect(Array.isArray(data.recentChanges)).toBe(true);
      expect(data.recentChanges).toHaveLength(0);
    });

    test("recentChanges includes changed paths when changes have occurred", async () => {
      const { registerTools } = await import("../../../src/mcp/tools");
      const { WatcherManager } = await import("../../../src/watcher");
      const { RecordStore } = await import("../../../src/state/record-store");

      const handlers = new Map<string, Function>();
      const mockServer = {
        registerTool: (name: string, _config: any, cb: Function) => {
          handlers.set(name, cb);
        },
      };

      const watcher = new WatcherManager();

      // Simulate file changes by firing the callback
      // (This won't work because WatcherManager has no path tracking)
      const changedPath = "/tmp/changed-file.ts";
      watcher.setOnFileChange((_event: string, _path: string) => {
        // Implementation should track this
      });
      watcher.getOnFileChange()!("change", changedPath);

      const store = new RecordStore("test-with-changes", "/tmp");
      registerTools(mockServer as any, watcher, store);

      const handler = handlers.get("get_status")!;
      const result = await handler({});
      const data = JSON.parse(result.content[0].text);

      // FAILS: recentChanges doesn't exist
      expect(data.recentChanges).toBeDefined();
      expect(Array.isArray(data.recentChanges)).toBe(true);
      expect(data.recentChanges).toContain(changedPath);
    });
  });

  // ================================================================
  // Notification path info — onFileChange stores the path
  // ================================================================

  describe("Notification carries path info", () => {
    test("onFileChange stores the changed path in the notification handler", async () => {
      const { createNotificationHandler } = await import("../../../src/mcp/notifications");
      const handler = createNotificationHandler();
      const testPath = "/tmp/test.ts";

      handler.onFileChange(testPath);

      // FAILS: the handler doesn't expose the last changed path.
      // After implementation, the handler should store and expose it.
      const changedPath = (handler as any).lastChangedPath;
      expect(changedPath).toBe(testPath);
    });

    test("onFileChange stores multiple paths in sequence", async () => {
      const { createNotificationHandler } = await import("../../../src/mcp/notifications");
      const handler = createNotificationHandler();
      const paths = ["/tmp/first.ts", "/tmp/second.ts", "/tmp/third.ts"];

      for (const p of paths) {
        handler.onFileChange(p);
      }

      // FAILS: the handler doesn't track paths.
      // After implementation, the last call's path should be accessible.
      const changedPath = (handler as any).lastChangedPath;
      expect(changedPath).toBe(paths[paths.length - 1]);
    });

    test("onFileChange sends resource update with canonical URI and stores path on handler", async () => {
      const { createNotificationHandler } = await import("../../../src/mcp/notifications");

      let capturedUri = "";
      const mockServer = {
        server: {
          sendResourceUpdated: (opts: { uri: string }) => {
            capturedUri = opts.uri;
            return Promise.resolve();
          },
        },
      };

      const handler = createNotificationHandler();
      handler.setServer(mockServer as any);

      const testPath = "/tmp/test.ts";
      handler.onFileChange(testPath);

      // URI is the canonical resource URI (no query params); the
      // changed path is tracked via lastChangedPath on the handler
      expect(capturedUri).toBe("relay-gent://records");
      expect(handler.lastChangedPath).toBe(testPath);
    });

    test("onFileChange stores path even when no server is connected", async () => {
      const { createNotificationHandler } = await import("../../../src/mcp/notifications");
      const handler = createNotificationHandler();

      handler.onFileChange("/tmp/test.ts");

      // FAILS: the handler doesn't store the path at all.
      // Paths should be persisted regardless of server state.
      const storedPath = (handler as any).lastChangedPath;
      expect(storedPath).toBe("/tmp/test.ts");
    });
  });

  // ================================================================
  // Integration: WatcherManager -> Notification wiring
  // ================================================================

  describe("WatcherManager notification wiring", () => {
    test("setOnFileChange callback receives path and it reaches notification handler", async () => {
      const { WatcherManager } = await import("../../../src/watcher");
      const { createNotificationHandler } = await import("../../../src/mcp/notifications");

      const watcher = new WatcherManager();
      const notificationHandler = createNotificationHandler();

      let capturedPath: string | undefined;
      const trackingHandler = {
        onFileChange: (path: string) => {
          capturedPath = path;
          notificationHandler.onFileChange(path);
        },
        setServer: (s: any) => notificationHandler.setServer(s),
      };

      watcher.setOnFileChange((_event: string, path: string) => {
        trackingHandler.onFileChange(path);
      });

      // Fire the callback
      const cb = watcher.getOnFileChange()!;
      cb("change", "/tmp/wired-path.ts");

      expect(capturedPath).toBe("/tmp/wired-path.ts");

      // FAILS: notificationHandler doesn't expose the path
      const storedPath = (notificationHandler as any).lastChangedPath;
      expect(storedPath).toBe("/tmp/wired-path.ts");
    });
  });
});
