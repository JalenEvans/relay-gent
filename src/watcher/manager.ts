import * as chokidar from "chokidar";
import type { FileChangeCallback, WatcherOptions, WatcherState } from "./types.js";

export class WatcherManager {
  private watchers = new Map<string, chokidar.FSWatcher>();
  private states = new Map<string, WatcherState>();
  private callbacks = new Map<string, FileChangeCallback[]>();
  private options = new Map<string, WatcherOptions>();
  private onFileChangeCallback?: FileChangeCallback;

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

  async watchFile(filePath: string, options?: WatcherOptions): Promise<void> {
    if (this.watchers.has(filePath)) return;

    // Auto-detect when no explicit options are provided
    const resolvedOptions: WatcherOptions = options ?? WatcherManager.detectOptions(filePath);

    const watcher = chokidar.watch(filePath, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
    });

    watcher.on("change", (path: string) => {
      if (!WatcherManager.shouldIncludeFile(path, resolvedOptions.extensions)) return;
      this.onFileChangeCallback?.("change", path);
    });

    watcher.on("add", (path: string) => {
      if (!WatcherManager.shouldIncludeFile(path, resolvedOptions.extensions)) return;
      this.onFileChangeCallback?.("add", path);
    });

    watcher.on("unlink", (path: string) => {
      if (!WatcherManager.shouldIncludeFile(path, resolvedOptions.extensions)) return;
      this.onFileChangeCallback?.("unlink", path);
    });

    this.watchers.set(filePath, watcher);
    this.options.set(filePath, resolvedOptions);

    this.states.set(filePath, {
      path: filePath,
      active: true,
      startedAt: new Date().toISOString(),
      origin: resolvedOptions.origin,
      pattern: resolvedOptions.pattern,
    });
  }

  async unwatchFile(filePath: string): Promise<void> {
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

  async unwatchAll(): Promise<void> {
    for (const [path] of this.watchers) {
      await this.unwatchFile(path);
    }
  }

  /** Set the global file change callback */
  setOnFileChange(callback: FileChangeCallback): void {
    this.onFileChangeCallback = callback;
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
