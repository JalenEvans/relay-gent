import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessManager } from "./process";

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
