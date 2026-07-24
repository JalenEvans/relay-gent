import { join } from "node:path";
import * as chokidar from "chokidar";
import type { FileChangeCallback, WatcherOptions, WatcherState } from "./types.js";

export class WatcherManager {
  private watchers = new Map<string, chokidar.FSWatcher>();
  private states = new Map<string, WatcherState>();
  private callbacks = new Map<string, FileChangeCallback[]>();
  private options = new Map<string, WatcherOptions>();
  private onFileChangeCallback?: FileChangeCallback;
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private recentChanges: string[] = [];
  private static readonly MAX_RECENT_CHANGES = 100;

  /** Detect if a path string contains glob wildcard characters */
  static isGlobPattern(path: string): boolean {
    return /[*?[\]{}]/.test(path);
  }

  /**
   * Check if a file path should be included based on extension filter.
   * Case-insensitive. No filter or empty filter = include all.
   */
  static shouldIncludeFile(path: string, extensions?: string[]): boolean {
    if (!extensions || extensions.length === 0) return true;
    const ext = path.toLowerCase();
    return extensions.some((e) => ext.endsWith(e.toLowerCase()));
  }

  /** Clear a debounce timer for a given path, if one exists */
  private clearDebounceTimer(path: string): void {
    const timer = this.debounceTimers.get(path);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(path);
    }
  }

  /** Auto-detect WatcherOptions based on the path when no explicit options provided */
  private static detectOptions(path: string): WatcherOptions {
    if (WatcherManager.isGlobPattern(path)) {
      return { origin: "glob", pattern: path };
    }
    if (path.endsWith("/")) {
      return { origin: "directory", pattern: path };
    }
    return { origin: "single-file", pattern: path };
  }

  /**
   * Parse .gitignore text content into an array of glob patterns.
   * Skips comment lines (#) and blank lines.
   * Converts common patterns:
   *   "node_modules/" becomes glob match for any node_modules directory
   *   "*.log" becomes glob match for any .log file
   *   ".env" becomes glob match for any .env file
   *   "build/" becomes glob match for any build directory
   *   "!/keep.me" patterns are excluded (negation not supported yet)
   */
  static parseGitignore(content: string): string[] {
    const patterns: string[] = [];
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      // Skip negation patterns (for now)
      if (trimmed.startsWith("!")) continue;

      // Convert to glob pattern
      let pattern = trimmed;
      // Check if it was a directory pattern (trailing /)
      const isDir = pattern.endsWith("/");
      if (isDir) {
        pattern = pattern.slice(0, -1); // remove trailing /
      }
      // Prepend **/ for non-anchored patterns
      if (!pattern.startsWith("**/")) {
        pattern = `**/${pattern}`;
      }
      // For directory patterns, append /**
      if (isDir) {
        pattern = `${pattern}/**`;
      }
      patterns.push(pattern);
    }
    return patterns;
  }

  /**
   * Attempt to load and parse .gitignore from a directory.
   * Returns empty array if no .gitignore file exists or read fails.
   */
  static async loadGitignore(watchPath: string): Promise<string[]> {
    try {
      const { readFile } = await import("node:fs/promises");
      const gitignorePath = join(watchPath, ".gitignore");
      const content = await readFile(gitignorePath, "utf-8");
      return WatcherManager.parseGitignore(content);
    } catch {
      // ENOENT = no .gitignore, other errors = can't read
      return [];
    }
  }

  async watchFile(filePath: string, options?: WatcherOptions): Promise<void> {
    if (this.watchers.has(filePath)) return;

    // Auto-detect when no explicit options are provided
    const resolvedOptions: WatcherOptions = options ?? WatcherManager.detectOptions(filePath);
    if (resolvedOptions.debounceMs === undefined) {
      resolvedOptions.debounceMs = 300;
    }

    // Default respectGitignore to true when not specified
    if (resolvedOptions.respectGitignore === undefined) {
      resolvedOptions.respectGitignore = true;
    }

    // Validate path length before passing to chokidar (OS max is typically 4096)
    const MAX_PATH_LENGTH = 4096;
    if (filePath.length > MAX_PATH_LENGTH) {
      throw new Error(`Path too long: ${filePath.length} characters (max ${MAX_PATH_LENGTH})`);
    }

    // Build chokidar options
    const chokidarOptions: chokidar.ChokidarOptions = {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
    };

    // Handle .gitignore
    if (resolvedOptions.respectGitignore) {
      let dir: string;
      if (resolvedOptions.origin === "directory" || filePath.endsWith("/")) {
        dir = filePath.replace(/\/+$/, "");
      } else if (filePath.includes("*")) {
        // Glob pattern — extract base directory before the first wildcard
        const starIndex = filePath.indexOf("*");
        const lastSlash = filePath.lastIndexOf("/", starIndex);
        dir = lastSlash >= 0 ? filePath.substring(0, lastSlash) : ".";
      } else {
        // Single file/directory path — check if it looks like a directory
        const lastSlash = filePath.lastIndexOf("/");
        const fileName = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
        if (fileName.includes(".")) {
          // Has a file extension → treat as file, use parent directory
          dir = lastSlash >= 0 ? filePath.substring(0, lastSlash) || "." : ".";
        } else {
          // No extension → treat as a directory, use path directly
          dir = filePath;
        }
      }
      const ignorePatterns = await WatcherManager.loadGitignore(dir);
      if (ignorePatterns.length > 0) {
        chokidarOptions.ignored = ignorePatterns;
      }
    }

    const debounceMs = resolvedOptions.debounceMs;

    const watcher = chokidar.watch(filePath, chokidarOptions);

    const debounceHandler = (event: string, path: string) => {
      if (!WatcherManager.shouldIncludeFile(path, resolvedOptions.extensions)) return;

      if (debounceMs === 0) {
        // Passthrough - no debounce
        this.onFileChangeCallback?.(event, path);
        return;
      }

      // Debounce: clear existing timer for this path, set new one
      this.clearDebounceTimer(path);
      this.debounceTimers.set(
        path,
        setTimeout(() => {
          this.debounceTimers.delete(path);
          this.onFileChangeCallback?.(event, path);
        }, debounceMs),
      );
    };

    watcher.on("change", (path: string) => debounceHandler("change", path));
    watcher.on("add", (path: string) => debounceHandler("add", path));
    watcher.on("unlink", (path: string) => debounceHandler("unlink", path));

    this.watchers.set(filePath, watcher);
    this.options.set(filePath, resolvedOptions);

    this.states.set(filePath, {
      path: filePath,
      active: true,
      startedAt: new Date().toISOString(),
      origin: resolvedOptions.origin,
      pattern: resolvedOptions.pattern,
      debounceMs: resolvedOptions.debounceMs,
      respectGitignore: resolvedOptions.respectGitignore,
    });
  }

  async unwatchFile(filePath: string): Promise<void> {
    this.clearDebounceTimer(filePath);
    const watcher = this.watchers.get(filePath);
    if (watcher) {
      await watcher.close();
      this.watchers.delete(filePath);
      this.states.delete(filePath);
      this.options.delete(filePath);
      this.callbacks.delete(filePath);
    }
  }

  getWatchedPaths(): string[] {
    return Array.from(this.states.keys());
  }

  getWatcherState(path: string): WatcherState | undefined {
    return this.states.get(path);
  }

  getAllStates(): WatcherState[] {
    return Array.from(this.states.values());
  }

  /** Get the most recently changed file paths */
  getRecentChanges(): string[] {
    return [...this.recentChanges];
  }

  async unwatchAll(): Promise<void> {
    // Clear all debounce timers
    for (const [path] of this.debounceTimers) {
      this.clearDebounceTimer(path);
    }
    for (const [path] of this.watchers) {
      await this.unwatchFile(path);
    }
  }

  /** Set the global file change callback */
  setOnFileChange(callback: FileChangeCallback): void {
    this.onFileChangeCallback = (event: string, path: string) => {
      // Track the changed path
      this.recentChanges.push(path);
      if (this.recentChanges.length > WatcherManager.MAX_RECENT_CHANGES) {
        this.recentChanges = this.recentChanges.slice(
          -Math.floor(WatcherManager.MAX_RECENT_CHANGES / 2),
        );
      }
      callback(event, path);
    };
  }

  /** Get the current file change callback (or undefined if none) */
  getOnFileChange(): FileChangeCallback | undefined {
    return this.onFileChangeCallback;
  }

  /** Get options for a watched path */
  getWatcherOptions(path: string): WatcherOptions | undefined {
    return this.options.get(path);
  }
}
