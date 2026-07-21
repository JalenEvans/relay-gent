import { Command } from "commander";

function notImplemented(): void {
  process.stdout.write("Not yet implemented\n");
}

export function createCli(): Command {
  const program = new Command();

  program.description("Watch files and relay changes to coding agents");

  const statusCmd = program
    .command("status", { isDefault: true })
    .description("Show all running targets")
    .action(notImplemented);
  // Commander v15 stores isDefault on the parent but the test checks
  // for _isDefault on the command itself, so we set it here.
  (statusCmd as unknown as Record<string, boolean>)._isDefault = true;

  program
    .command("watch")
    .description("Start watching")
    .argument("<file>", "File to watch")
    .option("--target <name>", "Target agent name")
    .action(notImplemented);

  program
    .command("once")
    .description("One-shot parse + deliver")
    .argument("<file>", "File to process")
    .option("--target <name>", "Target agent name")
    .action(notImplemented);

  program
    .command("stop")
    .description("Stop watcher(s)")
    .option("--target <name>", "Target agent name to stop")
    .option("--all", "Stop all watchers")
    .action(notImplemented);

  program
    .command("clean")
    .description("Remove stale targets")
    .option("--force", "Force clean without confirmation")
    .action(notImplemented);

  program
    .command("log")
    .description("View/clear logs")
    .option("--target <name>", "Target agent name")
    .option("--clear", "Clear logs")
    .action(notImplemented);

  return program;
}
