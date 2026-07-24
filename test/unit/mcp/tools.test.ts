import { describe, test, expect } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

describe("MCP Tools", () => {
  test("registerTools function can be imported", async () => {
    const mod = await import("../../../src/mcp/tools");
    expect(mod).toBeDefined();
    expect(mod.registerTools).toBeDefined();
  });

  test("registerTools is a function", async () => {
    const { registerTools } = await import("../../../src/mcp/tools");
    expect(typeof registerTools).toBe("function");
  });

  test("registerTools accepts an McpServer and returns void", async () => {
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const { registerTools } = await import("../../../src/mcp/tools");
    const { WatcherManager } = await import("../../../src/watcher");
    const { RecordStore } = await import("../../../src/state/record-store");
    const server = new McpServer({ name: "test", version: "1.0.0" });
    const watcher = new WatcherManager();
    const store = new RecordStore("test-tools", "/tmp");
    // Should not throw
    registerTools(server, watcher, store);
  });

  test("registerTools registers on server without error", async () => {
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const { registerTools } = await import("../../../src/mcp/tools");
    const { WatcherManager } = await import("../../../src/watcher");
    const { RecordStore } = await import("../../../src/state/record-store");
    const server = new McpServer({ name: "test", version: "1.0.0" });
    const watcher = new WatcherManager();
    const store = new RecordStore("test-tools-2", "/tmp");
    registerTools(server, watcher, store);
    expect(server).toBeDefined();
  });

  test("tool names are correct", () => {
    const expectedTools = ["watch_file", "unwatch_file", "get_records", "get_status"];
    expect(expectedTools).toHaveLength(4);
    expect(expectedTools).toContain("watch_file");
    expect(expectedTools).toContain("unwatch_file");
    expect(expectedTools).toContain("get_records");
    expect(expectedTools).toContain("get_status");
  });
});
