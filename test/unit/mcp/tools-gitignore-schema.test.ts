import { describe, test, expect } from "bun:test";

describe("watch_file tool schema — respectGitignore", () => {
  // ================================================================
  // Schema shape tests
  // ================================================================

  test("schema includes respectGitignore as optional boolean", async () => {
    const { registerTools } = await import("../../../src/mcp/tools");
    const { WatcherManager } = await import("../../../src/watcher");
    const { RecordStore } = await import("../../../src/state/record-store");

    let capturedConfig: any;
    const mockServer = {
      registerTool: (name: string, config: any, _cb: Function) => {
        if (name === "watch_file") capturedConfig = config;
      },
    };

    registerTools(
      mockServer as any,
      new WatcherManager(),
      new RecordStore("test-gg-shape", "/tmp"),
    );

    const optionsShape = capturedConfig.inputSchema.shape.options;
    expect(optionsShape).toBeDefined();

    // Unwrap optional() to get the inner object schema
    const innerOptions = optionsShape.unwrap();
    expect(innerOptions.shape.respectGitignore).toBeDefined();

    // respectGitignore should accept boolean values
    const respectGitignoreType = innerOptions.shape.respectGitignore;
    const trueResult = respectGitignoreType.safeParse(true);
    expect(trueResult.success).toBe(true);
    expect(trueResult.data).toBe(true);

    const falseResult = respectGitignoreType.safeParse(false);
    expect(falseResult.success).toBe(true);
    expect(falseResult.data).toBe(false);
  });

  // ================================================================
  // Schema validation tests
  // ================================================================

  test("schema rejects non-boolean respectGitignore", async () => {
    const { registerTools } = await import("../../../src/mcp/tools");
    const { WatcherManager } = await import("../../../src/watcher");
    const { RecordStore } = await import("../../../src/state/record-store");

    let capturedConfig: any;
    const mockServer = {
      registerTool: (name: string, config: any, _cb: Function) => {
        if (name === "watch_file") capturedConfig = config;
      },
    };

    registerTools(
      mockServer as any,
      new WatcherManager(),
      new RecordStore("test-gg-reject", "/tmp"),
    );

    const optionsShape = capturedConfig.inputSchema.shape.options;
    expect(optionsShape).toBeDefined();

    const innerOptions = optionsShape.unwrap();
    expect(innerOptions.shape.respectGitignore).toBeDefined();
    const respectGitignoreType = innerOptions.shape.respectGitignore;

    // String "yes" should be rejected
    const stringResult = respectGitignoreType.safeParse("yes");
    expect(stringResult.success).toBe(false);

    // Numeric 1 should be rejected
    const numResult = respectGitignoreType.safeParse(1);
    expect(numResult.success).toBe(false);
  });

  // ================================================================
  // Options forwarding test (through schema validation)
  // ================================================================

  test("watch_file handler passes parsed respectGitignore to watcher.watchFile", async () => {
    const { registerTools } = await import("../../../src/mcp/tools");
    const { WatcherManager } = await import("../../../src/watcher");
    const { RecordStore } = await import("../../../src/state/record-store");

    let capturedConfig: any;
    const handlers = new Map<string, Function>();
    const mockServer = {
      registerTool: (name: string, config: any, cb: Function) => {
        if (name === "watch_file") capturedConfig = config;
        handlers.set(name, cb);
      },
    };

    const watcher = new WatcherManager();

    let watchFileReceivedOptions: unknown = undefined;
    watcher.watchFile = async (_path: string, options?: unknown) => {
      watchFileReceivedOptions = options;
    };

    registerTools(
      mockServer as any,
      watcher,
      new RecordStore("test-fwd-gg", "/tmp"),
    );

    // Simulate the MCP SDK validation pipeline:
    // 1. Parse raw input through the inputSchema (this strips unknown fields)
    const rawInput = {
      path: "/tmp/test-project",
      options: {
        respectGitignore: false,
      },
    };
    const parsedInput = capturedConfig.inputSchema.parse(rawInput);

    // 2. Call the handler with the PARSED (schema-validated) input
    const handler = handlers.get("watch_file")!;
    await handler(parsedInput);

    // FAILS: the schema doesn't include respectGitignore yet, so
    // zod strips it during parse(). The handler receives a stripped
    // options object and the watcher never gets respectGitignore.
    expect(watchFileReceivedOptions).toBeDefined();
    expect(watchFileReceivedOptions).toHaveProperty("respectGitignore", false);
  });
});
