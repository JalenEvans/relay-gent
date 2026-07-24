import { describe, test, expect } from "bun:test";

describe("MCP Notifications", () => {
  test("notification module can be imported", async () => {
    const mod = await import("../../../src/mcp/notifications");
    expect(mod).toBeDefined();
    expect(mod.createNotificationHandler).toBeDefined();
  });

  test("createNotificationHandler is a function", async () => {
    const { createNotificationHandler } = await import("../../../src/mcp/notifications");
    expect(typeof createNotificationHandler).toBe("function");
  });

  test("createNotificationHandler returns handler with onFileChange method", async () => {
    const { createNotificationHandler } = await import("../../../src/mcp/notifications");
    const handler = createNotificationHandler();
    expect(handler).toBeDefined();
    expect(handler.onFileChange).toBeDefined();
    expect(typeof handler.onFileChange).toBe("function");
  });

  test("onFileChange accepts a file path without error", async () => {
    const { createNotificationHandler } = await import("../../../src/mcp/notifications");
    const handler = createNotificationHandler();
    // Should not throw
    handler.onFileChange("/tmp/test.log");
  });
});
