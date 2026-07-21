import { beforeAll, describe, expect, it } from "bun:test";
import type { Command } from "commander";

// Dynamic import with cache-busting to avoid module-state leakage
// from other test files (e.g. cli.core.test.ts) that may have
// modified the shared module instance via spies or mocks. Bun
// caches ES module instances, so a static import would share
// the same config-loader instance that other files may have
// altered. Using a unique query parameter forces a fresh module
// evaluation with the real loadConfig implementation.
let createCli: () => Command;
beforeAll(async () => {
  const mod = await import("../../src/cli?t=" + Date.now());
  createCli = mod.createCli;
});

// ============================================================
// CLI Foundation — Phase 1
// ============================================================
// Tests the Commander-based CLI definition exported from
// src/cli.ts. All commands are stubs that print
// "Not yet implemented".
// ============================================================

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

/**
 * Runs the CLI with the given argv and returns captured stdout.
 * Uses Commander's exitOverride to prevent process.exit.
 */
async function runWithArgs(args: string[]): Promise<string> {
  const cli = createCli();
  const chunks: string[] = [];
  const errChunks: string[] = [];

  const origWrite = process.stdout.write.bind(process.stdout);
  const origErrWrite = process.stderr.write.bind(process.stderr);
  // @ts-expect-error - mocking stdout.write for test capture
  process.stdout.write = (chunk: string, ..._rest: unknown[]) => {
    chunks.push(String(chunk));
    return true;
  };
  // @ts-expect-error - mocking stderr.write for test capture
  process.stderr.write = (chunk: string, ..._rest: unknown[]) => {
    errChunks.push(String(chunk));
    return true;
  };

  cli.exitOverride();

  try {
    await cli.parseAsync(args, { from: "user" });
  } catch {
    // Commander throws a CommanderError when exitOverride is set
  } finally {
    process.stdout.write = origWrite;
    process.stderr.write = origErrWrite;
  }

  return chunks.join("") + errChunks.join("");
}

/** Returns all registered command names. */
function commandNames(): string[] {
  const cli = createCli();
  return cli.commands.map((cmd) => cmd.name());
}

/** Finds a command by name, throwing if not found. */
function getCommand(name: string): Command {
  const cli = createCli();
  const cmd = cli.commands.find((c) => c.name() === name);
  if (!cmd) {
    throw new Error(`Command "${name}" not registered`);
  }
  return cmd;
}

/** Returns the long option names for a command. */
function optionNames(cmd: Command): string[] {
  return cmd.options.map((opt) => opt.long);
}

// ============================================================
// 1. createCli returns a Command
// ============================================================

describe("createCli()", () => {
  it("returns a Commander Command instance", () => {
    const cli = createCli();
    expect(cli).toBeDefined();
    // Commander Command instances have parse and parseAsync methods
    expect(typeof cli.parse).toBe("function");
    expect(typeof cli.parseAsync).toBe("function");
  });

  it("has the correct program description", () => {
    const cli = createCli();
    expect(cli.description()).toBe("Watch files and relay changes to coding agents");
  });
});

// ============================================================
// 2. All 6 commands are registered
// ============================================================

describe("registered commands", () => {
  it("registers exactly 6 commands", () => {
    const names = commandNames();
    expect(names).toHaveLength(6);
  });

  it("registers the 'status' command", () => {
    expect(commandNames()).toContain("status");
  });

  it("registers the 'watch' command", () => {
    expect(commandNames()).toContain("watch");
  });

  it("registers the 'once' command", () => {
    expect(commandNames()).toContain("once");
  });

  it("registers the 'stop' command", () => {
    expect(commandNames()).toContain("stop");
  });

  it("registers the 'clean' command", () => {
    expect(commandNames()).toContain("clean");
  });

  it("registers the 'log' command", () => {
    expect(commandNames()).toContain("log");
  });
});

// ============================================================
// 3. Default command — status runs when no subcommand is given
// ============================================================

describe("default command", () => {
  it("has the status command configured as the default", () => {
    const cli = createCli();
    const defaultCmd = cli.commands.find(
      (cmd) =>
        // Commander stores isDefault as _isDefault internally
        (cmd as unknown as { _isDefault: boolean })._isDefault === true,
    );
    expect(defaultCmd).toBeDefined();
    expect((defaultCmd as Command).name()).toBe("status");
  });

  it("output includes status content when run with no arguments", async () => {
    const output = await runWithArgs([]);
    expect(output.length).toBeGreaterThan(0);
  });
});

