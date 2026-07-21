import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ZodError } from "zod";
import type { Config } from "../../../src/domain/config/config.schema";
import type { LoadConfigOptions } from "../../../src/config/loader";

// ============================================================
// Config Loader — loadConfig()
// ============================================================
// loadConfig(options?) → Config
//
// Precedence (high→low):
//   1. CLI overrides (cliOverrides)
//   2. Environment variables (envOverrides)
//   3. Config file (TOML at configPath or ~/.relay-gent/config.toml)
//   4. Schema defaults
//
// Behavior:
//   - Missing config file → return defaults
//   - Malformed TOML → throw descriptive error
//   - Zod validation failure → throw ZodError
// ============================================================

// ------------------------------------------------------------------
// Helpers — TOML fixture strings
// ------------------------------------------------------------------

function fullToml(): string {
  return [
    'schemaVersion = 1',
    'defaultAdapter = "opencode"',
    "",
    "[defaults]",
    "debounceMs = 300",
    "maxRetries = 3",
    "retryBackoffMs = 1000",
    "",
    '[targets.web]',
    'adapter = "opencode"',
    'watchPath = "./src"',
    'parser = "typescript"',
    "",
    '[targets.api]',
    'adapter = "raw-command"',
    'watchPath = "./api"',
    'parser = "json-lines"',
    'command = "npm run build"',
  ].join("\n");
}

function partialToml(): string {
  return [
    '[targets.web]',
    'adapter = "opencode"',
    'watchPath = "./src"',
    'parser = "typescript"',
  ].join("\n");
}

function malformedToml(): string {
  return "garbage [[[ not valid toml ]]]";
}

function invalidConfigToml(): string {
  return [
    '[targets.web]',
    'adapter = "nonexistent-adapter"',
    'watchPath = "./src"',
    'parser = "typescript"',
  ].join("\n");
}

/** Create a fresh temp directory for test isolation */
async function createTmpDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "relay-gent-config-test-"));
}

// ============================================================
// loadConfig — Tests
// ============================================================

