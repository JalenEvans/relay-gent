import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface TargetStatus {
  name: string;
  pid: number | null;
  state: "running" | "stopped" | "stale";
  delivered: number;
}

export class ProcessManager {
  constructor(private readonly baseDir: string) {}

  async start(name: string): Promise<void> {
    const dir = join(this.baseDir, name);
    const pidPath = this.getPidPath(name);

    // 1. Create target directory if missing
    await mkdir(dir, { recursive: true });

    // 2. Check if PID file exists
    if (existsSync(pidPath)) {
      // 3. Parse PID from file
      const pid = Number.parseInt(await readFile(pidPath, "utf-8"), 10);
      if (this.isAlive(pid)) {
        throw new Error("target already running");
      }
      // Stale — clean up and re-create directory
      await this.cleanTarget(name);
      await mkdir(dir, { recursive: true });
    }

    // 4. Fork to background
    const proc = Bun.spawn(["bun", "run", "src/runner-worker.ts", name], {
      detached: true,
    });

    // 5. Write PID to file
    await writeFile(pidPath, String(proc.pid));
  }

  async stop(name: string): Promise<void> {
    const pidPath = this.getPidPath(name);
    const pid = Number.parseInt(await readFile(pidPath, "utf-8"), 10);

    // Send SIGTERM
    process.kill(pid, "SIGTERM");

    // Wait briefly for graceful shutdown
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Remove target directory
    await rm(join(this.baseDir, name), { recursive: true, force: true });
  }

  async status(): Promise<TargetStatus[]> {
    const results: TargetStatus[] = [];

    let entries: string[];
    try {
      entries = await readdir(this.baseDir);
    } catch {
      return [];
    }

    for (const name of entries) {
      const pidPath = this.getPidPath(name);
      const statePath = join(this.baseDir, name, "state.json");

      let pid: number | null = null;
      let state: "running" | "stopped" | "stale" = "stopped";
      let delivered = 0;

      if (existsSync(pidPath)) {
        pid = Number.parseInt(await readFile(pidPath, "utf-8"), 10);
        state = this.isAlive(pid) ? "running" : "stale";
      }

      // Read delivered count from state.json (default 0)
      try {
        const stateContent = await readFile(statePath, "utf-8");
        const stateData = JSON.parse(stateContent);
        delivered = stateData.total_delivered ?? 0;
      } catch {
        // state.json doesn't exist or is invalid — default to 0
      }

      results.push({ name, pid, state, delivered });
    }

    return results;
  }

  async cleanTarget(name: string): Promise<void> {
    await rm(join(this.baseDir, name), { recursive: true, force: true });
  }

  /**
   * Read the last N lines from the target's log file.
   * Defaults to 50 lines. Returns empty string if no log file.
   */
  async readLog(name: string, lines = 50): Promise<string> {
    const logPath = join(this.baseDir, name, "log");
    try {
      const content = await readFile(logPath, "utf-8");
      const allLines = content.split("\n");
      // Remove trailing empty line from split
      if (allLines.length > 0 && allLines[allLines.length - 1] === "") {
        allLines.pop();
      }
      const lastLines = allLines.slice(Math.max(0, allLines.length - lines));
      return lastLines.join("\n") + (lastLines.length > 0 ? "\n" : "");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return "";
      }
      throw err;
    }
  }

  /**
   * Clear the target's log file.
   * No-op if the log file doesn't exist.
   */
  async clearLog(name: string): Promise<void> {
    const logPath = join(this.baseDir, name, "log");
    await writeFile(logPath, "", "utf-8");
  }

  /**
   * Read logs from all targets, concatenated with headers.
   * Each section: "=== targetName ===\n" + logContent + "\n"
   */
  async readAllLogs(linesPerTarget = 50): Promise<string> {
    let entries: string[];
    try {
      entries = await readdir(this.baseDir);
    } catch {
      return "";
    }

    const sections: string[] = [];
    for (const name of entries.sort()) {
      const logContent = await this.readLog(name, linesPerTarget);
      if (logContent) {
        sections.push(`=== ${name} ===\n${logContent}`);
      }
    }
    return sections.join("\n");
  }

  isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ESRCH") {
        return false;
      }
      throw err;
    }
  }

  getPidPath(name: string): string {
    return join(this.baseDir, name, "pid");
  }
}
