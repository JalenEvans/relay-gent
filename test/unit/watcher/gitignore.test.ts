import { describe, test, expect, spyOn, beforeAll, afterAll } from "bun:test";
import { writeFileSync, unlinkSync, existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

// ============================================================
// .gitignore Integration in WatcherManager
// ============================================================
// RED PHASE: No .gitignore support exists yet. WatcherManager
// has no respectGitignore option, no parseGitignore method, and
// no loadGitignore method. Chokidar watchers are created without
// any "ignored" option.
//
// Expected design:
//   - WatcherOptions adds respectGitignore?: boolean (default true)
//   - WatcherManager.parseGitignore(content) converts .gitignore
//     patterns to glob format
//   - WatcherManager.loadGitignore(watchPath) reads .gitignore
//     from the watch directory
//   - When respectGitignore: true, parsed patterns are passed
//     to chokidar's "ignored" option
// ============================================================

const TEST_DIR = "/tmp/watcher-gitignore-test";
const GITIGNORE_PATH = join(TEST_DIR, ".gitignore");

// ------------------------------------------------------------------
// WatcherOptions – respectGitignore field
// ------------------------------------------------------------------
describe("WatcherOptions - respectGitignore field", () => {
  test("watchFile with { respectGitignore: true } stores true and triggers gitignore parsing", async () => {
    const { WatcherManager } = await import("../../../src/watcher");

    // FAILS: parseGitignore static method does not exist yet.
    // When implemented, watchFile with respectGitignore:true should
    // parse the .gitignore file and apply the patterns to chokidar.
    expect(WatcherManager.parseGitignore).toBeDefined();

    const manager = new WatcherManager();
    await manager.watchFile("/tmp/gitignore-true.log", {
      respectGitignore: true,
    } as any);

    const opts = manager.getWatcherOptions("/tmp/gitignore-true.log");
    expect(opts).toBeDefined();
    expect((opts as any).respectGitignore).toBe(true);

    await manager.unwatchAll();
  });

  test("watchFile with { respectGitignore: false } stores false and suppresses gitignore loading", async () => {
    const { WatcherManager } = await import("../../../src/watcher");

    // FAILS: loadGitignore static method does not exist yet.
    // When implemented, respectGitignore:false should prevent the
    // watcher from loading .gitignore patterns entirely.
    expect(WatcherManager.loadGitignore).toBeDefined();

    const manager = new WatcherManager();
    await manager.watchFile("/tmp/gitignore-false.log", {
      respectGitignore: false,
    } as any);

    const opts = manager.getWatcherOptions("/tmp/gitignore-false.log");
    expect(opts).toBeDefined();
    expect((opts as any).respectGitignore).toBe(false);

    await manager.unwatchAll();
  });

  test("watchFile without respectGitignore defaults to true", async () => {
    const { WatcherManager } = await import("../../../src/watcher");
    const manager = new WatcherManager();

    await manager.watchFile("/tmp/gitignore-default.log");

    const opts = manager.getWatcherOptions("/tmp/gitignore-default.log");
    expect(opts).toBeDefined();

    // FAILS: No default is applied — respectGitignore is undefined.
    // After implementation, watchFile should set respectGitignore: true
    // by default when the option is omitted.
    expect((opts as any).respectGitignore).toBe(true);

    await manager.unwatchAll();
  });
});

// ------------------------------------------------------------------
// WatcherManager.parseGitignore – static pattern conversion
// ------------------------------------------------------------------
describe("WatcherManager.parseGitignore static method", () => {
  test("parseGitignore exists as a static method on WatcherManager", async () => {
    const { WatcherManager } = await import("../../../src/watcher");

    // FAILS: parseGitignore does not exist yet
    expect(WatcherManager.parseGitignore).toBeDefined();
    expect(typeof WatcherManager.parseGitignore).toBe("function");
  });

  test("parseGitignore converts .gitignore patterns to glob format", async () => {
    const { WatcherManager } = await import("../../../src/watcher");

    // FAILS: method doesn't exist yet
    expect(WatcherManager.parseGitignore).toBeDefined();
    const patterns = WatcherManager.parseGitignore(
      "node_modules/\n*.log\n.env"
    );
    expect(patterns).toContain("**/node_modules/**");
    expect(patterns).toContain("**/*.log");
    expect(patterns).toContain("**/.env");
  });

  test("parseGitignore skips comments and blank lines", async () => {
    const { WatcherManager } = await import("../../../src/watcher");

    // FAILS: method doesn't exist yet
    expect(WatcherManager.parseGitignore).toBeDefined();
    const patterns = WatcherManager.parseGitignore(
      "node_modules/\n\n# this is a comment\n*.log\n  \n.env"
    );
    expect(patterns).not.toContain("");
    expect(patterns).not.toContain("# this is a comment");
    expect(patterns).toHaveLength(3);
    expect(patterns).toContain("**/node_modules/**");
    expect(patterns).toContain("**/*.log");
    expect(patterns).toContain("**/.env");
  });

  test("parseGitignore handles empty content", async () => {
    const { WatcherManager } = await import("../../../src/watcher");

    // FAILS: method doesn't exist yet
    expect(WatcherManager.parseGitignore).toBeDefined();
    const patterns = WatcherManager.parseGitignore("");
    expect(patterns).toEqual([]);
  });

  test("parseGitignore handles directory pattern with trailing slash", async () => {
    const { WatcherManager } = await import("../../../src/watcher");

    // FAILS: method doesn't exist yet
    expect(WatcherManager.parseGitignore).toBeDefined();
    const patterns = WatcherManager.parseGitignore("build/");
    expect(patterns).toContain("**/build/**");
  });

  test("parseGitignore converts *.min.js correctly", async () => {
    const { WatcherManager } = await import("../../../src/watcher");

    // FAILS: method doesn't exist yet
    expect(WatcherManager.parseGitignore).toBeDefined();
    const patterns = WatcherManager.parseGitignore("*.min.js\n*.map");
    expect(patterns).toContain("**/*.min.js");
    expect(patterns).toContain("**/*.map");
  });
});

// ------------------------------------------------------------------
// WatcherManager.loadGitignore – static file loading
// ------------------------------------------------------------------
describe("WatcherManager.loadGitignore static method", () => {
  beforeAll(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    if (existsSync(GITIGNORE_PATH)) unlinkSync(GITIGNORE_PATH);
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  test("loadGitignore exists as a static method on WatcherManager", async () => {
    const { WatcherManager } = await import("../../../src/watcher");

    // FAILS: loadGitignore does not exist yet
    expect(WatcherManager.loadGitignore).toBeDefined();
    expect(typeof WatcherManager.loadGitignore).toBe("function");
  });

  test("loadGitignore returns empty array when no .gitignore file exists", async () => {
    // Ensure no .gitignore is present
    if (existsSync(GITIGNORE_PATH)) unlinkSync(GITIGNORE_PATH);

    const { WatcherManager } = await import("../../../src/watcher");

    // FAILS: loadGitignore does not exist yet
    expect(WatcherManager.loadGitignore).toBeDefined();
    const patterns = await WatcherManager.loadGitignore(TEST_DIR);
    expect(patterns).toEqual([]);
  });

  test("loadGitignore reads and parses .gitignore file from directory", async () => {
    // Create a .gitignore file with known content
    writeFileSync(GITIGNORE_PATH, "node_modules/\n*.log\n.env\n");

    const { WatcherManager } = await import("../../../src/watcher");

    // FAILS: loadGitignore does not exist yet
    expect(WatcherManager.loadGitignore).toBeDefined();
    const patterns = await WatcherManager.loadGitignore(TEST_DIR);
    expect(patterns).toContain("**/node_modules/**");
    expect(patterns).toContain("**/*.log");
    expect(patterns).toContain("**/.env");

    unlinkSync(GITIGNORE_PATH);
  });
});

// ------------------------------------------------------------------
// Chokidar integration – "ignored" option
// ------------------------------------------------------------------
describe("Gitignore patterns applied to chokidar watcher", () => {
  beforeAll(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
    writeFileSync(GITIGNORE_PATH, "*.log\n.tmp/\n");
  });

  afterAll(() => {
    if (existsSync(GITIGNORE_PATH)) unlinkSync(GITIGNORE_PATH);
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  test("watchFile with respectGitignore:true passes patterns as chokidar ignored option", async () => {
    const chokidar = await import("chokidar");
    const watchSpy = spyOn(chokidar, "watch").mockImplementation(
      (() => ({
        on: () => {},
        close: async () => {},
        add: () => {},
        unwatch: () => {},
        getWatched: () => ({}),
      })) as any
    );

    try {
      const { WatcherManager } = await import("../../../src/watcher");
      const manager = new WatcherManager();

      await manager.watchFile(TEST_DIR, {
        respectGitignore: true,
      } as any);

      // FAILS: watchFile doesn't pass ignored patterns to chokidar yet
      expect(watchSpy).toHaveBeenCalled();
      const [, chokidarOpts] = watchSpy.mock.calls[0] as [
        string,
        Record<string, unknown>
      ];
      expect(chokidarOpts.ignored).toBeDefined();
      expect(Array.isArray(chokidarOpts.ignored)).toBe(true);
      expect(chokidarOpts.ignored).toContain("**/*.log");
      expect(chokidarOpts.ignored).toContain("**/.tmp/**");

      await manager.unwatchAll();
    } finally {
      watchSpy.mockRestore();
    }
  });

  test("respectGitignore:false bypasses gitignore pattern loading", async () => {
    const { WatcherManager } = await import("../../../src/watcher");

    // FAILS: loadGitignore does not exist yet
    // When implemented, setting respectGitignore:false should ensure
    // loadGitignore is never called and no ignored patterns are applied.
    expect(WatcherManager.loadGitignore).toBeDefined();

    const manager = new WatcherManager();
    await manager.watchFile("/tmp/bypass-test", {
      respectGitignore: false,
    } as any);

    const opts = manager.getWatcherOptions("/tmp/bypass-test");
    expect(opts).toBeDefined();
    expect((opts as any).respectGitignore).toBe(false);

    await manager.unwatchAll();
  });
});
