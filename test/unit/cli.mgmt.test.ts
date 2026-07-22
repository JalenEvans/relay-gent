import { afterAll, beforeEach, describe, expect, it, vi } from "bun:test";

// Import real modules for vi.spyOn-based mocking, which is scoped to this
// file unlike vi.mock which globally pollutes the module registry in Bun.
import * as configLoader from "../../src/config/loader";
import * as runnerModule from "../../src/application/runner";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";

import { createCli } from "../../src/cli";

// ============================================================
// Tests for the CLI management commands — updated after review to assert correct behavior
// ============================================================
// These tests validate the command-layer behaviour of the
// `stop`, `clean`, and `log` commands.
//
// Mocks are provided for loadConfig and Runner so that
// the command-layer logic can be tested without disk I/O
// or side effects. Filesystem operations (readFile, writeFile,
// readdir, rm) are spied on only within the test that needs
// them, preventing leakage across describe blocks.
// ============================================================

// ============================================================
// Mock State — vi.spyOn (file-scoped, does not leak globally)
// ============================================================

afterAll(() => {
  vi.restoreAllMocks();
});

let loadConfigSpy: ReturnType<typeof vi.spyOn>;
let runnerSpy: ReturnType<typeof vi.spyOn>;

const mockRunnerStart = vi.fn(async () => {});
const mockRunnerStop = vi.fn(async () => {});
const mockRunnerInstance = {
  start: mockRunnerStart,
  stop: mockRunnerStop,
};

// ============================================================
// Helpers — shared test utilities
// ============================================================

const MOCK_TARGETS: Record<string, Record<string, unknown>> = {
  web: {
    adapter: "opencode",
    watchPath: "./src",
    parser: "typescript",
    server_url: "http://localhost:4096",
  },
  api: {
    adapter: "opencode",
    watchPath: "./api",
    parser: "typescript",
    server_url: "http://localhost:4096",
  },
};

function baseConfig(
  targets: Record<string, Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    defaultAdapter: "opencode",
    defaults: { debounceMs: 300, maxRetries: 3, retryBackoffMs: 1000 },
    targets,
  };
}

/**
 * Run the CLI with the given argv and return captured
 * stdout, stderr, and the exit code.
 *
 * Works by:
 *   - Replacing stdout / stderr write with capture buffers
 *   - Calling cli.exitOverride() so Commander errors throw
 *   - Spying on process.exit so explicit calls don't terminate
 *   - Deriving exitCode from the CommanderError if present,
 *     otherwise from the exit spy
 */
