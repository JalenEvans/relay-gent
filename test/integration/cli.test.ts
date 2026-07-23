import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Absolute path to the Bun binary — used when spawning the CLI
// as a subprocess since "bun" may not be in the subprocess PATH.
// Resolves relative to the project root (where Bun runs tests from).
const BUN_BIN = `${process.env.HOME}/.bun/bin/bun`;

// ============================================================
// Integration: relay-gent CLI — full process-level tests
// ============================================================
// Spawns the actual CLI as a subprocess using Bun.spawnSync.
// Config, state, and logs are isolated in a temp HOME directory
// to avoid polluting real user data.
//
// NOTE: The CLI has a pre-existing issue where `exitProgram()`
// uses CommanderError with code "commander.executeSubCommandAsync"
// instead of "commander.exit". This causes ALL commands (except
// --help, which Commander handles natively) to exit with code 1
// regardless of the intended exit code. Tests verify stdout/stderr
// CONTENT which is correct, and document exit code behavior
// accurately.
// ============================================================

// ------------------------------------------------------------------
// Test Fixtures
// ------------------------------------------------------------------

/**
 * Valid TOML config for a single `web` target using the opencode adapter
 * with a specific watch file.
 */
const VALID_CONFIG_TOML = [
  "[targets.web]",
  `adapter = "opencode"`,
  `watchPath = "/tmp/relay-test.log"`,
  `parser = "json-lines"`,
  `server_url = "http://localhost:4096"`,
].join("\n");

/**
 * Valid TOML config with TWO targets: web and api.
 */
const MULTI_TARGET_CONFIG_TOML = [
  "[targets.web]",
  `adapter = "opencode"`,
  `watchPath = "/tmp/web.log"`,
  `parser = "json-lines"`,
  `server_url = "http://localhost:4096"`,
  "",
  "[targets.api]",
  `adapter = "raw-command"`,
  `watchPath = "/tmp/api.log"`,
  `parser = "json-lines"`,
  `command = "cat"`,
  "shell = true",
].join("\n");

/**
 * Valid TOML config with a single target using raw-command adapter.
 */
const RAW_CMD_CONFIG_TOML = [
  "[targets.collector]",
  `adapter = "raw-command"`,
  `watchPath = "/tmp/collect.log"`,
  `parser = "json-lines"`,
  `command = "cat > /dev/null"`,
  "shell = true",
].join("\n");

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

let tmpHome: string;
let configDir: string;
let configPath: string;

beforeAll(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "relay-gent-int-"));
  configDir = join(tmpHome, ".relay-gent");
  configPath = join(configDir, "config.toml");
  mkdirSync(configDir, { recursive: true });
});

afterAll(() => {
  rmSync(tmpHome, { recursive: true, force: true });
});

/**
 * Remove any existing config file before each test that writes
 * its own.
 */
function removeConfig(): void {
  if (existsSync(configPath)) {
    rmSync(configPath);
  }
}

/**
 * Write a TOML config file at the default config path.
 */
function writeConfig(toml: string): void {
  writeFileSync(configPath, toml, "utf-8");
}

/**
 * Run the relay-gent CLI as a subprocess and return the result.
 *
 * @param args - CLI arguments (e.g. ["status", "--help"])
 * @param env - optional extra environment variables
 */
function runCli(
  args: string[],
  env?: Record<string, string>,
): { stdout: string; stderr: string; exitCode: number } {
  const result = Bun.spawnSync([BUN_BIN, "run", "bin/relay-gent.ts", ...args], {
    env: {
      ...process.env,
      HOME: tmpHome,
      ...env,
    },
  });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode,
  };
}

// ============================================================
// 1. Help Output
// ============================================================

describe("help output", () => {
  it("--help displays program description", () => {
    const { stdout, exitCode } = runCli(["--help"]);
    expect(stdout).toContain("Watch files and relay changes to coding agents");
    expect(exitCode).toBe(0);
  });

  it("--help lists all 6 commands", () => {
    const { stdout } = runCli(["--help"]);
    expect(stdout).toContain("status");
    expect(stdout).toContain("watch");
    expect(stdout).toContain("once");
    expect(stdout).toContain("stop");
    expect(stdout).toContain("clean");
    expect(stdout).toContain("log");
  });

  it("--help shows --help option", () => {
    const { stdout } = runCli(["--help"]);
    expect(stdout).toContain("--help");
  });

  it("no arguments defaults to status command", () => {
    // When no command is given, Commander routes to the default
    // `status` command. The status output should appear on stdout.
    const { stdout } = runCli([]);
    expect(stdout.length).toBeGreaterThan(0);
  });
});

