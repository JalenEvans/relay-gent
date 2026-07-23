import { afterAll, afterEach, beforeEach, describe, expect, it, vi, beforeAll } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fs from "node:fs";
import { ProcessManager } from "./process";
import * as configLoader from "./config/loader";
import * as runnerModule from "./application/runner";

// ============================================================
// ProcessManager — background daemonization and PID management
// ============================================================
// Manages forked background processes, PID file management,
// and stale detection.
//
// API:
//   start(name)          → fork background process, write PID
//   stop(name)           → SIGTERM + cleanup
//   status()             → array of target statuses
//   cleanTarget(name)    → remove stale target dir
//   isAlive(pid)         → process existence check (kill -0)
//   getPidPath(name)     → path to PID file
// ============================================================

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

async function createTmpDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "relay-gent-process-"));
}

function pidPath(baseDir: string, name: string): string {
  return join(baseDir, name, "pid");
}

function targetDir(baseDir: string, name: string): string {
  return join(baseDir, name);
}

function statePath(baseDir: string, name: string): string {
  return join(baseDir, name, "state.json");
}

function logPath(baseDir: string, name: string): string {
  return join(baseDir, name, "log");
}

// ------------------------------------------------------------------
// 1. start() — target directory creation and PID file management
// ------------------------------------------------------------------

describe("ProcessManager — start()", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates target directory and writes PID file", async () => {
    const manager = new ProcessManager(tmpDir);
    const fakePid = 12345;

    vi.spyOn(Bun, "spawn").mockReturnValue({ pid: fakePid } as unknown as Bun.Subprocess);

    await manager.start("test-start");

    // Directory should exist with a PID file containing the numeric PID
    const content = await readFile(pidPath(tmpDir, "test-start"), "utf-8");
    expect(content.trim()).toBe(String(fakePid));
  });

  it("throws when target is already running", async () => {
    const manager = new ProcessManager(tmpDir);
    const existingPid = 5555;

    // Pre-create target directory and PID file
    await mkdir(targetDir(tmpDir, "running-target"), { recursive: true });
    await writeFile(pidPath(tmpDir, "running-target"), String(existingPid));

    // Mock kill to indicate process IS alive (signal 0 returns true)
    vi.spyOn(process, "kill").mockReturnValue(true);

    await expect(manager.start("running-target")).rejects.toThrow("target already running");
  });

  it("with stale PID auto-cleans stale directory and proceeds", async () => {
    const manager = new ProcessManager(tmpDir);
    const stalePid = 9999;
    const newPid = 7777;

    // Pre-create target directory and PID file for a stale process
    await mkdir(targetDir(tmpDir, "stale-target"), { recursive: true });
    await writeFile(pidPath(tmpDir, "stale-target"), String(stalePid));

    // Mock kill to throw ESRCH for the stale PID (process is dead)
    vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (pid === stalePid && signal === 0) {
        const err = new Error("ESRCH: no such process");
        (err as NodeJS.ErrnoException).code = "ESRCH";
        throw err;
      }
      return true;
    });

    // Mock Bun.spawn for the new fork
    vi.spyOn(Bun, "spawn").mockReturnValue({ pid: newPid } as unknown as Bun.Subprocess);

    await manager.start("stale-target");

    // Should have written new PID (old dir was cleaned and recreated)
    const content = await readFile(pidPath(tmpDir, "stale-target"), "utf-8");
    expect(content.trim()).toBe(String(newPid));
  });
});

// ------------------------------------------------------------------
// 2. stop() — SIGTERM signal and cleanup
// ------------------------------------------------------------------

describe("ProcessManager — stop()", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("sends SIGTERM and removes target directory", async () => {
    const manager = new ProcessManager(tmpDir);
    const mockPid = 3333;

    // Pre-create target with PID file
    await mkdir(targetDir(tmpDir, "stop-target"), { recursive: true });
    await writeFile(pidPath(tmpDir, "stop-target"), String(mockPid));

    // Spy on kill to verify SIGTERM was sent
    const killSpy = vi.spyOn(process, "kill").mockReturnValue(true);

    await manager.stop("stop-target");

    expect(killSpy).toHaveBeenCalledWith(mockPid, "SIGTERM");

    // Target directory should be removed
    await expect(readFile(pidPath(tmpDir, "stop-target"))).rejects.toThrow();
  });
});

// ------------------------------------------------------------------
// 3. status() — target state detection
// ------------------------------------------------------------------

