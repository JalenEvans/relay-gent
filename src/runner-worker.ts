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

/** Look up a parser by name, throwing if not found. */
function resolveParser(name: string): Parser {
  return registry.getParser(name);
}

/** Create an adapter for the given adapter name. */
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

// ============================================================
// Public API — exported so the module can be imported for
// testing and executed directly via import.meta.main.
// ============================================================

/**
 * Run the full pipeline for the given target:
 * 1. Validates the target name
 * 2. Loads configuration and resolves the target
 * 3. Ensures the state/log directory exists
 * 4. Resolves the parser and adapter
 * 5. Creates pipeline components (StateStore, DeltaTracker, Runner)
 * 6. Registers a SIGTERM handler for graceful shutdown
 * 7. Starts the runner in foreground mode
 */
export async function run(targetName: string): Promise<void> {
  // 1. Validate target name
  if (!targetName) throw new Error("target name is required");

  // 2. Load config
  const config = loadConfig();
  const target = config.targets[targetName];
  if (!target) throw new Error(`target '${targetName}' not found in configuration`);

  logMessage(targetName, "target configuration loaded");

  // 3. Ensure state/log directory exists (same path StateStore uses)
  const stateDir = join(homedir(), ".relay-gent", "targets", targetName);
  mkdirSync(stateDir, { recursive: true });

  // 4. Resolve parser and adapter
  const parser = resolveParser(target.parser);
  const adapter = resolveAdapter(target.adapter);
  if (!adapter) throw new Error(`adapter '${target.adapter}' not found`);

  // 5. Create pipeline components
  const store = new StateStore(targetName);
  const delta = new DeltaTracker(store);
  const runner = new Runner(target, parser, adapter, delta, store);

  // 6. Register SIGTERM handler for graceful shutdown
  process.on("SIGTERM", async () => {
    logMessage(targetName, "received SIGTERM, shutting down gracefully");
    await runner.stop();
    process.exit(0);
  });

  // 7. Start runner in foreground mode
  logMessage(targetName, "starting watcher");
  try {
    await runner.start({ foreground: true });
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

// ============================================================
// Direct execution guard — only runs when executed as a script
// via `bun run src/runner-worker.ts <targetName>`.
// ============================================================
if (import.meta.main) {
  const targetName = process.argv[2];
  run(targetName).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
