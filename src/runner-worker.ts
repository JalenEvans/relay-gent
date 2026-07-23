import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { RawCommandAdapter } from "./adapters";
import { Runner } from "./application/runner";
import { loadConfig } from "./config/loader";
import { DeltaTracker } from "./core/delta";
import type { Adapter, DeliveredId } from "./domain/adapter/adapter.interface";
import type { TargetConfig } from "./domain/config/config.schema";
import type { Parser } from "./domain/parser/parser.interface";
import { computeIdentity } from "./domain/record/record-identity";
import type { Record as RelayRecord } from "./domain/record/record.schema";
import { registry } from "./parsers";
import { StateStore } from "./state/store";

// ============================================================
// Helpers — inlined to avoid circular imports from cli.ts
// ============================================================

function resolveParser(name: string): Parser {
  return registry.getParser(name);
}

function resolveAdapter(name: string): Adapter | undefined {
  switch (name) {
    case "raw-command":
      return new RawCommandAdapter();
    case "opencode":
    case "codex":
    case "claude":
      return {
        name,
        async deliver(batch: RelayRecord[], _ctx: TargetConfig): Promise<DeliveredId[]> {
          return batch.map((r) => computeIdentity(r));
        },
      };
    default:
      return undefined;
  }
}

// ============================================================
// Logging — write log entries to the target's log file.
// Uses sync I/O to ensure messages are written even during
// shutdown.
// ============================================================

function logMessage(
  name: string,
  message: string,
  level: "INFO" | "WARN" | "ERROR" = "INFO",
): void {
  const timestamp = new Date().toISOString();
  const logPath = join(homedir(), ".relay-gent", "targets", name, "log");
  try {
    appendFileSync(logPath, `[${timestamp}] ${level}: ${message}\n`);
  } catch {
    // Silently ignore logging failures
  }
}

export async function run(targetName: string): Promise<void> {
  if (!targetName) throw new Error("target name is required");

  const config = loadConfig();
  const target = config.targets[targetName];
  if (!target) throw new Error(`target '${targetName}' not found in configuration`);

  logMessage(targetName, "target configuration loaded");

  const stateDir = join(homedir(), ".relay-gent", "targets", targetName);
  mkdirSync(stateDir, { recursive: true });

  const parser = resolveParser(target.parser);
  const adapter = resolveAdapter(target.adapter);
  if (!adapter) throw new Error(`adapter '${target.adapter}' not found`);

  const store = new StateStore(targetName);
  const delta = new DeltaTracker(store);
  const runner = new Runner(target, parser, adapter, delta, store);

  process.on("SIGTERM", async () => {
    logMessage(targetName, "received SIGTERM, shutting down gracefully");

    // Force exit if graceful shutdown takes too long
    const forceExit = setTimeout(() => {
      process.exit(1);
    }, 5000);

    try {
      await runner.stop();
      clearTimeout(forceExit);
      logMessage(targetName, "shutdown complete");
      process.exit(0);
    } catch (err) {
      clearTimeout(forceExit);
      logMessage(targetName, `shutdown error: ${err}`, "ERROR");
      process.exit(1);
    }
  });

  logMessage(targetName, "starting watcher");
  try {
    await runner.start({ foreground: true });
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

if (import.meta.main) {
  const targetName = process.argv[2];
  run(targetName).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