describe("ProcessManager — status()", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns running for active targets", async () => {
    const manager = new ProcessManager(tmpDir);
    const mockPid = 4444;
    const deliveredCount = 42;

    // Create target with PID and state files
    await mkdir(targetDir(tmpDir, "active-target"), { recursive: true });
    await writeFile(pidPath(tmpDir, "active-target"), String(mockPid));
    await writeFile(
      statePath(tmpDir, "active-target"),
      JSON.stringify({
        records: {},
        last_run: "2024-01-01T00:00:00.000Z",
        total_delivered: deliveredCount,
      }),
      "utf-8",
    );

    // Mock kill to indicate process IS alive
    vi.spyOn(process, "kill").mockReturnValue(true);

    const result = await manager.status();

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("active-target");
    expect(result[0].pid).toBe(mockPid);
    expect(result[0].state).toBe("running");
    expect(result[0].delivered).toBe(deliveredCount);
  });

  it("returns stale for dead PID", async () => {
    const manager = new ProcessManager(tmpDir);
    const stalePid = 6666;
    const deliveredCount = 7;

    // Create target with PID and state files
    await mkdir(targetDir(tmpDir, "stale-target"), { recursive: true });
    await writeFile(pidPath(tmpDir, "stale-target"), String(stalePid));
    await writeFile(
      statePath(tmpDir, "stale-target"),
      JSON.stringify({
        records: {},
        last_run: "2024-01-01T00:00:00.000Z",
        total_delivered: deliveredCount,
      }),
      "utf-8",
    );

    // Mock kill to throw ESRCH for the stale PID
    vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (pid === stalePid && signal === 0) {
        const err = new Error("ESRCH: no such process");
        (err as NodeJS.ErrnoException).code = "ESRCH";
        throw err;
      }
      return true;
    });

    const result = await manager.status();

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("stale-target");
    expect(result[0].pid).toBe(stalePid);
    expect(result[0].state).toBe("stale");
    expect(result[0].delivered).toBe(deliveredCount);
  });

  it("returns empty array when no targets", async () => {
    const manager = new ProcessManager(tmpDir);

    const result = await manager.status();

    expect(result).toEqual([]);
  });
});

// ------------------------------------------------------------------
// 4. cleanTarget() — stale directory removal
// ------------------------------------------------------------------

describe("ProcessManager — cleanTarget()", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("removes stale target directory", async () => {
    const manager = new ProcessManager(tmpDir);

    // Create target directory with PID file
    await mkdir(targetDir(tmpDir, "stale-dir"), { recursive: true });
    await writeFile(pidPath(tmpDir, "stale-dir"), "12345");

    await manager.cleanTarget("stale-dir");

    // Directory should no longer exist
    await expect(readFile(pidPath(tmpDir, "stale-dir"))).rejects.toThrow();
  });
});

// ------------------------------------------------------------------
// 5. isAlive() — process existence check via kill -0
// ------------------------------------------------------------------

describe("ProcessManager — isAlive()", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns true for a running process", () => {
    const manager = new ProcessManager(tmpDir);

    // process.kill(pid, 0) returns true when process exists
    vi.spyOn(process, "kill").mockReturnValue(true);

    expect(manager.isAlive(12345)).toBe(true);
  });

  it("returns false for a dead process", () => {
    const manager = new ProcessManager(tmpDir);

    // process.kill(pid, 0) throws ESRCH when process does not exist
    vi.spyOn(process, "kill").mockImplementation((_pid, signal) => {
      if (signal === 0) {
        const err = new Error("ESRCH: no such process");
        (err as NodeJS.ErrnoException).code = "ESRCH";
        throw err;
      }
      return true;
    });

    expect(manager.isAlive(99999)).toBe(false);
  });
});

// ------------------------------------------------------------------
// 6. getPidPath() — file path resolution
// ------------------------------------------------------------------

describe("ProcessManager — getPidPath()", () => {
  it("returns correct path for a target", () => {
    const manager = new ProcessManager("/tmp/test-base");

    const path = manager.getPidPath("my-target");

    expect(path).toBe("/tmp/test-base/my-target/pid");
  });
});

// ============================================================
// 7. Runner Worker — forked process entry point (Red phase)
// ============================================================
// Tests for src/runner-worker.ts entry point.
// These will FAIL (Red phase) because the file does not exist yet.
// Once implemented, the worker exports a `run(targetName: string)`
// function and uses `import.meta.main` to guard top-level execution.
// ============================================================
// API:
//   run(targetName)  → starts the full pipeline (config → runner → foreground)
//
// The worker is spawned via Bun.spawn(["bun", "run", "src/runner-worker.ts", name]).
// ============================================================

