import { afterAll, describe, expect, it, vi } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessManager } from "../../src/process";

// ============================================================
// Integration: ProcessManager lifecycle
// ============================================================
// Tests the full start / stop / status / log lifecycle of
// ProcessManager using real filesystem operations but mocked
// process spawning (since we can't actually fork in tests).
//
// Bun.spawn is mocked to return fake process objects.
// process.kill is mocked to simulate alive / ESRCH behaviour.
// All temp directories are cleaned up after the suite.
// ============================================================

const tmpDirs: string[] = [];

afterAll(() => {
  vi.restoreAllMocks();
  for (const dir of tmpDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs.length = 0;
});

// ============================================================
// 1. Full lifecycle
// ============================================================

describe("full lifecycle", () => {
  it("start, status, stop, clean", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "relay-gent-lifecycle-"));
    tmpDirs.push(baseDir);

    const spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue({ pid: 12345 } as any);

    const pm = new ProcessManager(baseDir);

    // Start a target
    await pm.start("test-target");

    // Verify PID file was written with the correct PID
    const pidPath = join(baseDir, "test-target", "pid");
    expect(existsSync(pidPath)).toBe(true);
    const pid = parseInt(readFileSync(pidPath, "utf-8"), 10);
    expect(pid).toBe(12345);

    // Status shows running
    const killSpy = vi.spyOn(process, "kill").mockReturnValue(true);
    const statuses = await pm.status();
    const target = statuses.find((s) => s.name === "test-target");
    expect(target).toBeDefined();
    expect(target!.state).toBe("running");
    expect(target!.pid).toBe(12345);

    // Stop the target
    await pm.stop("test-target");

    // Verify target directory was removed
    expect(existsSync(join(baseDir, "test-target"))).toBe(false);

    // Status no longer shows the target
    const statuses2 = await pm.status();
    expect(statuses2.find((s) => s.name === "test-target")).toBeUndefined();

    killSpy.mockRestore();
    spawnSpy.mockRestore();
  });
});

// ============================================================
// 2. Duplicate start protection
// ============================================================

describe("duplicate start protection", () => {
  it("throws on duplicate start", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "relay-gent-dup-"));
    tmpDirs.push(baseDir);

    const spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue({ pid: 12345 } as any);
    const aliveSpy = vi.spyOn(process, "kill").mockImplementation((pid, sig) => {
      // For the first start(), process.kill is not called (no PID file yet).
      // For the second start(), isAlive(12345) calls kill(12345, 0)
      // and we want it to return true so the manager thinks the process is alive.
      if (sig === 0) return true;
      return true;
    });

    const pm = new ProcessManager(baseDir);
    await pm.start("test-target");

    // Second start should throw because the PID file exists and the PID is alive
    await expect(pm.start("test-target")).rejects.toThrow("target already running");

    aliveSpy.mockRestore();
    spawnSpy.mockRestore();
  });
});

// ============================================================
// 3. Stale detection and auto-clean
// ============================================================

describe("stale detection", () => {
  it("detects stale PID and auto-cleans before starting", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "relay-gent-stale-"));
    tmpDirs.push(baseDir);

    // Manually write a PID file with a non-existent PID
    mkdirSync(join(baseDir, "test-target"), { recursive: true });
    writeFileSync(join(baseDir, "test-target", "pid"), "99999", "utf-8");

    // Mock process.kill: signal-0 checks throw ESRCH (process not found).
    // The stale PID (99999, signal 0) must throw ESRCH so isAlive returns false.
    // Non-zero signals should succeed (e.g. SIGTERM during stop, though we don't
    // stop in this test — kept for safety).
    const killSpy = vi.spyOn(process, "kill").mockImplementation((pid, sig) => {
      if (sig === 0) {
        throw Object.assign(new Error("process not found"), { code: "ESRCH" });
      }
      return true;
    });

    const spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue({ pid: 54321 } as any);

    const pm = new ProcessManager(baseDir);

    // Start should detect the stale PID, clean the old target directory,
    // and spawn a fresh process with a new PID.
    await pm.start("test-target");

    // The PID file should now contain the new PID, not the stale one
    const pidContent = readFileSync(join(baseDir, "test-target", "pid"), "utf-8");
    expect(pidContent).toBe("54321");

    killSpy.mockRestore();
    spawnSpy.mockRestore();
  });
});

// ============================================================
// 4. Multi-target stopAll
// ============================================================

describe("stopAll", () => {
  it("stopAll() stops all running targets", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "relay-gent-multi-"));
    tmpDirs.push(baseDir);

    let pidCounter = 1000;
    const spawnSpy = vi.spyOn(Bun, "spawn").mockImplementation(() => {
      return { pid: ++pidCounter } as any;
    });

    // Mock process.kill to succeed for both signal-0 (isAlive during status())
    // and SIGTERM (stop). The killSpy is set up before starting because
    // status() checks isAlive which calls process.kill.
    const killSpy = vi.spyOn(process, "kill").mockReturnValue(true);

    const pm = new ProcessManager(baseDir);
    await pm.start("target-a");
    await pm.start("target-b");

    const stopped = await pm.stopAll();
    expect(stopped).toContain("target-a");
    expect(stopped).toContain("target-b");
    expect(stopped.length).toBe(2);

    // Verify target directories were removed
    expect(existsSync(join(baseDir, "target-a"))).toBe(false);
    expect(existsSync(join(baseDir, "target-b"))).toBe(false);

    killSpy.mockRestore();
    spawnSpy.mockRestore();
  });
});

// ============================================================
// 5. Log lifecycle
// ============================================================

describe("log lifecycle", () => {
  it("write, read, clear", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "relay-gent-log-"));
    tmpDirs.push(baseDir);

    const pm = new ProcessManager(baseDir);

    // Create target directory and write a log file
    mkdirSync(join(baseDir, "test-target"), { recursive: true });
    const logContent = "[TIME] INFO: line 1\n[TIME] INFO: line 2\n";
    writeFileSync(join(baseDir, "test-target", "log"), logContent);

    // Read the log back
    const content = await pm.readLog("test-target");
    expect(content).toContain("line 1");
    expect(content).toContain("line 2");

    // Clear the log
    await pm.clearLog("test-target");

    // After clearing, readLog should return empty string
    const afterClear = await pm.readLog("test-target");
    expect(afterClear).toBe("");
  });
});

// ============================================================
// 6. isAlive checks
// ============================================================

describe("isAlive", () => {
  it("returns true for valid PID", () => {
    vi.spyOn(process, "kill").mockReturnValue(true);
    const pm = new ProcessManager("/tmp");
    expect(pm.isAlive(process.pid)).toBe(true);
    vi.restoreAllMocks();
  });

  // eslint-disable-next-line vitest/max-expects -- deliberately tight single-case test
  it("returns false for invalid PID", () => {
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("process not found"), { code: "ESRCH" });
    });
    const pm = new ProcessManager("/tmp");
    expect(pm.isAlive(99999999)).toBe(false);
    vi.restoreAllMocks();
  });
});
