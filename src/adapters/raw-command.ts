import type { Adapter, DeliveredId } from "../domain/adapter/adapter.interface";
import { formatRecords } from "../domain/adapter/formatter";
import type { TargetConfig } from "../domain/config/config.schema";
import { computeIdentity } from "../domain/record/record-identity";
import type { Record } from "../domain/record/record.schema";

// ============================================================
// RawCommandAdapter — delivers Records to a shell command via stdin
// ============================================================

export class RawCommandAdapter implements Adapter {
  name = "raw-command";

  async deliver(batch: Record[], ctx: TargetConfig): Promise<DeliveredId[]> {
    // Empty batch → return [], no spawn
    if (batch.length === 0) return [];

    // Format records
    const formatted = formatRecords(batch);

    // Spawn sh -c <command> with stdin pipe
    const proc = Bun.spawn(["sh", "-c", (ctx as { command: string }).command], {
      stdin: "pipe",
      stdout: "ignore",
      stderr: "ignore",
    });

    // Write formatted text to stdin
    proc.stdin.write(formatted);
    proc.stdin.end();

    // Wait for exit
    const exitCode = await proc.exited;

    // Non-zero exit → throw error
    if (exitCode !== 0) {
      throw new Error(`Command exited with code ${exitCode}`);
    }

    // Return delivered IDs
    return batch.map((r) => computeIdentity(r));
  }

  async ready(ctx: TargetConfig): Promise<boolean> {
    try {
      const command = (ctx as { command: string }).command;
      const cmdName = command.split(/\s+/)[0];
      const proc = Bun.spawn(["sh", "-c", `command -v ${cmdName} > /dev/null 2>&1`], {
        stdin: "ignore",
      });
      const exitCode = await proc.exited;
      return exitCode === 0;
    } catch {
      return false;
    }
  }
}
