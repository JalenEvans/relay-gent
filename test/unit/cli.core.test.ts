import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as os from "node:os";
import { createCli } from "../../src/cli";

// Import real modules for vi.spyOn-based mocking, which is scoped to this
// file unlike vi.mock which globally pollutes the module registry in Bun.
import * as configLoader from "../../src/config/loader";
import * as runnerModule from "../../src/application/runner";
import * as processModule from "../../src/process";

// ============================================================
// Tests for the CLI core commands — updated after review to assert correct behavior
// ============================================================
// These tests validate the command-layer behaviour of the
// `status`, `watch`, and `once` commands that implement
// the core workflow.
//
// Mocks are provided for loadConfig and Runner so that
// the command-layer logic can be tested without disk I/O
// or file-watcher side effects.
// ============================================================

// ============================================================
// Mock State — vi.spyOn (file-scoped, does not leak globally)
// ============================================================

// After all tests in this file complete, restore all spied-on
// functions so other test files see the real implementations.
afterAll(() => {
  vi.restoreAllMocks();
});

let loadConfigSpy: ReturnType<typeof vi.spyOn>;

const mockRunnerStart = vi.fn(async () => {});
const mockRunnerStop = vi.fn(async () => {});
const mockRunnerInstance = {
  start: mockRunnerStart,
  stop: mockRunnerStop,
};
let runnerSpy: ReturnType<typeof vi.spyOn>;
let processMgrSpy: ReturnType<typeof vi.spyOn>;

const mockProcessManager = {
  start: vi.fn(),
  stop: vi.fn(),
  status: vi.fn(),
  cleanTarget: vi.fn(),
  getPidPath: vi.fn(),
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
// Status Command Tests
// ============================================================

describe("status command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(os, "homedir").mockReturnValue("/tmp/relay-gent-test-home");
    loadConfigSpy = vi.spyOn(configLoader, "loadConfig");
  });

  it("is executable without arguments and exits with code 0", async () => {
    loadConfigSpy.mockReturnValue(baseConfig());
    const { stdout, exitCode } = await runWithArgs([]);

    // Status should produce output (table, list, or message)
    expect(stdout.length).toBeGreaterThan(0);

    // Status should exit successfully
    expect(exitCode).toBe(0);
  });

  it("includes target names in output when config has targets", async () => {
    loadConfigSpy.mockReturnValue(baseConfig(MOCK_TARGETS));
    const { stdout, exitCode } = await runWithArgs(["status"]);

    // The status output should mention the configured target name
    expect(stdout).toContain("web");

    // Should display as a table row or show status indicator
    expect(stdout).toMatch(/ \||idle/);

    // Should exit successfully
    expect(exitCode).toBe(0);
  });

  it("handles missing targets gracefully without crashing", async () => {
    loadConfigSpy.mockReturnValue(baseConfig({}));
    const { stdout, exitCode } = await runWithArgs(["status"]);

    // Should not just print the stub message
    expect(stdout).not.toMatch(/not yet implemented/i);

    // Should still exit successfully even with empty config
    expect(exitCode).toBe(0);
  });
});

// ============================================================
// Watch Command Tests
// ============================================================

describe("watch command", () => {
  let tmpDir: string;
  let tmpFile: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(os, "homedir").mockReturnValue("/tmp/relay-gent-test-home");
    loadConfigSpy = vi.spyOn(configLoader, "loadConfig");
    runnerSpy = vi
      .spyOn(runnerModule, "Runner")
      // @ts-expect-error — mock constructor for testing
      .mockImplementation(() => mockRunnerInstance);
    processMgrSpy = vi
      .spyOn(processModule, "ProcessManager")
      // @ts-expect-error — mock constructor for testing
      .mockImplementation(() => mockProcessManager);

    tmpDir = await mkdtemp(join(tmpdir(), "relay-gent-watch-"));
    tmpFile = join(tmpDir, "test-file.md");
    await writeFile(tmpFile, "test content", "utf-8");
  });

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("shows error and exits with code 1 when target is not found", async () => {
    loadConfigSpy.mockReturnValue(baseConfig({}));
    const { stderr, exitCode } = await runWithArgs([
      "watch",
      "test.md",
      "--target",
      "nonexistent",
    ]);

    // Must indicate the target was not found
    expect(stderr).toMatch(/not found/i);

    // Must fail with exit code 1
    expect(exitCode).toBe(1);
  });

  it("shows error and exits with code 1 when file does not exist", async () => {
    loadConfigSpy.mockReturnValue(baseConfig(MOCK_TARGETS));
    const { stderr, exitCode } = await runWithArgs([
      "watch",
      "/nonexistent-xyzzy-relay-gent-test-file.md",
      "--target",
      "web",
    ]);

    // Must indicate the file was not found
    expect(stderr).toMatch(/not found|does not exist/i);

    // Must fail with exit code 1
    expect(exitCode).toBe(1);
  });

  it("does not create a Runner when target is missing", async () => {
    loadConfigSpy.mockReturnValue(baseConfig({}));
    await runWithArgs(["watch", "test.md", "--target", "nonexistent"]);

    // Runner constructor should never be called for invalid targets
    expect(runnerSpy).not.toHaveBeenCalled();
  });

  it("does not create a Runner when file is missing", async () => {
    loadConfigSpy.mockReturnValue(baseConfig(MOCK_TARGETS));
    await runWithArgs([
      "watch",
      "/nonexistent-xyzzy-file.md",
      "--target",
      "web",
    ]);

    // Runner constructor should never be called for missing files
    expect(runnerSpy).not.toHaveBeenCalled();
  });

  it("--background flag calls ProcessManager.start()", async () => {
    loadConfigSpy.mockReturnValue(baseConfig(MOCK_TARGETS));
    mockProcessManager.start.mockResolvedValue(undefined);
    const { exitCode } = await runWithArgs([
      "watch",
      tmpFile,
      "--target",
      "web",
      "--background",
    ]);

    // ProcessManager constructor should be called with the targets base dir
    expect(processMgrSpy).toHaveBeenCalledTimes(1);
    expect(processMgrSpy).toHaveBeenCalledWith(
      expect.stringContaining(".relay-gent/targets"),
    );

    // ProcessManager.start should be called with the target name
    expect(mockProcessManager.start).toHaveBeenCalledWith("web");

    // Runner should NOT be created when running in background mode
    expect(runnerSpy).not.toHaveBeenCalled();

    // No errors expected
    expect(exitCode).toBe(0);
  });

  it("without --background still uses Runner with foreground:true", async () => {
    loadConfigSpy.mockReturnValue(baseConfig(MOCK_TARGETS));
    const { exitCode } = await runWithArgs([
      "watch",
      tmpFile,
      "--target",
      "web",
    ]);

    // Runner constructor should have been called with the target config
    expect(runnerSpy).toHaveBeenCalledTimes(1);
    expect(runnerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ adapter: "opencode" }),
      expect.anything(), // parser
      expect.anything(), // adapter
      expect.anything(), // delta
      expect.anything(), // store
    );

    // Runner.start should have been called with foreground:true
    expect(mockRunnerStart).toHaveBeenCalledTimes(1);
    expect(mockRunnerStart).toHaveBeenCalledWith({ foreground: true });

    // ProcessManager should NOT be created when running in foreground mode
    expect(processMgrSpy).not.toHaveBeenCalled();

    // Foreground watch runs indefinitely — no explicit exitProgram call,
    // so exitCode remains null (not an error state)
    expect(exitCode).toBeNull();
  });
});

