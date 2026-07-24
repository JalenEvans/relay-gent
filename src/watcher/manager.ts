import * as chokidar from "chokidar";
import type { WatcherState } from "./types.js";

export class WatcherManager {
  private watchers = new Map<string, chokidar.FSWatcher>();
  private states = new Map<string, WatcherState>();

  async watchFile(filePath: string): Promise<void> {
    if (this.watchers.has(filePath)) return;

    const watcher = chokidar.watch(filePath, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
    });

    this.watchers.set(filePath, watcher);
    this.states.set(filePath, {
      path: filePath,
      active: true,
      startedAt: new Date().toISOString(),
    });
  }

  async unwatchFile(filePath: string): Promise<void> {
    const watcher = this.watchers.get(filePath);
    if (watcher) {
      await watcher.close();
      this.watchers.delete(filePath);
      this.states.delete(filePath);
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
}
