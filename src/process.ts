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
