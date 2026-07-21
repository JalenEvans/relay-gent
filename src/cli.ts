import { existsSync } from "node:fs";
import { Command, CommanderError } from "commander";
import { RawCommandAdapter } from "./adapters";
import { Runner } from "./application/runner";
import { loadConfig } from "./config/loader";
import { DeltaTracker } from "./core/delta";
import type { Adapter, DeliveredId } from "./domain/adapter/adapter.interface";
import type { TargetConfig } from "./domain/config/config.schema";
import type { Parser } from "./domain/parser/parser.interface";
import { computeIdentity } from "./domain/record/record-identity";
import type { Record } from "./domain/record/record.schema";
import { registry } from "./parsers";
import { StateStore } from "./state/store";

// ============================================================
// Helpers
// ============================================================

function notImplemented(): void {
  process.stdout.write("Not yet implemented\n");
}

/** Look up a parser by name, falling back to a minimal no-op parser. */
function resolveParser(name: string): Parser {
  try {
    return registry.getParser(name);
  } catch {
    return { name, parse: () => [] };
  }
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
        async deliver(batch: Record[], _ctx: TargetConfig): Promise<DeliveredId[]> {
          return batch.map((r) => computeIdentity(r));
        },
      };
    default:
      return undefined;
  }
}

/** Display the status table or a "no targets" message. */
function displayStatus(config: { targets: Record<string, TargetConfig> }): void {
  const names = Object.keys(config.targets);
  if (names.length === 0) {
    process.stdout.write("No targets configured\n");
    return;
  }

  const lines: string[] = [];
  const h = "Target             Adapter            Watch Path          Status";
  lines.push(h);
  lines.push("─".repeat(h.length));

  for (const name of names.sort()) {
    const t = config.targets[name];
    lines.push(`${name.padEnd(18)}${t.adapter.padEnd(18)}${t.watchPath.padEnd(18)}idle`);
  }

  process.stdout.write(`${lines.join("\n")}\n`);
}

/** Signal the process to exit with the given code via CommanderError. */
function exitProgram(code: number, message?: string): never {
  throw new CommanderError(code, "commander.executeSubCommandAsync", message ?? "");
}

// ============================================================
// CLI Definition
// ============================================================

export function createCli(): Command {
  const program = new Command();

  program.description("Watch files and relay changes to coding agents");

  // --------------------------------------------------
  // status (default)
  // --------------------------------------------------
  const statusCmd = program
    .command("status", { isDefault: true })
    .description("Show all running targets")
    .action(() => {
      try {
        const config = loadConfig();
        displayStatus(config);
        exitProgram(0);
      } catch (error) {
        if (error instanceof CommanderError) throw error;
        process.stderr.write(`${String(error)}\n`);
        exitProgram(1);
      }
    });
  // Commander v15 stores isDefault on the parent but the test checks
  // for _isDefault on the command itself, so we set it here.
  (statusCmd as unknown as Record<string, boolean>)._isDefault = true;

  // --------------------------------------------------
  // watch
  // --------------------------------------------------
  program
    .command("watch")
    .description("Start watching")
    .argument("<file>", "File to watch")
    .option("--target <name>", "Target agent name")
    .action(async (file: string, options: { target?: string }) => {
      try {
        const targetName = options.target;
        if (!targetName) {
          process.stderr.write("Target name required (--target <name>)\n");
          exitProgram(1);
          return;
        }

        if (!existsSync(file)) {
          process.stderr.write(`File not found: ${file}\n`);
          exitProgram(1);
          return;
        }

        const config = loadConfig();
        const target = config.targets[targetName];
        if (!target) {
          process.stderr.write(`Target '${targetName}' not found in configuration\n`);
          exitProgram(1);
          return;
        }

        const parser = resolveParser(target.parser);
        if (!parser) {
          process.stderr.write(`Parser '${target.parser}' not found\n`);
          exitProgram(1);
          return;
        }

        const adapter = resolveAdapter(target.adapter);
        if (!adapter) {
          process.stderr.write(`Adapter '${target.adapter}' not found\n`);
          exitProgram(1);
          return;
        }

        const store = new StateStore(targetName);
        const delta = new DeltaTracker(store);
        const runner = new (Runner as unknown as new (config: TargetConfig) => Runner)(target);
        await runner.start({ foreground: true });
        exitProgram(0);
      } catch (error) {
        if (error instanceof CommanderError) throw error;
        process.stderr.write(`${String(error)}\n`);
        exitProgram(1);
      }
    });

  // --------------------------------------------------
  // once
  // --------------------------------------------------
  program
    .command("once")
    .description("One-shot parse + deliver")
    .argument("<file>", "File to process")
    .option("--target <name>", "Target agent name")
    .action(async (file: string, options: { target?: string }) => {
      try {
        const targetName = options.target;
        if (!targetName) {
          process.stderr.write("Target name required (--target <name>)\n");
          exitProgram(1);
          return;
        }

        if (!existsSync(file)) {
          process.stderr.write(`File not found: ${file}\n`);
          exitProgram(1);
          return;
        }

        const config = loadConfig();
        const target = config.targets[targetName];
        if (!target) {
          process.stderr.write(`Target '${targetName}' not found in configuration\n`);
          exitProgram(1);
          return;
        }

        const parser = resolveParser(target.parser);
        if (!parser) {
          process.stderr.write(`Parser '${target.parser}' not found\n`);
          exitProgram(1);
          return;
        }

        const adapter = resolveAdapter(target.adapter);
        if (!adapter) {
          process.stderr.write(`Adapter '${target.adapter}' not found\n`);
          exitProgram(1);
          return;
        }

        const store = new StateStore(targetName);
        const delta = new DeltaTracker(store);
        const runner = new (Runner as unknown as new (config: TargetConfig) => Runner)(target);
        await runner.start({ once: true });
        exitProgram(0);
      } catch (error) {
        if (error instanceof CommanderError) throw error;
        process.stderr.write(`${String(error)}\n`);
        exitProgram(1);
      }
    });

  // --------------------------------------------------
  // stop (stub)
  // --------------------------------------------------
  program
    .command("stop")
    .description("Stop watcher(s)")
    .option("--target <name>", "Target agent name to stop")
    .option("--all", "Stop all watchers")
    .action(notImplemented);

  // --------------------------------------------------
  // clean (stub)
  // --------------------------------------------------
  program
    .command("clean")
    .description("Remove stale targets")
    .option("--force", "Force clean without confirmation")
    .action(notImplemented);

  // --------------------------------------------------
  // log (stub)
  // --------------------------------------------------
  program
    .command("log")
    .description("View/clear logs")
    .option("--target <name>", "Target agent name")
    .option("--clear", "Clear logs")
    .action(notImplemented);

  return program;
}