describe("Runner Worker — run()", () => {
  let loadConfigSpy: ReturnType<typeof vi.spyOn>;
  let runnerSpy: ReturnType<typeof vi.spyOn>;
  let run: (targetName: string) => Promise<void>;

  const mockRunnerStart = vi.fn(async () => {});
  const mockRunnerStop = vi.fn(async () => {});
  const mockRunnerInstance = {
    start: mockRunnerStart,
    stop: mockRunnerStop,
  };

  const MOCK_TARGETS: Record<string, Record<string, unknown>> = {
    web: {
      adapter: "opencode",
      watchPath: "./src",
      parser: "json-lines",
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

  beforeAll(async () => {
    // Dynamic import with cache busting; the file does not exist yet → Red phase
    const mod = await import("./runner-worker?t=" + Date.now());
    run = mod.run;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    loadConfigSpy = vi.spyOn(configLoader, "loadConfig");
    runnerSpy = vi
      .spyOn(runnerModule, "Runner")
      // @ts-expect-error — mock constructor returns a partial mock instance
      .mockImplementation(() => mockRunnerInstance);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  // ----------------------------------------------------------
  // 7a. Missing target name
  // ----------------------------------------------------------

  it("throws when target name is not provided", async () => {
    await expect(run("")).rejects.toThrow(/target name/i);
  });

  // ----------------------------------------------------------
  // 7b. Target not found in configuration
  // ----------------------------------------------------------

  it("throws when target is not found in configuration", async () => {
    loadConfigSpy.mockReturnValue(baseConfig({}));

    await expect(run("nonexistent")).rejects.toThrow(/not found/i);
  });

  // ----------------------------------------------------------
  // 7c. Pipeline component creation and foreground start
  // ----------------------------------------------------------

  it("creates StateStore, DeltaTracker, Runner and starts with foreground:true", async () => {
    loadConfigSpy.mockReturnValue(baseConfig(MOCK_TARGETS));

    await run("web");

    // Runner constructor should be called once with the correct target config
    expect(runnerSpy).toHaveBeenCalledTimes(1);
    expect(runnerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ adapter: "opencode" }),
      expect.anything(), // parser
      expect.anything(), // adapter
      expect.anything(), // delta
      expect.anything(), // store
    );

    // Runner.start must be called with foreground:true (not once mode)
    expect(mockRunnerStart).toHaveBeenCalledTimes(1);
    expect(mockRunnerStart).toHaveBeenCalledWith({ foreground: true });
  });

  // ----------------------------------------------------------
  // 7d. Log file setup
  // ----------------------------------------------------------

  it("creates log directory at ~/.relay-gent/targets/<name> before starting Runner", async () => {
    loadConfigSpy.mockReturnValue(baseConfig(MOCK_TARGETS));
    const mkdirSyncSpy = vi.spyOn(fs, "mkdirSync").mockReturnValue(undefined);

    await run("web");

    // Should create the log directory with recursive flag
    expect(mkdirSyncSpy).toHaveBeenCalledWith(
      expect.stringContaining(join("targets", "web")),
      { recursive: true },
    );

    mkdirSyncSpy.mockRestore();
  });

  // ----------------------------------------------------------
  // 7e. SIGTERM handler registration
  // ----------------------------------------------------------

  it("registers SIGTERM handler during setup", async () => {
    loadConfigSpy.mockReturnValue(baseConfig(MOCK_TARGETS));
    const onSpy = vi.spyOn(process, "on");

    await run("web");

    // Must register a SIGTERM listener for graceful shutdown
    expect(onSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));

    onSpy.mockRestore();
  });

  // ----------------------------------------------------------
  // 7f. Error handling — Runner.start failure
  // ----------------------------------------------------------

  it("logs error and exits with code 1 when Runner.start() fails", async () => {
    loadConfigSpy.mockReturnValue(baseConfig(MOCK_TARGETS));
    const startError = new Error("Worker execution failed");
    mockRunnerStart.mockRejectedValueOnce(startError);

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    await run("web");

    // Must log the error that caused the failure
    expect(consoleErrorSpy).toHaveBeenCalledWith(startError);

    // Must exit with code 1 to signal failure to the parent process
    expect(exitSpy).toHaveBeenCalledWith(1);

    consoleErrorSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

// ============================================================
// 8. Log Management — readLog, clearLog, readAllLogs
// ============================================================
// API:
//   readLog(name, lines?)       → last N lines from target log
//   clearLog(name)              → truncate target log file
//   readAllLogs(linesPerTarget?) → all logs with target headers
//
// Log file is stored at <baseDir>/<name>/log with format:
//   [TIMESTAMP] LEVEL: message
// ============================================================

describe("ProcessManager — Log Management", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ----------------------------------------------------------
  // 8a. readLog() — basic content retrieval
  // ----------------------------------------------------------

  it("readLog() returns log content", async () => {
    const manager = new ProcessManager(tmpDir);

    // Create target directory and write a log file
    await mkdir(targetDir(tmpDir, "test-target"), { recursive: true });
    const lines = [
      "[2024-06-01T10:00:00.000Z] INFO: starting up",
      "[2024-06-01T10:00:01.000Z] INFO: file changed: ./src/index.ts",
      "[2024-06-01T10:00:02.000Z] WARN: parse error on line 42",
      "[2024-06-01T10:00:03.000Z] INFO: delivered 3 records",
    ];
    await writeFile(logPath(tmpDir, "test-target"), lines.join("\n") + "\n", "utf-8");

    const content = await manager.readLog("test-target");

    expect(content).toBe(lines.join("\n") + "\n");
  });

  // ----------------------------------------------------------
  // 8b. readLog() — last N lines
  // ----------------------------------------------------------

  it("readLog() returns last N lines", async () => {
    const manager = new ProcessManager(tmpDir);

    // Create target directory
    await mkdir(targetDir(tmpDir, "test-target"), { recursive: true });

    // Write 100 lines
    const totalLines = 100;
    const lines: string[] = [];
    for (let i = 1; i <= totalLines; i++) {
      lines.push(`[2024-06-01T10:00:00.000Z] INFO: log line ${i}`);
    }
    await writeFile(logPath(tmpDir, "test-target"), lines.join("\n") + "\n", "utf-8");

    const lastLinesCount = 50;
    const content = await manager.readLog("test-target", lastLinesCount);

    // Should only return the last 50 lines
    const resultLines = content.trimEnd().split("\n");
    expect(resultLines).toHaveLength(lastLinesCount);
    expect(resultLines[0]).toContain("log line 51");
    expect(resultLines[resultLines.length - 1]).toContain("log line 100");
  });

  // ----------------------------------------------------------
  // 8c. readLog() — missing log file
  // ----------------------------------------------------------

  it("readLog() returns empty string when log file doesn't exist", async () => {
    const manager = new ProcessManager(tmpDir);

    // Create target directory but no log file
    await mkdir(targetDir(tmpDir, "test-target"), { recursive: true });

    const content = await manager.readLog("test-target");

    expect(content).toBe("");
  });

  // ----------------------------------------------------------
  // 8d. clearLog() — wipes the log file
  // ----------------------------------------------------------

  it("clearLog() wipes the log file", async () => {
    const manager = new ProcessManager(tmpDir);

    // Create target directory with log content
    await mkdir(targetDir(tmpDir, "test-target"), { recursive: true });
    await writeFile(
      logPath(tmpDir, "test-target"),
      "[2024-06-01T10:00:00.000Z] INFO: some log data\n",
      "utf-8",
    );

    await manager.clearLog("test-target");

    // File should still exist but be empty
    const content = await readFile(logPath(tmpDir, "test-target"), "utf-8");
    expect(content).toBe("");
  });

  // ----------------------------------------------------------
  // 8e. clearLog() — missing log file
  // ----------------------------------------------------------

  it("clearLog() is a no-op when no log file exists", async () => {
    const manager = new ProcessManager(tmpDir);

    // Create target directory but no log file
    await mkdir(targetDir(tmpDir, "test-target"), { recursive: true });

    // Should not throw
    await expect(manager.clearLog("test-target")).resolves.toBeUndefined();
  });

  // ----------------------------------------------------------
  // 8f. readAllLogs() — concatenated logs across targets
  // ----------------------------------------------------------

  it("readAllLogs() returns concatenated logs with target headers", async () => {
    const manager = new ProcessManager(tmpDir);

    // Create two targets with log content
    await mkdir(targetDir(tmpDir, "target-a"), { recursive: true });
    await mkdir(targetDir(tmpDir, "target-b"), { recursive: true });

    const logA = [
      "[2024-06-01T10:00:00.000Z] INFO: target-a line 1",
      "[2024-06-01T10:00:01.000Z] INFO: target-a line 2",
    ].join("\n") + "\n";

    const logB = [
      "[2024-06-01T10:00:00.000Z] ERROR: target-b error",
      "[2024-06-01T10:00:01.000Z] INFO: target-b recovery",
    ].join("\n") + "\n";

    await writeFile(logPath(tmpDir, "target-a"), logA, "utf-8");
    await writeFile(logPath(tmpDir, "target-b"), logB, "utf-8");

    const content = await manager.readAllLogs();

    // Should contain headers for each target
    expect(content).toContain("=== target-a ===");
    expect(content).toContain("=== target-b ===");

    // Should contain the log content for each target
    expect(content).toContain("target-a line 1");
    expect(content).toContain("target-a line 2");
    expect(content).toContain("target-b error");
    expect(content).toContain("target-b recovery");
  });
});
