import { describe, test, expect, beforeAll } from "bun:test";
import { Command } from "commander";

describe("mcp CLI command", () => {
  let program: Command;

  beforeAll(async () => {
    const { createCli } = await import("../../../src/cli.js");
    program = createCli();
  });

  test("mcp subcommand is registered", () => {
    const cmd = program.commands.find((c) => c.name() === "mcp");
    expect(cmd).toBeDefined();
    expect(cmd?.description()).toBeDefined();
  });

  test("mcp subcommand has an action handler", () => {
    const cmd = program.commands.find((c) => c.name() === "mcp");
    expect(cmd).toBeDefined();
    expect((cmd as any)._actionHandler).toBeDefined();
  });
});