async function runWithArgs(
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const cli = createCli();
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  let exitCode: number | null = null;

  const origStdout = process.stdout.write.bind(process.stdout);
  const origStderr = process.stderr.write.bind(process.stderr);

  process.stdout.write = ((chunk: string, ..._rest: unknown[]) => {
    stdoutChunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;

  process.stderr.write = ((chunk: string, ..._rest: unknown[]) => {
    stderrChunks.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;

  // Prevent handlers from calling process.exit() directly
  const exitSpy = vi.spyOn(process, "exit").mockImplementation(
    ((_code?: number) => {
      // Capture exit code without terminating
    }) as unknown as (code?: string | number | null | undefined) => never,
  );

  cli.exitOverride();

  try {
    await cli.parseAsync(args, { from: "user" });
  } catch (err: unknown) {
    // Commander throws CommanderError when exitOverride triggers
    const e = err as { code?: string; exitCode?: number };
    if (
      e.code === "commander.exit" ||
      e.code === "commander.executeSubCommandAsync"
    ) {
      exitCode = e.exitCode ?? 1;
    }
  } finally {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;

    // If process.exit was called directly (not via Commander),
    // the spy captured the exit code
    if (exitCode === null && exitSpy.mock.calls.length > 0) {
      exitCode = (exitSpy.mock.calls[0][0] as number) ?? 0;
    }

    exitSpy.mockRestore();
  }

  return {
    stdout: stdoutChunks.join(""),
    stderr: stderrChunks.join(""),
    exitCode,
  };
}

// ============================================================
// Stop Command Tests
// ============================================================

describe("stop command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadConfigSpy = vi.spyOn(configLoader, "loadConfig");
    runnerSpy = vi
      .spyOn(runnerModule, "Runner")
      // @ts-expect-error — mock constructor for testing
      .mockImplementation(() => mockRunnerInstance);
  });

  it("--target <name> prints process management message", async () => {
    loadConfigSpy.mockReturnValue(baseConfig(MOCK_TARGETS));
    const { stdout, exitCode } = await runWithArgs(["stop", "--target", "web"]);

    // Should print honest message about process management not being available
    expect(stdout).toMatch(/process management|not yet implemented/i);
    expect(exitCode).toBe(0);

    // Runner should NOT be created (cross-process stop doesn't work yet)
    expect(runnerSpy).not.toHaveBeenCalled();
  });

  it("--all prints process management message", async () => {
    loadConfigSpy.mockReturnValue(baseConfig(MOCK_TARGETS));
    const { stdout, exitCode } = await runWithArgs(["stop", "--all"]);

    // Should print honest message about process management not being available
    expect(stdout).toMatch(/process management|not yet implemented/i);
    expect(exitCode).toBe(0);

    // Runner should NOT be created (cross-process stop doesn't work yet)
    expect(runnerSpy).not.toHaveBeenCalled();
  });

  it("shows error and exits with code 1 when target is not found", async () => {
    loadConfigSpy.mockReturnValue(baseConfig(MOCK_TARGETS));
    const { stderr, exitCode } = await runWithArgs([
      "stop",
      "--target",
      "nonexistent",
    ]);

    // Must indicate the target was not found
    expect(stderr).toMatch(/not found/i);

    // Must fail with exit code 1
    expect(exitCode).toBe(1);
  });

  it("shows error and exits with code 1 when no targets configured", async () => {
    loadConfigSpy.mockReturnValue(baseConfig({}));
    const { stderr, exitCode } = await runWithArgs(["stop"]);

    // Must indicate no targets are available to stop
    expect(stderr).toMatch(/no targets|nothing|no.*stop/i);

    // Must fail with exit code 1
    expect(exitCode).toBe(1);
  });

  it("shows error and exits with code 1 when --target or --all not specified with configured targets", async () => {
    loadConfigSpy.mockReturnValue(baseConfig(MOCK_TARGETS));
    const { stderr, exitCode } = await runWithArgs(["stop"]);

    // Must ask for --target or --all
    expect(stderr).toMatch(/--target|--all/i);

    // Must fail with exit code 1
    expect(exitCode).toBe(1);
  });
});

// ============================================================
// Clean Command Tests
// ============================================================

describe("clean command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadConfigSpy = vi.spyOn(configLoader, "loadConfig");
  });

  it("without --force shows available targets and suggests using --force", async () => {
    loadConfigSpy.mockReturnValue(baseConfig(MOCK_TARGETS));
    const { stdout } = await runWithArgs(["clean"]);

    // Should not just print the stub message
    expect(stdout).not.toMatch(/not yet implemented/i);

    // Should mention the --force option or list what would be cleaned
    expect(stdout).toMatch(/force|target|would/i);
  });

  it("with --force removes state directories and confirms cleaning", async () => {
    loadConfigSpy.mockReturnValue(baseConfig(MOCK_TARGETS));
    const rmSyncSpy = vi.spyOn(fs, "rmSync").mockReturnValue(undefined);

    const { stdout } = await runWithArgs(["clean", "--force"]);

    // Should not just print the stub message
    expect(stdout).not.toMatch(/not yet implemented/i);

    // Should confirm that cleaning happened
    expect(stdout).toMatch(/cleaned|removed|done|✅|✔/i);

    // Should remove targets/ path (StateStore layout)
    expect(rmSyncSpy).toHaveBeenCalledWith(
      expect.stringContaining("targets"),
      expect.anything(),
    );

    rmSyncSpy.mockRestore();
  });

  it("shows message and exits with code 0 when nothing to clean", async () => {
    loadConfigSpy.mockReturnValue(baseConfig({}));
    const { stdout, exitCode } = await runWithArgs(["clean", "--force"]);

    // Must indicate there is nothing to clean
    expect(stdout).toMatch(/no.*target|nothing|no.*state|empty/i);

    // Should exit successfully (nothing to clean is not an error)
    expect(exitCode).toBe(0);
  });
});

