#!/usr/bin/env bun
import { CommanderError } from "commander";
import { createCli } from "../src/cli";

const cli = createCli();
cli.parseAsync().catch((err: unknown) => {
  if (err instanceof CommanderError) {
    process.exit(process.exitCode ?? 1);
  }
  process.exit(1);
});
