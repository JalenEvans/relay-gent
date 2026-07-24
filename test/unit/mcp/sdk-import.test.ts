import { describe, test, expect } from "bun:test";

describe("MCP SDK", () => {
  test("McpServer can be imported from @modelcontextprotocol/sdk", async () => {
    const mod = await import("@modelcontextprotocol/sdk/server/mcp.js");
    expect(mod.McpServer).toBeDefined();
    expect(typeof mod.McpServer).toBe("function");
  });

  test("StdioServerTransport can be imported", async () => {
    const mod = await import("@modelcontextprotocol/sdk/server/stdio.js");
    expect(mod.StdioServerTransport).toBeDefined();
    expect(typeof mod.StdioServerTransport).toBe("function");
  });
});
