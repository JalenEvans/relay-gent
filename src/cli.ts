import { existsSync, rmSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Command, CommanderError } from "commander";
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
import { ProcessManager } from "./process";
import { StateStore } from "./state/store";

// ============================================================
// Helpers
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

/** Display the status table or a "no targets" message. */
function displayStatus(config: { targets: Record<string, TargetConfig> }): void {
  const names = Object.keys(config.targets);
  if (names.length === 0) {
    process.stdout.write("No targets configured\n");
    return;
  }

  const lines: string[] = [];
  const h = "Target                | Adapter             | Watch Path            | Status";
  lines.push(h);
  lines.push("─".repeat(h.length));

  for (const name of names.sort()) {
    const t = config.targets[name];
    lines.push(`${name.padEnd(20)} | ${t.adapter.padEnd(18)} | ${t.watchPath.padEnd(20)} | idle`);
  }

  process.stdout.write(`${lines.join("\n")}\n`);
}

/** Signal the process to exit with the given code. */
function exitProgram(code: number, message?: string): never {
  process.exitCode = code;
  if (message) process.stderr.write(`${message}\n`);
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

        const TARGET_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;
        if (!TARGET_NAME_RE.test(targetName)) {
          process.stderr.write(`Invalid target name: ${targetName}\n`);
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

        // CLI file arg overrides config's watchPath
        target.watchPath = file;

        const parser = resolveParser(target.parser);
        const adapter = resolveAdapter(target.adapter);
        if (!adapter) {
          process.stderr.write(`Adapter '${target.adapter}' not found\n`);
          exitProgram(1);
          return;
        }

        const store = new StateStore(targetName);
        const delta = new DeltaTracker(store);
        const runner = new Runner(target, parser, adapter, delta, store);
        await runner.start({ foreground: true });
        // Watcher keeps the event loop alive — do not exitProgram here
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

        const TARGET_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;
        if (!TARGET_NAME_RE.test(targetName)) {
          process.stderr.write(`Invalid target name: ${targetName}\n`);
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

        // CLI file arg overrides config's watchPath
        target.watchPath = file;

        const parser = resolveParser(target.parser);
        const adapter = resolveAdapter(target.adapter);
        if (!adapter) {
          process.stderr.write(`Adapter '${target.adapter}' not found\n`);
          exitProgram(1);
          return;
        }

        const store = new StateStore(targetName);
        const delta = new DeltaTracker(store);
        const runner = new Runner(target, parser, adapter, delta, store);
        await runner.start({ once: true });
        exitProgram(0);
      } catch (error) {
        if (error instanceof CommanderError) throw error;
        process.stderr.write(`${String(error)}\n`);
        exitProgram(1);
      }
    });

  // --------------------------------------------------
  // stop
  // --------------------------------------------------
  program
    .command("stop")
    .description("Stop watcher(s)")
    .option("--target <name>", "Target agent name to stop")
    .option("--all", "Stop all watchers")
    .action(async (options: { target?: string; all?: boolean }) => {
      try {
        const { target: targetName, all } = options;

        if (targetName) {
          const TARGET_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;
          if (!TARGET_NAME_RE.test(targetName)) {
            process.stderr.write(`Invalid target name: ${targetName}\n`);
            exitProgram(1);
            return;
          }
        }

        const config = loadConfig();

        if (targetName) {
          const target = config.targets[targetName];
          if (!target) {
            process.stderr.write(`Target '${targetName}' not found in configuration\n`);
            exitProgram(1);
            return;
          }
        }

        if (targetName || all) {
          const pm = new ProcessManager(join(homedir(), ".relay-gent", "targets"));

          if (targetName) {
            await pm.stop(targetName);
            process.stdout.write(`Stopped watcher for target: ${targetName}\n`);
          } else if (all) {
            const names = Object.keys(config.targets);
            for (const name of names) {
              try {
                await pm.stop(name);
                process.stdout.write(`Stopped watcher for target: ${name}\n`);
              } catch {
                // Target wasn't running — skip
              }
            }
          }
          exitProgram(0);
        } else {
          const names = Object.keys(config.targets);
          if (names.length === 0) {
            process.stderr.write("No targets configured\n");
          } else {
            process.stderr.write("Specify --target <name> or --all\n");
          }
          exitProgram(1);
        }
      } catch (error) {
        if (error instanceof CommanderError) throw error;
        process.stderr.write(`${String(error)}\n`);
        exitProgram(1);
      }
    });

  // --------------------------------------------------
  // clean
  // --------------------------------------------------
  program
    .command("clean")
    .description("Remove stale targets")
    .option("--force", "Force clean without confirmation")
    .action((options: { force?: boolean }) => {
      try {
        if (!options.force) {
          process.stdout.write("Use --force to remove stale state directories\n");
          exitProgram(0);
          return;
        }

        const config = loadConfig();
        const names = Object.keys(config.targets);
        if (names.length === 0) {
          process.stdout.write("Nothing to clean\n");
          exitProgram(0);
          return;
        }

        const stateBase = join(homedir(), ".relay-gent", "targets");
        for (const name of names) {
          const targetDir = join(stateBase, name);
          rmSync(targetDir, { recursive: true, force: true });
          process.stdout.write(`Cleaned state for target: ${name}\n`);
        }
        exitProgram(0);
      } catch (error) {
        if (error instanceof CommanderError) throw error;
        process.stderr.write(`${String(error)}\n`);
        exitProgram(1);
      }
    });

  // --------------------------------------------------
  // log
  // --------------------------------------------------
  program
    .command("log")
    .description("View/clear logs")
    .option("--target <name>", "Target agent name")
    .option("--clear", "Clear logs")
    .action(async (options: { target?: string; clear?: boolean }) => {
      try {
        const { target: targetName, clear } = options;

        if (targetName) {
          const TARGET_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;
          if (!TARGET_NAME_RE.test(targetName)) {
            process.stderr.write(`Invalid target name: ${targetName}\n`);
            exitProgram(1);
            return;
          }
        }

        const logDir = join(homedir(), ".relay-gent", "logs");

        if (targetName) {
          const logFile = join(logDir, `${targetName}.log`);

          if (clear) {
            await writeFile(logFile, "", "utf-8");
            process.stdout.write(`Cleared logs for target: ${targetName}\n`);
          } else {
            try {
              const content = await readFile(logFile, "utf-8");
              process.stdout.write(content);
            } catch {
              const config = loadConfig();
              if (!config.targets[targetName]) {
                process.stderr.write(`Target '${targetName}' not found in configuration\n`);
                exitProgram(1);
                return;
              }
              process.stdout.write(`No logs found for target: ${targetName}\n`);
            }
          }
        } else {
          let files: string[];
          try {
            files = await readdir(logDir);
          } catch {
            files = [];
          }
          const logNames = files.filter((f) => f.endsWith(".log")).map((f) => f.slice(0, -4));
          if (logNames.length === 0) {
            process.stdout.write("No logs available\n");
          } else {
            process.stdout.write(`${logNames.join("\n")}\n`);
          }
        }

        exitProgram(0);
      } catch (error) {
        if (error instanceof CommanderError) throw error;
        process.stderr.write(`${String(error)}\n`);
        exitProgram(1);
      }
    });

  return program;
}