// ============================================================
// 2. Status Command
// ============================================================

describe("status command", () => {
  beforeEach(() => {
    removeConfig();
  });

  it("shows target info when valid config exists", () => {
    writeConfig(VALID_CONFIG_TOML);
    const { stdout } = runCli(["status"]);
    expect(stdout).toContain("web");
    expect(stdout).toContain("relay-test.log");
    expect(stdout).toContain("stopped");
  });

  it("shows multi-target table when config has multiple targets", () => {
    writeConfig(MULTI_TARGET_CONFIG_TOML);
    const { stdout } = runCli(["status"]);
    expect(stdout).toContain("web");
    expect(stdout).toContain("api");
  });

  it('shows "No targets configured" when config has no targets', () => {
    writeConfig("");
    const { stdout } = runCli(["status"]);
    expect(stdout).toContain("No targets configured");
  });

  it('shows "No targets configured" when no config file exists', () => {
    removeConfig();
    const { stdout } = runCli(["status"]);
    expect(stdout).toContain("No targets configured");
  });
});

// ============================================================
// 3. Watch Command — validation only (watch loop blocks)
// ============================================================

describe("watch command validation", () => {
  beforeEach(() => {
    removeConfig();
  });

  it("shows error when --target flag is missing", () => {
    const { stderr, exitCode } = runCli(["watch", "/tmp/file.log"]);
    expect(stderr).toContain("Target name required");
    expect(exitCode).toBe(1);
  });

  it("shows error for non-existent file", () => {
    writeConfig(VALID_CONFIG_TOML);
    const { stderr, exitCode } = runCli([
      "watch",
      "/tmp/nonexistent-xyzzy-file.log",
      "--target",
      "web",
    ]);
    expect(stderr).toContain("File not found");
    expect(exitCode).toBe(1);
  });

  it("shows error for non-existent target", () => {
    writeConfig(VALID_CONFIG_TOML);
    // File must exist because the file existence check happens
    // before the target lookup in the CLI action handler.
    mkdirSync("/tmp", { recursive: true });
    writeFileSync("/tmp/relay-test.log", "", "utf-8");
    const { stderr, exitCode } = runCli([
      "watch",
      "/tmp/relay-test.log",
      "--target",
      "nonexistent",
    ]);
    expect(stderr).toContain("not found in configuration");
    expect(exitCode).toBe(1);
  });
});

// ============================================================
// 4. Once Command
// ============================================================

describe("once command", () => {
  beforeEach(() => {
    removeConfig();
  });

  it("shows error when --target flag is missing", () => {
    const { stderr, exitCode } = runCli(["once", "/tmp/file.log"]);
    expect(stderr).toContain("Target name required");
    expect(exitCode).toBe(1);
  });

  it("shows error for non-existent file", () => {
    writeConfig(VALID_CONFIG_TOML);
    const { stderr, exitCode } = runCli([
      "once",
      "/tmp/nonexistent-xyzzy-file.log",
      "--target",
      "web",
    ]);
    expect(stderr).toContain("File not found");
    expect(exitCode).toBe(1);
  });

  it("shows error for non-existent target", () => {
    writeConfig(VALID_CONFIG_TOML);
    // File must exist because the file existence check happens
    // before the target lookup in the CLI action handler.
    mkdirSync("/tmp", { recursive: true });
    writeFileSync("/tmp/relay-test.log", "", "utf-8");
    const { stderr, exitCode } = runCli(["once", "/tmp/relay-test.log", "--target", "nonexistent"]);
    expect(stderr).toContain("not found in configuration");
    expect(exitCode).toBe(1);
  });
});

// ============================================================
// 5. Stop Command
// ============================================================

describe("stop command", () => {
  beforeEach(() => {
    removeConfig();
  });

  it("shows error for non-existent target", () => {
    writeConfig(VALID_CONFIG_TOML);
    const { stderr, exitCode } = runCli(["stop", "--target", "nonexistent"]);
    expect(stderr).toContain("not found in configuration");
    expect(exitCode).toBe(1);
  });

  it("shows error with hint when no --target or --all given", () => {
    writeConfig(VALID_CONFIG_TOML);
    const { stderr, exitCode } = runCli(["stop"]);
    expect(stderr).toContain("Specify --target <name> or --all");
    expect(exitCode).toBe(1);
  });

  it("--all exits successfully when no targets configured", () => {
    removeConfig();
    const { stdout, exitCode } = runCli(["stop", "--all"]);
    // Should no longer show the "not yet implemented" stub message
    expect(stdout).not.toContain("not yet implemented");
    expect(exitCode).toBe(0);
  });
});

