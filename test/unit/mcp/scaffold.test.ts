import { describe, test, expect } from "bun:test";

describe("MCP module scaffold", () => {
  test("src/mcp/index.ts can be imported", async () => {
    const mod = await import("../../../src/mcp");
    expect(mod).toBeDefined();
    expect(mod.createApp).toBeDefined();
  });
});