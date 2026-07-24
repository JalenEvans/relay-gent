import { describe, test, expect } from "bun:test";

describe("MCP Server Wiring", () => {
  // ================================================================
  // Test 1: Notification handler is wired to watcher events
  // ================================================================
  // createApp() in server.ts creates both a WatcherManager and a
  // NotificationHandler but NEVER calls watcher.setOnFileChange().
  // The watcher's internal callback stays undefined, so file change
  // events detected by the watcher never reach the notification
  // handler that sends resource-updated notifications to the MCP client.
  // ----------------------------------------------------------------

  test("createApp wires notificationHandler.onFileChange to watcher.setOnFileChange", async () => {
    const { createApp } = await import("../../../src/mcp/server");
    const { watcher } = createApp("test-wiring-1");

    // FAILS: createApp never calls watcher.setOnFileChange(), so
    // getOnFileChange() returns undefined.
    // Once wiring is added in server.ts, this will return a function.
    expect(watcher.getOnFileChange()).toBeDefined();
  });

  test("watcher callback is set and callable without error after createApp", async () => {
    const { createApp } = await import("../../../src/mcp/server");
    const { watcher } = createApp("test-wiring-2");

    // FAILS: since setOnFileChange() is never called, the callback is
    // undefined. Trying to call it throws TypeError.
    // When server.ts wires it, this will pass cleanly.
    const cb = watcher.getOnFileChange();
    expect(() => {
      // Non-null assertion tells TS to treat it as callable;
      // at runtime cb is undefined so this throws → test fails
      (cb as Exclude<typeof cb, undefined>)("change", "/tmp/test.log");
    }).not.toThrow();
  });

  // ================================================================
  // Test 2: watch_file tool supports creating a watcher with options
  // ================================================================
  // tools.ts defines the watch_file inputSchema with only a `path`
  // string (no `options`), and the handler calls
  //   watcher.watchFile(path)
  // without forwarding any user-supplied options.
  // Once fixed, the schema should include an optional `options` field
  // and the handler should forward it to watcher.watchFile(path, options).
  // ----------------------------------------------------------------

  test("watch_file tool schema includes optional options field", async () => {
    const { registerTools } = await import("../../../src/mcp/tools");
    const { WatcherManager } = await import("../../../src/watcher");
    const { RecordStore } = await import("../../../src/state/record-store");

    // Capture the config passed to registerTool for watch_file
    let capturedConfig: any;
    const mockServer = {
      registerTool: (name: string, config: any, _cb: Function) => {
        if (name === "watch_file") capturedConfig = config;
      },
    };

    registerTools(
      mockServer as any,
      new WatcherManager(),
      new RecordStore("test-schema", "/tmp"),
    );

    // FAILS: the current inputSchema only defines { path: z.string() },
    // with no `options` field. Adding options to the schema will make
    // this assertion pass.
    expect(capturedConfig.inputSchema.shape.options).toBeDefined();
  });

  test("watch_file tool handler passes options to watcher.watchFile", async () => {
    const { registerTools } = await import("../../../src/mcp/tools");
    const { WatcherManager } = await import("../../../src/watcher");
    const { RecordStore } = await import("../../../src/state/record-store");

    // Capture tool handlers from registerTool
    const handlers = new Map<string, Function>();
    const mockServer = {
      registerTool: (name: string, _config: any, cb: Function) => {
        handlers.set(name, cb);
      },
    };

    const watcher = new WatcherManager();

    // Spy on watcher.watchFile to capture what arguments it receives
    let watchFileReceivedOptions: unknown = undefined;
    watcher.watchFile = async (_path: string, options?: unknown) => {
      watchFileReceivedOptions = options;
    };

    registerTools(
      mockServer as any,
      watcher,
      new RecordStore("test-options", "/tmp"),
    );

    // Invoke the watch_file handler with path + options
    const handler = handlers.get("watch_file")!;
    await handler({
      path: "/tmp/test-project",
      options: { origin: "directory", pattern: "/tmp/test-project/**/*" },
    });

    // FAILS: the current handler calls watcher.watchFile(path) without
    // forwarding the options argument.
    expect(watchFileReceivedOptions).toBeDefined();
    expect(watchFileReceivedOptions).toEqual({
      origin: "directory",
      pattern: "/tmp/test-project/**/*",
    });
  });

  // ================================================================
  // Test 3: Watcher status includes per-watch details
  // ================================================================
  // resources.ts registers a relay-gent://status resource that returns
  // { watchedPaths, watching, totalDelivered }. It does NOT include
  // per-watch configuration like origin or pattern, even though the
  // WatcherManager stores this via watcher.getWatcherOptions(path)
  // and watcher.getAllStates(). The status resource should expose
  // per-watch details so MCP clients can inspect individual watchers.
  // ----------------------------------------------------------------

  test("watcher status resource includes per-watch origin and pattern", async () => {
    const { registerResources } = await import("../../../src/mcp/resources");
    const { WatcherManager } = await import("../../../src/watcher");
    const { RecordStore } = await import("../../../src/state/record-store");

    // Capture the resource read callback for relay-gent://status
    let statusHandler: Function | undefined;
    const mockServer = {
      resource: (_name: string, uri: string, _meta: any, cb: Function) => {
        if (uri === "relay-gent://status") statusHandler = cb;
      },
    };

    const watcher = new WatcherManager();

    // Watch a path with explicit options so the watcher stores origin/pattern
    await watcher.watchFile("/tmp/test-glob-watch", {
      origin: "glob",
      pattern: "/tmp/test-glob-watch/**/*.log",
    });

    registerResources(
      mockServer as any,
      watcher,
      new RecordStore("test-status", "/tmp"),
    );

    const result = await statusHandler!();
    const parsed = JSON.parse(result.contents[0].text);

    // FAILS: the current handler only serializes:
    //   { watchedPaths: [...], watching: N, totalDelivered: N }
    // It does not include per-watch details like origin or pattern.
    // The `watches` array should contain one entry per watched path
    // with properties like origin, pattern, and active status.
    expect(parsed.watches).toBeDefined();
    expect(parsed.watches).toHaveLength(1);
    expect(parsed.watches[0]).toHaveProperty("origin", "glob");
    expect(parsed.watches[0]).toHaveProperty("pattern");
  });
});
