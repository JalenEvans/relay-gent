import { readFile, stat, readdir } from "node:fs/promises";
import { join } from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type { Adapter } from "../domain/adapter/adapter.interface";
import type { TargetConfig } from "../domain/config/config.schema";
import type { Parser } from "../domain/parser/parser.interface";
import type { Record } from "../domain/record/record.schema";
import { DeltaTracker } from "../core/delta";
import { StateStore } from "../state/store";

// ============================================================
// Runner — orchestrator that wires Parser → Adapter →
// DeltaTracker → StateStore into a file-change pipeline.
// ============================================================

export class Runner {
  private watcher?: FSWatcher;

  constructor(
    public readonly config: TargetConfig,
    private readonly parser: Parser,
    private readonly adapter: Adapter,
    private readonly delta: DeltaTracker,
    private readonly store: StateStore,
  ) {}

  /**
   * Handle a file-change event for the given path.
   * Full pipeline: read → parse → delta-filter → deliver → mark-delivered.
   * All errors are caught and logged, never rethrown.
   */
  async onFileChange(filePath: string): Promise<void> {
    try {
      const content = await readFile(filePath, "utf-8");
      const records = this.parser.parse(content);

      if (records.length === 0) return;

      const { newRecords, changedRecords } = await this.delta.filter(
        records,
      );

      const toDeliver = [...newRecords, ...changedRecords];
      if (toDeliver.length === 0) return;

      await this.adapter.deliver(toDeliver, this.config);
      await this.delta.markDelivered(toDeliver);
    } catch (error) {
      console.error(error);
    }
  }

  /**
   * Start the runner.
   *
   * In **foreground mode** (`{ foreground: true }`):
   * 1. Loads persisted state.
   * 2. Processes the configured watch path immediately (initial file).
   * 3. Sets up a chokidar file watcher on the watch path to handle
   *    subsequent `add` and `change` events.
   *
   * In **one-shot mode** (`{ once: true }`):
   * 1. Loads persisted state.
   * 2. Processes the configured watch path once.
   */
  async start(options: { once?: boolean; foreground?: boolean }): Promise<void> {
    await this.store.load();

    if (options.foreground) {
      // Process the initial file(s). If watchPath is a directory, enumerate
      // its current files so they are not missed by the watcher (which uses
      // ignoreInitial: true to avoid re-processing).
      try {
        const pathStat = await stat(this.config.watchPath);
        if (pathStat.isDirectory()) {
          const entries = await readdir(this.config.watchPath, {
            withFileTypes: true,
          });
          for (const entry of entries) {
            if (entry.isFile()) {
              await this.onFileChange(join(this.config.watchPath, entry.name));
            }
          }
        } else {
          await this.onFileChange(this.config.watchPath);
        }
      } catch {
        // File not found or other error — onFileChange handles logging
        await this.onFileChange(this.config.watchPath);
      }

      // Set up file watcher — event handlers must be attached BEFORE
      // awaiting "ready" to avoid missing events during initialization.
      this.watcher = chokidar.watch(this.config.watchPath, {
        awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
        ignoreInitial: true, // we already processed the initial file(s)
      });

      this.watcher.on("add", (filePath: string) => {
        this.onFileChange(filePath);
      });

      this.watcher.on("change", (filePath: string) => {
        this.onFileChange(filePath);
      });

      // Wait for the watcher to complete its initial scan before resolving.
      // This ensures that any file writes after start() returns will be
      // detected as new events rather than being swallowed by ignoreInitial.
      await new Promise<void>((resolve) => {
        this.watcher!.on("ready", resolve);
      });
    } else if (options.once) {
      await this.onFileChange(this.config.watchPath);
    }
  }

  /**
   * Gracefully stop the runner, closing the file watcher if active
   * and persisting current state.
   */
  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
    }
    await this.store.save();
  }
}