// ============================================================
// 6. Clean Command
// ============================================================

describe("clean command", () => {
  beforeEach(() => {
    removeConfig();
  });

  it('shows "Use --force" hint without --force flag', () => {
    writeConfig(VALID_CONFIG_TOML);
    const { stdout } = runCli(["clean"]);
    expect(stdout).toContain("Use --force");
  });

  it("with --force removes state directories and confirms cleaning", () => {
    writeConfig(VALID_CONFIG_TOML);
    // Create state directory to simulate existing state
    const stateDir = join(tmpHome, ".relay-gent", "targets", "web");
    mkdirSync(stateDir, { recursive: true });
    expect(existsSync(stateDir)).toBe(true);

    const { stdout } = runCli(["clean", "--force"]);
    expect(stdout).toContain("Cleaned state for target: web");

    // State directory should be removed
    expect(existsSync(stateDir)).toBe(false);
  });

  it('shows "Nothing to clean" when no targets configured', () => {
    removeConfig();
    const { stdout, exitCode } = runCli(["clean", "--force"]);
    expect(stdout).toContain("Nothing to clean");
    expect(exitCode).toBe(0);
  });
});

// ============================================================
// 7. Log Command
// ============================================================

describe("log command", () => {
  beforeEach(() => {
    removeConfig();
  });

  it('shows "No logs available" without --target', () => {
    const { stdout } = runCli(["log"]);
    expect(stdout).toContain("No logs available");
  });

  it('shows "No logs found" for valid target with no log file', () => {
    writeConfig(VALID_CONFIG_TOML);
    const { stdout } = runCli(["log", "--target", "web"]);
    expect(stdout).toContain("No logs found for target: web");
  });

  it("shows error for non-existent target", () => {
    writeConfig(VALID_CONFIG_TOML);
    const { stderr, exitCode } = runCli(["log", "--target", "nonexistent"]);
    expect(stderr).toContain("not found in configuration");
    expect(exitCode).toBe(1);
  });

  it("lists available log targets when logs exist", () => {
    writeConfig(VALID_CONFIG_TOML);
    const logDir = join(tmpHome, ".relay-gent", "targets", "web");
    mkdirSync(logDir, { recursive: true });
    writeFileSync(join(logDir, "log"), "test log content\n", "utf-8");

    const { stdout } = runCli(["log"]);
    expect(stdout).toContain("web");
  });

  it("displays log content for a specific target", () => {
    writeConfig(VALID_CONFIG_TOML);
    const logDir = join(tmpHome, ".relay-gent", "targets", "web");
    mkdirSync(logDir, { recursive: true });
    const logContent = "[2024-01-01T00:00:00Z] [info] Server started\n";
    writeFileSync(join(logDir, "log"), logContent, "utf-8");

    const { stdout } = runCli(["log", "--target", "web"]);
    expect(stdout).toContain("Server started");
    expect(stdout).toContain("2024-01-01T00:00:00Z");
  });

  it("--clear wipes the log file for the given target", () => {
    writeConfig(VALID_CONFIG_TOML);
    const logDir = join(tmpHome, ".relay-gent", "targets", "web");
    mkdirSync(logDir, { recursive: true });
    writeFileSync(join(logDir, "log"), "some old content\n", "utf-8");

    const { stdout } = runCli(["log", "--target", "web", "--clear"]);
    expect(stdout).toContain("Cleared logs for target: web");

    // After clearing, readLog returns "" so the CLI outputs
    // "No logs found for target: web" (target exists, but log is empty).
    const { stdout: verifyStdout } = runCli(["log", "--target", "web"]);
    expect(verifyStdout).toContain("No logs found for target: web");
  });
});

// ============================================================
// 8. Config Loading
// ============================================================