// ============================================================
// 4. --help displays all commands
// ============================================================

describe("--help output", () => {
  it("contains the program description", async () => {
    const output = await runWithArgs(["--help"]);
    expect(output).toContain("Watch files and relay changes to coding agents");
  });

  it("lists the status command", async () => {
    const output = await runWithArgs(["--help"]);
    expect(output).toContain("status");
  });

  it("lists the watch command", async () => {
    const output = await runWithArgs(["--help"]);
    expect(output).toContain("watch");
  });

  it("lists the once command", async () => {
    const output = await runWithArgs(["--help"]);
    expect(output).toContain("once");
  });

  it("lists the stop command", async () => {
    const output = await runWithArgs(["--help"]);
    expect(output).toContain("stop");
  });

  it("lists the clean command", async () => {
    const output = await runWithArgs(["--help"]);
    expect(output).toContain("clean");
  });

  it("lists the log command", async () => {
    const output = await runWithArgs(["--help"]);
    expect(output).toContain("log");
  });
});

// ============================================================
// 5. Implemented commands produce meaningful output
// ============================================================

describe("command outputs", () => {
  it('status shows "No targets configured" by default', async () => {
    const output = await runWithArgs(["status"]);
    expect(output).toContain("No targets configured");
  });

  it("watch shows error for missing target", async () => {
    const output = await runWithArgs(["watch", "some-file"]);
    expect(output).toContain("Target name required");
  });

  it("once shows error for missing target", async () => {
    const output = await runWithArgs(["once", "some-file"]);
    expect(output).toContain("Target name required");
  });

  it('stop prints "Not yet implemented"', async () => {
    const output = await runWithArgs(["stop"]);
    expect(output).toMatch(/not yet implemented|Not yet implemented/i);
  });

  it('clean prints "Not yet implemented"', async () => {
    const output = await runWithArgs(["clean"]);
    expect(output).toMatch(/not yet implemented|Not yet implemented/i);
  });

  it('log prints "Not yet implemented"', async () => {
    const output = await runWithArgs(["log"]);
    expect(output).toMatch(/not yet implemented|Not yet implemented/i);
  });
});

// ============================================================
// 6. watch command: <file> argument and --target option
// ============================================================

describe("watch command arguments and options", () => {
  it("accepts a required <file> argument", () => {
    const cmd = getCommand("watch");
    expect(cmd.arguments).toBeDefined();
    expect(cmd.arguments.length).toBeGreaterThanOrEqual(1);
  });

  it("has a --target <name> option", () => {
    const cmd = getCommand("watch");
    expect(optionNames(cmd)).toContain("--target");
  });
});

// ============================================================
// 7. once command: <file> argument and --target option
// ============================================================

describe("once command arguments and options", () => {
  it("accepts a required <file> argument", () => {
    const cmd = getCommand("once");
    expect(cmd.arguments).toBeDefined();
    expect(cmd.arguments.length).toBeGreaterThanOrEqual(1);
  });

  it("has a --target <name> option", () => {
    const cmd = getCommand("once");
    expect(optionNames(cmd)).toContain("--target");
  });
});

// ============================================================
// 8. stop command: --target and --all options
// ============================================================

describe("stop command options", () => {
  it("has a --target <name> option", () => {
    const cmd = getCommand("stop");
    expect(optionNames(cmd)).toContain("--target");
  });

  it("has an --all option (flag, no value)", () => {
    const cmd = getCommand("stop");
    expect(optionNames(cmd)).toContain("--all");
  });
});

// ============================================================
// 9. clean command: --force option
// ============================================================

describe("clean command options", () => {
  it("has a --force option (flag, no value)", () => {
    const cmd = getCommand("clean");
    expect(optionNames(cmd)).toContain("--force");
  });
});

// ============================================================
// 10. log command: --target and --clear options
// ============================================================

describe("log command options", () => {
  it("has a --target <name> option", () => {
    const cmd = getCommand("log");
    expect(optionNames(cmd)).toContain("--target");
  });

  it("has a --clear option (flag, no value)", () => {
    const cmd = getCommand("log");
    expect(optionNames(cmd)).toContain("--clear");
  });
});