describe("loadConfig", () => {
  let tmpDir: string;
  let loadConfig: (options?: LoadConfigOptions) => Config;

  beforeEach(async () => {
    tmpDir = await createTmpDir();

    // Dynamic import with cache-busting query parameter to bypass any
    // global module mock that other test files (e.g. cli.core.test.ts)
    // may have registered via vi.mock(). Bun hoists vi.mock globally,
    // so static imports would resolve to the mocked version.
    const mod = await import("../../../src/config/loader?t=" + Date.now());
    loadConfig = mod.loadConfig;
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ----------------------------------------------------------------
  // 1. Basic Config Loading
  // ----------------------------------------------------------------
  describe("basic config loading", () => {
    it("returns defaults when no config file exists and no overrides", () => {
      const configPath = join(tmpDir, "nonexistent.toml");
      const config = loadConfig({ configPath });

      expect(config.schemaVersion).toBe(1);
      expect(config.defaultAdapter).toBe("opencode");
      expect(config.defaults.debounceMs).toBe(300);
      expect(config.defaults.maxRetries).toBe(3);
      expect(config.defaults.retryBackoffMs).toBe(1000);
      expect(config.targets).toEqual({});
    });

    it("returns config with defaults merged when partial config file exists", async () => {
      const configPath = join(tmpDir, "partial.toml");
      await writeFile(configPath, partialToml());

      const config = loadConfig({ configPath });

      // Values from the config file
      expect(config.targets.web).toBeDefined();
      expect(config.targets.web.adapter).toBe("opencode");
      expect(config.targets.web.watchPath).toBe("./src");
      expect(config.targets.web.parser).toBe("typescript");

      // Defaults from schema (not in the partial TOML)
      expect(config.schemaVersion).toBe(1);
      expect(config.defaultAdapter).toBe("opencode");
      expect(config.defaults.debounceMs).toBe(300);
      expect(config.defaults.maxRetries).toBe(3);
      expect(config.defaults.retryBackoffMs).toBe(1000);
    });
  });

  // ----------------------------------------------------------------
  // 2. TOML File Loading
  // ----------------------------------------------------------------
  describe("TOML file loading", () => {
    it("loads valid TOML config from a file path", async () => {
      const configPath = join(tmpDir, "full.toml");
      await writeFile(configPath, fullToml());

      const config = loadConfig({ configPath });

      expect(config.schemaVersion).toBe(1);
      expect(config.defaultAdapter).toBe("opencode");
      expect(config.defaults.debounceMs).toBe(300);
      expect(config.defaults.maxRetries).toBe(3);
      expect(config.defaults.retryBackoffMs).toBe(1000);

      expect(config.targets.web).toMatchObject({
        adapter: "opencode",
        watchPath: "./src",
        parser: "typescript",
      });
      expect(config.targets.api).toMatchObject({
        adapter: "raw-command",
        watchPath: "./api",
        parser: "json-lines",
        command: "npm run build",
      });
    });

    it("throws descriptive error for malformed TOML", async () => {
      const configPath = join(tmpDir, "malformed.toml");
      await writeFile(configPath, malformedToml());

      expect(() => loadConfig({ configPath })).toThrow();
    });

    it("throws for invalid config — Zod validation error", async () => {
      const configPath = join(tmpDir, "invalid.toml");
      await writeFile(configPath, invalidConfigToml());

      expect(() => loadConfig({ configPath })).toThrow(ZodError);
    });
  });

  // ----------------------------------------------------------------
  // 3. Environment Variable Overrides
  // ----------------------------------------------------------------
  describe("environment variable overrides", () => {
    it("env var overrides defaultAdapter when set", () => {
      const configPath = join(tmpDir, "nonexistent.toml");

      const config = loadConfig({
        configPath,
        envOverrides: { RELAY_GENT_DEFAULT_ADAPTER: "claude" },
      });

      expect(config.defaultAdapter).toBe("claude");
    });

    it("env var overrides defaults.debounceMs when set", () => {
      const configPath = join(tmpDir, "nonexistent.toml");

      const config = loadConfig({
        configPath,
        envOverrides: { RELAY_GENT_DEFAULTS_DEBOUNCE_MS: "500" },
      });

      expect(config.defaults.debounceMs).toBe(500);
    });
  });

  // ----------------------------------------------------------------
  // 4. CLI Flag Overrides (highest precedence)
  // ----------------------------------------------------------------
  describe("CLI flag overrides", () => {
    it("CLI overrides take precedence over env vars", () => {
      const configPath = join(tmpDir, "nonexistent.toml");

      const config = loadConfig({
        configPath,
        envOverrides: { RELAY_GENT_DEFAULT_ADAPTER: "claude" },
        cliOverrides: { defaultAdapter: "raw-command" },
      });

      // CLI override wins over env var
      expect(config.defaultAdapter).toBe("raw-command");
    });

    it("CLI overrides take precedence over config file", async () => {
      const configPath = join(tmpDir, "full.toml");
      await writeFile(configPath, fullToml());

      const config = loadConfig({
        configPath,
        cliOverrides: { defaultAdapter: "codex" },
      });

      // CLI override wins
      expect(config.defaultAdapter).toBe("codex");

      // Config file values still apply for non-overridden fields
      expect(config.defaults.debounceMs).toBe(300);
      expect(config.defaults.maxRetries).toBe(3);
      expect(config.defaults.retryBackoffMs).toBe(1000);
      expect(config.targets.web).toBeDefined();
      expect(config.targets.api).toBeDefined();
    });
  });

  // ----------------------------------------------------------------
  // 5. Combined Loading
  // ----------------------------------------------------------------
  describe("combined loading", () => {
    it("config file + env overrides + CLI overrides merge correctly", async () => {
      const configPath = join(tmpDir, "full.toml");
      await writeFile(configPath, fullToml());

      const config = loadConfig({
        configPath,
        envOverrides: {
          RELAY_GENT_DEFAULTS_MAX_RETRIES: "5",
          RELAY_GENT_DEFAULTS_RETRY_BACKOFF_MS: "2000",
        },
        cliOverrides: { defaultAdapter: "codex" },
      });

      // CLI override wins for defaultAdapter
      expect(config.defaultAdapter).toBe("codex");

      // Env var override applies for defaults
      expect(config.defaults.maxRetries).toBe(5);
      expect(config.defaults.retryBackoffMs).toBe(2000);

      // Config file values apply for non-overridden fields
      expect(config.defaults.debounceMs).toBe(300);
      expect(config.targets.web).toBeDefined();
      expect(config.targets.api).toBeDefined();

      // Schema default for schemaVersion
      expect(config.schemaVersion).toBe(1);
    });

    it("partial config with partial overrides works", async () => {
      const configPath = join(tmpDir, "partial.toml");
      await writeFile(configPath, partialToml());

      const config = loadConfig({
        configPath,
        envOverrides: { RELAY_GENT_DEFAULTS_DEBOUNCE_MS: "250" },
        cliOverrides: { defaultAdapter: "raw-command" },
      });

      // CLI override
      expect(config.defaultAdapter).toBe("raw-command");

      // Env override
      expect(config.defaults.debounceMs).toBe(250);

      // Schema defaults for non-overridden defaults fields
      expect(config.defaults.maxRetries).toBe(3);
      expect(config.defaults.retryBackoffMs).toBe(1000);

      // Config file target
      expect(config.targets.web).toBeDefined();
      expect(config.targets.web.adapter).toBe("opencode");
    });
  });
});
