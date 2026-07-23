import { existsSync } from "node:fs";
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

/** Display the status table or a "no targets" message, using live process data. */
async function displayStatus(config: { targets: Record<string, TargetConfig> }): Promise<void> {
  const names = Object.keys(config.targets);
  if (names.length === 0) {
    process.stdout.write("No targets configured\n");
    return;
  }

  const pm = new ProcessManager(join(homedir(), ".relay-gent", "targets"));
  const statuses = await pm.status();
  const statusMap = new Map(statuses.map((s) => [s.name, s]));

  const activeTargets = statuses.filter((s) => s.state === "running").length;
  process.stdout.write(`relay-gent — ${activeTargets} active targets\n\n`);

  for (const name of names.sort()) {
    const t = config.targets[name];
    const st = statusMap.get(name);

    if (st && st.state === "running") {
      process.stdout.write(
        `  ${name.padEnd(20)} watching ${t.watchPath} → ${t.adapter.padEnd(18)} (pid ${st.pid}, ${st.delivered} delivered)\n`,
      );
    } else if (st && st.state === "stale") {
      process.stdout.write(
        `  ${name.padEnd(20)} ${t.watchPath.padEnd(20)} → stale (no longer running)\n`,
      );
    } else {
      process.stdout.write(`  ${name.padEnd(20)} ${t.watchPath.padEnd(20)} → stopped\n`);
    }
  }

  process.stdout.write(
    "\n  Use 'relay-gent stop --target <name>' to stop a watcher.\n" +
      "  Use 'relay-gent log --target <name>' to view logs.\n",
  );
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
    .action(async () => {
      try {
        const config = loadConfig();
        await displayStatus(config);
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
    .option("--background", "Run watcher in background (daemonize)")
    .action(async (file: string, options: { target?: string; background?: boolean }) => {
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

        if (options.background) {
          const pm = new ProcessManager(join(homedir(), ".relay-gent", "targets"));
          await pm.start(targetName);
          process.stdout.write(`Watcher started in background for target: ${targetName}\n`);
          exitProgram(0);
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
            const stopped = await pm.stopAll();
            for (const name of stopped) {
              process.stdout.write(`Stopped watcher for target: ${name}\n`);
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
    .action(async (options: { force?: boolean }) => {
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

        const pm = new ProcessManager(join(homedir(), ".relay-gent", "targets"));
        for (const name of names) {
          await pm.cleanTarget(name);
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

        const pm = new ProcessManager(join(homedir(), ".relay-gent", "targets"));

        if (targetName) {
          if (clear) {
            await pm.clearLog(targetName);
            process.stdout.write(`Cleared logs for target: ${targetName}\n`);
          } else {
            const content = await pm.readLog(targetName);
            if (content) {
              process.stdout.write(content);
            } else {
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
          const content = await pm.readAllLogs();
          if (content) {
            process.stdout.write(content);
          } else {
            process.stdout.write("No logs available\n");
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
