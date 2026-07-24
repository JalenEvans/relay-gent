import { beforeAll, describe, expect, it } from "bun:test";
import type { Command } from "commander";

let createCli: () => Command;
beforeAll(async () => {
  const mod = await import("../../src/cli.js");
  createCli = mod.createCli;
});

function getProgram(): Command {
  const program = createCli();
  return program;
}

function commandNames(): string[] {
  return getProgram().commands.map((c) => c.name());
}

describe("relay-gent CLI", () => {
  it("creates a CLI program", () => {
    const program = getProgram();
    expect(program).toBeDefined();
    expect(program.description()).toBeTruthy();
  });
});

describe("registered commands", () => {
  it("registers exactly 1 command", () => {
    const names = commandNames();
    expect(names).toHaveLength(1);
  });

  it("registers the 'mcp' command", () => {
    expect(commandNames()).toContain("mcp");
  });
});

describe("default command", () => {
  it("has the mcp command configured as the default", () => {
    const program = getProgram();
    const defaultCmd = program.commands.find(
      (cmd: Command) =>
        (cmd as unknown as { _isDefault: boolean })._isDefault === true,
    );
    expect(defaultCmd).toBeDefined();
    expect((defaultCmd as Command).name()).toBe("mcp");
  });
});
