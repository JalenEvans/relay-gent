import { Command, CommanderError } from "commander";
import { startServer } from "./mcp/server.js";

/** Signal the process to exit with the given code. */
function exitProgram(code: number, message?: string): never {
  process.exitCode = code;
  if (message) process.stderr.write(`${message}\n`);
  throw new CommanderError(code, "commander.executeSubCommandAsync", message ?? "");
}

export function createCli(): Command {
  const program = new Command();

  program.description("Relay file changes to coding agents via MCP");

  // --------------------------------------------------
  // mcp (default)
  // --------------------------------------------------
  const mcpCmd = program
    .command("mcp", { isDefault: true })
    .description("Start the MCP server (stdio transport)")
    .action(async () => {
      try {
        await startServer();
      } catch (error) {
        if (error instanceof CommanderError) throw error;
        process.stderr.write(`${String(error)}\n`);
        exitProgram(1);
      }
    });

  // Mark mcp as the default command
  (mcpCmd as unknown as Record<string, boolean>)._isDefault = true;

  return program;
}