// ============================================================
// Log Command Tests
// ============================================================

describe("log command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadConfigSpy = vi.spyOn(configLoader, "loadConfig");
  });

  it("--target <name> reads and shows log content", async () => {
    const logContent = "line1\nline2\nline3";
    const readFileSpy = vi
      .spyOn(fsPromises, "readFile")
      .mockResolvedValue(logContent);

    const { stdout } = await runWithArgs(["log", "--target", "web"]);

    // Should display the log file content
    expect(stdout).toContain("line1");
    expect(stdout).toContain("line2");

    readFileSpy.mockRestore();
  });

  it("--clear wipes the log file for the given target", async () => {
    const writeFileSpy = vi
      .spyOn(fsPromises, "writeFile")
      .mockResolvedValue(undefined);

    const { stdout } = await runWithArgs(["log", "--target", "web", "--clear"]);

    // Should have written an empty string or truncated the file
    expect(writeFileSpy).toHaveBeenCalled();

    // Should confirm the log was cleared
    expect(stdout).toMatch(/cleared|wiped|done/i);

    writeFileSpy.mockRestore();
  });

  it("without any options does not show the stub message", async () => {
    vi.spyOn(fsPromises, "readdir").mockResolvedValue([]);

    const { stdout, exitCode } = await runWithArgs(["log"]);

    // Should not just say "not yet implemented"
    expect(stdout).not.toMatch(/not yet implemented/i);

    // Should exit successfully (listing logs is not an error)
    expect(exitCode).toBe(0);

    vi.restoreAllMocks();
  });

  it("shows error and exits with code 1 when target is not found for log", async () => {
    loadConfigSpy.mockReturnValue(baseConfig(MOCK_TARGETS));
    const { stderr, exitCode } = await runWithArgs([
      "log",
      "--target",
      "nonexistent",
    ]);

    // Must indicate the target was not found
    expect(stderr).toMatch(/not found/i);

    // Must fail with exit code 1
    expect(exitCode).toBe(1);
  });

  it("rejects path traversal in target name", async () => {
    loadConfigSpy.mockReturnValue(baseConfig(MOCK_TARGETS));
    const { stderr, exitCode } = await runWithArgs([
      "log",
      "--target",
      "../../etc/passwd",
    ]);

    // Must reject path traversal characters
    expect(stderr).toMatch(/invalid target name/i);
    expect(exitCode).toBe(1);
  });

  it("rejects backslash in target name", async () => {
    loadConfigSpy.mockReturnValue(baseConfig(MOCK_TARGETS));
    const { stderr, exitCode } = await runWithArgs([
      "log",
      "--target",
      "web\\foo",
    ]);

    // Must reject backslash characters
    expect(stderr).toMatch(/invalid target name/i);
    expect(exitCode).toBe(1);
  });

  it("accepts valid target name before config checkfails", async () => {
    loadConfigSpy.mockReturnValue(baseConfig(MOCK_TARGETS));
    const { stderr, exitCode } = await runWithArgs([
      "log",
      "--target",
      "valid-target_123",
    ]);

    // Validation passes (name matches pattern), then fails on "target not found"
    expect(stderr).toMatch(/not found/i);
    expect(stderr).not.toMatch(/invalid target name/i);
    expect(exitCode).toBe(1);
  });
});