// ============================================================
// Once Command Tests
// ============================================================

describe("once command", () => {
  let tmpDir: string;
  let tmpFile: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    loadConfigSpy = vi.spyOn(configLoader, "loadConfig");
    runnerSpy = vi
      .spyOn(runnerModule, "Runner")
      // @ts-expect-error — mock constructor for testing
      .mockImplementation(() => mockRunnerInstance);
    tmpDir = await mkdtemp(join(tmpdir(), "relay-gent-once-"));
    tmpFile = join(tmpDir, "test-file.md");
    await writeFile(tmpFile, "test content", "utf-8");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("shows error and exits with code 1 when target is not found", async () => {
    loadConfigSpy.mockReturnValue(baseConfig({}));
    const { stderr, exitCode } = await runWithArgs([
      "once",
      tmpFile,
      "--target",
      "nonexistent",
    ]);

    expect(stderr).toMatch(/not found/i);
    expect(exitCode).toBe(1);
  });

  it("shows error and exits with code 1 when file does not exist", async () => {
    loadConfigSpy.mockReturnValue(baseConfig(MOCK_TARGETS));
    const { stderr, exitCode } = await runWithArgs([
      "once",
      "/nonexistent-xyzzy-relay-gent-test-file.md",
      "--target",
      "web",
    ]);

    expect(stderr).toMatch(/not found|does not exist/i);
    expect(exitCode).toBe(1);
  });

  it("exits with code 0 when file exists and target is valid", async () => {
    loadConfigSpy.mockReturnValue(baseConfig(MOCK_TARGETS));
    const { exitCode } = await runWithArgs(["once", tmpFile, "--target", "web"]);

    // Success path should exit cleanly
    expect(exitCode).toBe(0);
  });

  it("creates a Runner and starts it in once mode on success", async () => {
    loadConfigSpy.mockReturnValue(baseConfig(MOCK_TARGETS));
    await runWithArgs(["once", tmpFile, "--target", "web"]);

    // Runner constructor should have been called with the correct target config
    expect(runnerSpy).toHaveBeenCalledTimes(1);
    expect(runnerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ adapter: "opencode" }),
      expect.anything(), // parser
      expect.anything(), // adapter
      expect.anything(), // delta
      expect.anything(), // store
    );

    // Runner.start should have been called with once:true
    expect(mockRunnerStart).toHaveBeenCalledTimes(1);
    expect(mockRunnerStart).toHaveBeenCalledWith({ once: true });
  });

  it("does not create a Runner when target is missing", async () => {
    loadConfigSpy.mockReturnValue(baseConfig({}));
    await runWithArgs(["once", tmpFile, "--target", "nonexistent"]);

    expect(runnerSpy).not.toHaveBeenCalled();
  });

  it("does not create a Runner when file is missing", async () => {
    loadConfigSpy.mockReturnValue(baseConfig(MOCK_TARGETS));
    await runWithArgs([
      "once",
      "/nonexistent-xyzzy-file.md",
      "--target",
      "web",
    ]);

    expect(runnerSpy).not.toHaveBeenCalled();
  });

  it("outputs error for unknown parser and does not create Runner", async () => {
    loadConfigSpy.mockReturnValue(
      baseConfig({
        web: {
          adapter: "opencode",
          watchPath: "./src",
          parser: "nonexistent-parser",
        },
      }),
    );
    const { stderr, exitCode } = await runWithArgs([
      "once",
      tmpFile,
      "--target",
      "web",
    ]);

    // Should output parser-not-found error
    expect(stderr).toMatch(/parser|not found/i);
    expect(exitCode).toBe(1);

    // Runner should NOT be created for invalid parser
    expect(runnerSpy).not.toHaveBeenCalled();
  });
});
