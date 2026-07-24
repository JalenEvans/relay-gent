import { describe, test, expect } from "bun:test";
import * as z from "zod";

describe("watch_file tool schema", () => {
  // ================================================================
  // Schema shape tests
  // ================================================================

  test("watch_file tool schema includes extensions as optional string array", async () => {
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
      new RecordStore("test-ext-schema", "/tmp"),
    );

    const optionsShape = capturedConfig.inputSchema.shape.options;
    expect(optionsShape).toBeDefined();

    // Unwrap optional() to get the inner object schema
    const innerOptions = optionsShape.unwrap();
    expect(innerOptions.shape.extensions).toBeDefined();

    // extensions should be an optional array of strings
    const extensionsType = innerOptions.shape.extensions;
    // It's optional, and when provided it should be an array of strings
    // We can check by parsing valid and invalid values
    const parseResult = extensionsType.safeParse([".ts", ".js"]);
    expect(parseResult.success).toBe(true);
    expect(parseResult.data).toEqual([".ts", ".js"]);
  });

  test("watch_file tool schema includes debounceMs as optional non-negative integer", async () => {
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
      new RecordStore("test-db-schema", "/tmp"),
    );

    const optionsShape = capturedConfig.inputSchema.shape.options;
    expect(optionsShape).toBeDefined();

    const innerOptions = optionsShape.unwrap();
    expect(innerOptions.shape.debounceMs).toBeDefined();

    // debounceMs should accept a non-negative integer
    const debounceMsType = innerOptions.shape.debounceMs;
    const parseResult = debounceMsType.safeParse(500);
    expect(parseResult.success).toBe(true);
    expect(parseResult.data).toBe(500);
  });

  // ================================================================
  // Schema validation tests
  // ================================================================

  test("schema rejects negative debounceMs", async () => {
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
      new RecordStore("test-neg-db", "/tmp"),
    );

    const optionsShape = capturedConfig.inputSchema.shape.options;
    const innerOptions = optionsShape.unwrap();
    const debounceMsType = innerOptions.shape.debounceMs;

    // SAFE_PARSE → negative number should be rejected
    const result = debounceMsType.safeParse(-1);
    expect(result.success).toBe(false);
  });

  test("schema rejects non-integer debounceMs", async () => {
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
      new RecordStore("test-float-db", "/tmp"),
    );

    const optionsShape = capturedConfig.inputSchema.shape.options;
    const innerOptions = optionsShape.unwrap();
    const debounceMsType = innerOptions.shape.debounceMs;

    // Float values should be rejected since debounceMs is .int()
    const result = debounceMsType.safeParse(500.5);
    expect(result.success).toBe(false);
  });

  test("schema validates that extensions contains strings", async () => {
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
      new RecordStore("test-ext-val", "/tmp"),
    );

    const optionsShape = capturedConfig.inputSchema.shape.options;
    const innerOptions = optionsShape.unwrap();

    // Full options object validation: strings in extensions should pass
    const goodParse = innerOptions.safeParse({
      extensions: [".ts", ".js"],
    });
    expect(goodParse.success).toBe(true);

    // Non-strings in extensions should be rejected
    const badParse = innerOptions.safeParse({
      extensions: [42, true],
    });
    expect(badParse.success).toBe(false);
  });

  // ================================================================
  // Options forwarding tests (through schema validation)
  // ================================================================
  // The MCP SDK validates input through the inputSchema before
  // calling the handler. Since the current schema lacks extensions
  // and debounceMs, zod strips them from the parsed result. These
  // tests simulate that pipeline by parsing through the schema first,
  // then passing the parsed (stripped) result to the handler.

  test("watch_file handler passes parsed extensions to watcher.watchFile", async () => {
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
      new RecordStore("test-fwd-ext", "/tmp"),
    );

    // Simulate the MCP SDK validation pipeline:
    // 1. Parse raw input through the inputSchema (this strips unknown fields)
    const rawInput = {
      path: "/tmp/test-project",
      options: {
        extensions: [".ts", ".js"],
        debounceMs: 500,
      },
    };
    const parsedInput = capturedConfig.inputSchema.parse(rawInput);

    // 2. Call the handler with the PARSED (schema-validated) input
    const handler = handlers.get("watch_file")!;
    await handler(parsedInput);

    // FAILS: the schema doesn't include extensions/debounceMs yet, so
    // zod strips them during parse(). The handler receives a stripped
    // options object and the watcher never gets extensions/debounceMs.
    expect(watchFileReceivedOptions).toBeDefined();
    expect(watchFileReceivedOptions).toHaveProperty("extensions", [".ts", ".js"]);
    expect(watchFileReceivedOptions).toHaveProperty("debounceMs", 500);
  });

  test("watch_file handler passes parsed debounceMs to watcher.watchFile", async () => {
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
      new RecordStore("test-fwd-db", "/tmp"),
    );

    // Simulate the MCP SDK validation pipeline
    const rawInput = {
      path: "/tmp/test-project",
      options: {
        debounceMs: 1000,
      },
    };
    const parsedInput = capturedConfig.inputSchema.parse(rawInput);

    const handler = handlers.get("watch_file")!;
    await handler(parsedInput);

    // FAILS: schema doesn't include debounceMs, stripped during parse
    expect(watchFileReceivedOptions).toBeDefined();
    expect(watchFileReceivedOptions).toHaveProperty("debounceMs", 1000);
  });

  test("watch_file handler passes parsed extensions with origin/pattern to watcher.watchFile", async () => {
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
      new RecordStore("test-fwd-ext-only", "/tmp"),
    );

    // Simulate MCP SDK validation pipeline
    const rawInput = {
      path: "/tmp/test-project",
      options: {
        extensions: [".log"],
        origin: "glob",
        pattern: "**/*.log",
      },
    };
    const parsedInput = capturedConfig.inputSchema.parse(rawInput);

    const handler = handlers.get("watch_file")!;
    await handler(parsedInput);

    // FAILS: schema doesn't include extensions, stripped during parse.
    // Only origin and pattern survive because they're in the schema.
    expect(watchFileReceivedOptions).toBeDefined();
    expect(watchFileReceivedOptions).toHaveProperty("extensions", [".log"]);
    expect(watchFileReceivedOptions).toHaveProperty("origin", "glob");
    expect(watchFileReceivedOptions).toHaveProperty("pattern", "**/*.log");
  });
});
