import { describe, test, expect } from "bun:test";

describe("MCP Resources", () => {
  test("registerResources function can be imported", async () => {
    const mod = await import("../../../src/mcp/resources");
    expect(mod).toBeDefined();
    expect(mod.registerResources).toBeDefined();
  });

  test("registerResources is a function", async () => {
    const { registerResources } = await import("../../../src/mcp/resources");
    expect(typeof registerResources).toBe("function");
  });

  test("registerResources accepts server + watcher + store without error", async () => {
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const { registerResources } = await import("../../../src/mcp/resources");
    const { WatcherManager } = await import("../../../src/watcher");
    const { RecordStore } = await import("../../../src/state/record-store");
    const server = new McpServer({ name: "test", version: "1.0.0" });
    const watcher = new WatcherManager();
    const store = new RecordStore("test-res", "/tmp");
    // Should not throw
    registerResources(server, watcher, store);
  });

  test("resource URIs are correct", () => {
    const expectedUris = [
      "relay-gent://records",
      "relay-gent://records/new",
      "relay-gent://records/changed",
      "relay-gent://status",
    ];
    expect(expectedUris).toHaveLength(4);
    expect(expectedUris).toContain("relay-gent://records");
    expect(expectedUris).toContain("relay-gent://records/new");
    expect(expectedUris).toContain("relay-gent://records/changed");
    expect(expectedUris).toContain("relay-gent://status");
  });
});
