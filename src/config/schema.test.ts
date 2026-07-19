import { describe, expect, it } from "bun:test";
import { ConfigSchema } from "./schema";

// ============================================================
// ConfigSchema — Top-level config with discriminated union targets
// ============================================================
// Top-level fields:
//   - schemaVersion: 1 (default)
//   - defaultAdapter: string (default "opencode")
//   - defaults: { debounceMs (300), maxRetries (3), retryBackoffMs (1000) }
//   - targets: Record<string, TargetConfig>
//
// Target variants (discriminated union on `adapter`):
//   - "opencode"      (required: watchPath, parser, server_url; optional: debounceMs, session_id)
//   - "raw-command"   (required: watchPath, parser, command; optional: debounceMs; default shell=true)
//   - "codex"         (required: watchPath, parser; optional: debounceMs, session_id)
//   - "claude"        (required: watchPath, parser; optional: debounceMs, session_id)
// ============================================================

describe("ConfigSchema", () => {
  // ------------------------------------------------------------------
  // 1. Defaults
  // ------------------------------------------------------------------
  describe("defaults", () => {
    it("applies default debounceMs of 300", () => {
      const result = ConfigSchema.parse({
        targets: {
          main: {
            adapter: "opencode",
            watchPath: "CHANGELOG.md",
            parser: "revdiff",
            server_url: "http://localhost:4096",
          },
        },
      });
      expect(result.defaults.debounceMs).toBe(300);
    });

    it("applies default maxRetries of 3", () => {
      const result = ConfigSchema.parse({
        targets: {
          main: {
            adapter: "opencode",
            watchPath: "CHANGELOG.md",
            parser: "revdiff",
            server_url: "http://localhost:4096",
          },
        },
      });
      expect(result.defaults.maxRetries).toBe(3);
    });

    it("applies default retryBackoffMs of 1000", () => {
      const result = ConfigSchema.parse({
        targets: {
          main: {
            adapter: "opencode",
            watchPath: "CHANGELOG.md",
            parser: "revdiff",
            server_url: "http://localhost:4096",
          },
        },
      });
      expect(result.defaults.retryBackoffMs).toBe(1000);
    });

    it("applies default defaultAdapter of opencode", () => {
      const result = ConfigSchema.parse({
        targets: {},
      });
      expect(result.defaultAdapter).toBe("opencode");
    });

    it("includes schemaVersion 1 in parsed output", () => {
      const result = ConfigSchema.parse({
        targets: {},
      });
      expect(result.schemaVersion).toBe(1);
    });
  });

  // ------------------------------------------------------------------
  // 2. OpencodeTarget
  // ------------------------------------------------------------------
  describe("OpencodeTarget", () => {
    it("accepts valid opencode target", () => {
      const result = ConfigSchema.parse({
        targets: {
          main: {
            adapter: "opencode",
            watchPath: "CHANGELOG.md",
            parser: "revdiff",
            server_url: "http://localhost:4096",
          },
        },
      });
      expect(result.targets.main).toMatchObject({
        adapter: "opencode",
        watchPath: "CHANGELOG.md",
        parser: "revdiff",
        server_url: "http://localhost:4096",
      });
    });

    it("applies default server_url of http://localhost:4096", () => {
      const result = ConfigSchema.parse({
        targets: {
          main: {
            adapter: "opencode",
            watchPath: "CHANGELOG.md",
            parser: "revdiff",
          },
        },
      });
      expect(result.targets.main).toMatchObject({
        adapter: "opencode",
        server_url: "http://localhost:4096",
      });
    });

    it("accepts optional debounceMs", () => {
      const result = ConfigSchema.parse({
        targets: {
          main: {
            adapter: "opencode",
            watchPath: "CHANGELOG.md",
            parser: "revdiff",
            server_url: "http://localhost:4096",
            debounceMs: 500,
          },
        },
      });
      expect(result.targets.main).toMatchObject({
        debounceMs: 500,
      });
    });

    it("accepts optional session_id", () => {
      const result = ConfigSchema.parse({
        targets: {
          main: {
            adapter: "opencode",
            watchPath: "CHANGELOG.md",
            parser: "revdiff",
            server_url: "http://localhost:4096",
            session_id: "abc-123",
          },
        },
      });
      expect(result.targets.main).toMatchObject({
        session_id: "abc-123",
      });
    });
  });

  // ------------------------------------------------------------------
  // 3. RawCommandTarget
  // ------------------------------------------------------------------
  describe("RawCommandTarget", () => {
    it("accepts valid raw-command target", () => {
      const result = ConfigSchema.parse({
        targets: {
          main: {
            adapter: "raw-command",
            watchPath: "CHANGELOG.md",
            parser: "revdiff",
            command: "echo hello",
          },
        },
      });
      expect(result.targets.main).toMatchObject({
        adapter: "raw-command",
        watchPath: "CHANGELOG.md",
        parser: "revdiff",
        command: "echo hello",
      });
    });

    it("applies default shell of true", () => {
      const result = ConfigSchema.parse({
        targets: {
          main: {
            adapter: "raw-command",
            watchPath: "CHANGELOG.md",
            parser: "revdiff",
            command: "echo hello",
          },
        },
      });
      expect(result.targets.main).toMatchObject({
        shell: true,
      });
    });

    it("rejects raw-command with missing command", () => {
      expect(() =>
        ConfigSchema.parse({
          targets: {
            main: {
              adapter: "raw-command",
              watchPath: "CHANGELOG.md",
              parser: "revdiff",
            },
          },
        }),
      ).toThrow();
    });
  });

  // ------------------------------------------------------------------
  // 4. CodexTarget
  // ------------------------------------------------------------------
  describe("CodexTarget", () => {
    it("accepts valid codex target", () => {
      const result = ConfigSchema.parse({
        targets: {
          main: {
            adapter: "codex",
            watchPath: "CHANGELOG.md",
            parser: "revdiff",
          },
        },
      });
      expect(result.targets.main).toMatchObject({
        adapter: "codex",
        watchPath: "CHANGELOG.md",
        parser: "revdiff",
      });
    });
  });

  // ------------------------------------------------------------------
  // 5. ClaudeTarget
  // ------------------------------------------------------------------
  describe("ClaudeTarget", () => {
    it("accepts valid claude target", () => {
      const result = ConfigSchema.parse({
        targets: {
          main: {
            adapter: "claude",
            watchPath: "CHANGELOG.md",
            parser: "revdiff",
          },
        },
      });
      expect(result.targets.main).toMatchObject({
        adapter: "claude",
        watchPath: "CHANGELOG.md",
        parser: "revdiff",
      });
    });
  });

  // ------------------------------------------------------------------
  // 6. Discriminated Union
  // ------------------------------------------------------------------
  describe("Discriminated Union", () => {
    it("rejects unknown adapter type", () => {
      expect(() =>
        ConfigSchema.parse({
          targets: {
            main: {
              adapter: "unknown-adapter",
              watchPath: "CHANGELOG.md",
              parser: "revdiff",
            },
          },
        }),
      ).toThrow();
    });

    it("validates adapter-specific fields correctly", () => {
      // opencode rejects missing server_url if not defaulted
      // raw-command rejects missing command
      expect(() =>
        ConfigSchema.parse({
          targets: {
            rc: {
              adapter: "raw-command",
              watchPath: "CHANGELOG.md",
              parser: "revdiff",
              // command is missing
            },
          },
        }),
      ).toThrow();
    });
  });

  // ------------------------------------------------------------------
  // 7. Multiple Targets
  // ------------------------------------------------------------------
  describe("Multiple Targets", () => {
    it("accepts config with multiple targets", () => {
      const result = ConfigSchema.parse({
        targets: {
          opencode_main: {
            adapter: "opencode",
            watchPath: "CHANGELOG.md",
            parser: "revdiff",
            server_url: "http://localhost:4096",
          },
          codex_alt: {
            adapter: "codex",
            watchPath: "NOTES.md",
            parser: "markdown-headers",
          },
          claude_side: {
            adapter: "claude",
            watchPath: "LOG.md",
            parser: "json-lines",
          },
        },
      });
      expect(Object.keys(result.targets)).toHaveLength(3);
      expect(result.targets.opencode_main).toMatchObject({ adapter: "opencode" });
      expect(result.targets.codex_alt).toMatchObject({ adapter: "codex" });
      expect(result.targets.claude_side).toMatchObject({ adapter: "claude" });
    });

    it("accepts config with empty targets", () => {
      const result = ConfigSchema.parse({
        targets: {},
      });
      expect(result.targets).toEqual({});
    });
  });

  // ------------------------------------------------------------------
  // 8. Full Config
  // ------------------------------------------------------------------
  describe("Full Config", () => {
    it("accepts minimal valid config", () => {
      const result = ConfigSchema.parse({
        targets: {
          main: {
            adapter: "opencode",
            watchPath: "CHANGELOG.md",
            parser: "revdiff",
            server_url: "http://localhost:4096",
          },
        },
      });
      expect(result.schemaVersion).toBe(1);
      expect(result.defaultAdapter).toBe("opencode");
      expect(result.defaults.debounceMs).toBe(300);
      expect(result.defaults.maxRetries).toBe(3);
      expect(result.defaults.retryBackoffMs).toBe(1000);
      expect(Object.keys(result.targets)).toHaveLength(1);
    });

    it("accepts full config with all options", () => {
      const result = ConfigSchema.parse({
        schemaVersion: 1,
        defaultAdapter: "claude",
        defaults: {
          debounceMs: 500,
          maxRetries: 5,
          retryBackoffMs: 2000,
        },
        targets: {
          primary: {
            adapter: "opencode",
            watchPath: "CHANGELOG.md",
            parser: "revdiff",
            debounceMs: 250,
            server_url: "http://localhost:4096",
            session_id: "sess-001",
          },
          secondary: {
            adapter: "raw-command",
            watchPath: "NOTES.md",
            parser: "markdown-headers",
            debounceMs: 1000,
            command: "cat NOTES.md",
            shell: false,
          },
        },
      });
      expect(result.schemaVersion).toBe(1);
      expect(result.defaultAdapter).toBe("claude");
      expect(result.defaults).toEqual({
        debounceMs: 500,
        maxRetries: 5,
        retryBackoffMs: 2000,
      });
      expect(result.targets.primary).toMatchObject({
        adapter: "opencode",
        debounceMs: 250,
        server_url: "http://localhost:4096",
        session_id: "sess-001",
      });
      expect(result.targets.secondary).toMatchObject({
        adapter: "raw-command",
        debounceMs: 1000,
        command: "cat NOTES.md",
        shell: false,
      });
    });
  });

  // ------------------------------------------------------------------
  // 9. Target shared fields
  // ------------------------------------------------------------------
  describe("Target shared fields", () => {
    it("requires watchPath on all target types", () => {
      expect(() =>
        ConfigSchema.parse({
          targets: {
            main: {
              adapter: "opencode",
              parser: "revdiff",
              server_url: "http://localhost:4096",
              // watchPath missing
            },
          },
        }),
      ).toThrow();
    });

    it("requires parser on all target types", () => {
      expect(() =>
        ConfigSchema.parse({
          targets: {
            main: {
              adapter: "codex",
              watchPath: "CHANGELOG.md",
              // parser missing
            },
          },
        }),
      ).toThrow();
    });
  });

  // ------------------------------------------------------------------
  // 10. Fuzz / malformed input
  // ------------------------------------------------------------------
  describe("Fuzz", () => {
    it("rejects empty object", () => {
      expect(() => ConfigSchema.parse({})).toThrow();
    });

    it("rejects null input", () => {
      expect(() => ConfigSchema.parse(null)).toThrow();
    });

    it("rejects undefined input", () => {
      expect(() => ConfigSchema.parse(undefined)).toThrow();
    });

    it("rejects string input", () => {
      expect(() => ConfigSchema.parse("not a config")).toThrow();
    });

    it("rejects array input", () => {
      expect(() => ConfigSchema.parse([])).toThrow();
    });
  });
});
