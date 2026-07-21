import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as toml from "toml";
import { type Config, ConfigSchema } from "../domain/config/config.schema";

export interface LoadConfigOptions {
  configPath?: string;
  envOverrides?: Record<string, string>;
  cliOverrides?: Partial<Config>;
}

export function loadConfig(options?: LoadConfigOptions): Config {
  const {
    configPath = join(homedir(), ".relay-gent", "config.toml"),
    envOverrides = {},
    cliOverrides = {},
  } = options ?? {};

  // 1. Load config file (TOML) — missing file is not an error
  let config: Record<string, unknown> = {};

  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, "utf-8");
    try {
      config = toml.parse(raw) as Record<string, unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to parse config: ${message}`);
    }
  }

  // 2. Apply environment variable overrides
  config = deepMerge(config, buildEnvConfig(envOverrides));

  // 3. Apply CLI overrides (highest precedent)
  config = deepMerge(config, cliOverrides as Record<string, unknown>);

  // 4. Ensure targets is present (required by schema, defaults to empty record)
  if (!("targets" in config)) {
    config.targets = {};
  }

  // 5. Validate with schema — applies schema defaults for missing fields
  return ConfigSchema.parse(config);
}

// ---------------------------------------------------------------
// Environment Variable Handling
// ---------------------------------------------------------------

/**
 * Read an env-var value from `envOverrides` first, falling back to
 * `process.env`.  Returns `undefined` when the variable is not set
 * or is set to an empty string (treating empty as unset).
 */
function getEnvValue(key: string, envOverrides: Record<string, string>): string | undefined {
  if (key in envOverrides) {
    const val = envOverrides[key];
    return val !== "" ? val : undefined;
  }
  const val = process.env[key];
  return val !== undefined && val !== "" ? val : undefined;
}

const TARGET_ENV_RE = /^RELAY_GENT_TARGET_([A-Z][A-Z0-9]*)_(.+)$/;

const TARGET_FIELD_MAP: Record<string, string> = {
  ADAPTER: "adapter",
  WATCH_PATH: "watchPath",
  PARSER: "parser",
  DEBOUNCE_MS: "debounceMs",
  COMMAND: "command",
  SHELL: "shell",
  SESSION_ID: "session_id",
  SERVER_URL: "server_url",
};

/** Build a partial config object from env-var overrides. */
function buildEnvConfig(envOverrides: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Scalar top-level overrides
  const defaultAdapter = getEnvValue("RELAY_GENT_DEFAULT_ADAPTER", envOverrides);
  if (defaultAdapter !== undefined) {
    result.defaultAdapter = defaultAdapter;
  }

  // Nested defaults.* overrides
  const debounceMs = getEnvValue("RELAY_GENT_DEFAULTS_DEBOUNCE_MS", envOverrides);
  const maxRetries = getEnvValue("RELAY_GENT_DEFAULTS_MAX_RETRIES", envOverrides);
  const retryBackoffMs = getEnvValue("RELAY_GENT_DEFAULTS_RETRY_BACKOFF_MS", envOverrides);

  if (debounceMs !== undefined || maxRetries !== undefined || retryBackoffMs !== undefined) {
    const defaults: Record<string, unknown> = {};
    if (debounceMs !== undefined) defaults.debounceMs = Number(debounceMs);
    if (maxRetries !== undefined) defaults.maxRetries = Number(maxRetries);
    if (retryBackoffMs !== undefined) defaults.retryBackoffMs = Number(retryBackoffMs);
    result.defaults = defaults;
  }

  // Target overrides: RELAY_GENT_TARGET_<NAME>_<FIELD>
  const targetOverrides = collectTargetEnvOverrides(envOverrides);
  if (Object.keys(targetOverrides).length > 0) {
    result.targets = targetOverrides;
  }

  return result;
}

/** Collect target-related env vars into a targets-shaped object. */
function collectTargetEnvOverrides(
  envOverrides: Record<string, string>,
): Record<string, Record<string, unknown>> {
  const targets: Record<string, Record<string, unknown>> = {};
  const seen = new Set<string>();

  // envOverrides take priority — process first so process.env can't shadow them
  for (const [key, val] of Object.entries(envOverrides)) {
    if (val === "") continue;
    seen.add(key);
    applyTargetOverride(targets, key, val);
  }

  for (const key of Object.keys(process.env)) {
    if (seen.has(key)) continue;
    const val = process.env[key];
    if (val === undefined || val === "") continue;
    applyTargetOverride(targets, key, val);
  }

  return targets;
}

/** Apply a single target env-var to the targets accumulator. */
function applyTargetOverride(
  targets: Record<string, Record<string, unknown>>,
  key: string,
  val: string,
): void {
  const match = key.match(TARGET_ENV_RE);
  if (!match) return;

  const [, rawName, rawField] = match;
  const name = rawName.toLowerCase();
  const field = TARGET_FIELD_MAP[rawField] ?? rawField.toLowerCase();

  if (!targets[name]) {
    targets[name] = {};
  }

  if (field === "debounceMs") {
    targets[name][field] = Number(val);
  } else if (field === "shell") {
    targets[name][field] = val === "true";
  } else {
    targets[name][field] = val;
  }
}

// ---------------------------------------------------------------
// Object Utilities
// ---------------------------------------------------------------

/** Recursive shallow merge — source values overwrite target values. */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };

  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = result[key];

    if (isPlainObject(srcVal) && isPlainObject(tgtVal)) {
      result[key] = deepMerge(tgtVal as Record<string, unknown>, srcVal as Record<string, unknown>);
    } else {
      result[key] = srcVal;
    }
  }

  return result;
}

function isPlainObject(value: unknown): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