describe("config loading", () => {
  beforeEach(() => {
    removeConfig();
  });

  it("loads TOML config file and displays targets in status", () => {
    writeConfig(VALID_CONFIG_TOML);
    const { stdout } = runCli(["status"]);
    expect(stdout).toContain("web");
    expect(stdout).toContain("stopped");
  });

  it("loads multi-target config correctly", () => {
    writeConfig(MULTI_TARGET_CONFIG_TOML);
    const { stdout } = runCli(["status"]);
    expect(stdout).toContain("web");
    expect(stdout).toContain("api");
  });

  it("handles missing config file gracefully", () => {
    removeConfig();
    const { stdout } = runCli(["status"]);
    expect(stdout).toContain("No targets configured");
  });

  it("handles empty config file gracefully", () => {
    writeConfig("");
    const { stdout } = runCli(["status"]);
    expect(stdout).toContain("No targets configured");
  });
});

// ============================================================
// 9. Config Precedence (TOML vs Env)
// ============================================================

describe("config precedence", () => {
  beforeEach(() => {
    removeConfig();
  });

  it("env var overrides target adapter", () => {
    // Write config with opencode adapter and watchPath /tmp/web.log
    writeConfig(
      [
        "[targets.web]",
        `adapter = "raw-command"`,
        `watchPath = "/tmp/web.log"`,
        `parser = "json-lines"`,
        `command = "cat"`,
        "shell = true",
      ].join("\n"),
    );

    // Override via env var. Use watchPath (which is compatible across
    // all adapter types) to avoid schema validation issues.
    const { stdout } = runCli(["status"], {
      RELAY_GENT_TARGET_WEB_WATCH_PATH: "/custom/watch/path",
    });

    // The env overridden watchPath replaces the config file's watchPath.
    // The status table should show the overridden path.
    expect(stdout).toContain("custom/watch/path");
  });

  it("env var can add a new target not in config file", () => {
    // NOTE: The env-var regex only supports single-word target names
    // (no underscores in the name portion). Multi-word names like
    // `my_target` are parsed as target "my" with field "target_...".
    writeConfig("");
    const { stdout } = runCli(["status"], {
      RELAY_GENT_TARGET_NEW_ADAPTER: "opencode",
      RELAY_GENT_TARGET_NEW_WATCH_PATH: "/tmp/new.log",
      RELAY_GENT_TARGET_NEW_PARSER: "json-lines",
    });
    expect(stdout).toContain("new");
    expect(stdout).toContain("/tmp/new.log");
    expect(stdout).toContain("stopped");
  });

  it("CLI --target flag takes precedence (validated via error messages)", () => {
    writeConfig(VALID_CONFIG_TOML);
    // File must exist because the file existence check happens
    // before the target lookup in the CLI action handler.
    mkdirSync("/tmp", { recursive: true });
    writeFileSync("/tmp/relay-test.log", "", "utf-8");
    // Pass --target with a value that doesn't exist in config;
    // the CLI reads the flag value directly (not via env), so
    // this should produce the "not found" error regardless of env.
    const { stderr } = runCli(["watch", "/tmp/relay-test.log", "--target", "nonexistent"], {
      RELAY_GENT_TARGET_WEB_WATCH_PATH: "/overridden/path",
    });
    expect(stderr).toContain("not found in configuration");
  });
});

// ============================================================
// 10. Error Paths
// ============================================================

describe("error paths", () => {
  beforeEach(() => {
    removeConfig();
  });

  it("invalid TOML produces a descriptive error", () => {
    writeConfig("invalid toml {{{ broken");
    const { stderr } = runCli(["status"]);
    expect(stderr).toContain("Failed to parse config");
  });

  it("invalid TOML exits with code 1", () => {
    writeConfig("[[[broken]]]");
    const { exitCode } = runCli(["status"]);
    expect(exitCode).toBe(1);
  });

  it("unknown command produces error on stderr", () => {
    const { stderr } = runCli(["unknown-command"]);
    // Commander routes unknown subcommands as operands to the default
    // command (status), which expects 0 arguments. The error indicates
    // too many arguments.
    expect(stderr).toContain("too many arguments");
  });

  it("watch with non-existent file produces error on stderr", () => {
    writeConfig(VALID_CONFIG_TOML);
    const { stderr } = runCli(["watch", "/tmp/definitely-not-a-real-file.log", "--target", "web"]);
    expect(stderr).toContain("File not found");
  });

  it("once with non-existent file produces error on stderr", () => {
    writeConfig(VALID_CONFIG_TOML);
    const { stderr } = runCli(["once", "/tmp/definitely-not-a-real-file.log", "--target", "web"]);
    expect(stderr).toContain("File not found");
  });
});
