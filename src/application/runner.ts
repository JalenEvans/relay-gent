import { readFile } from "node:fs/promises";
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
   * Gracefully stop the runner, persisting current state.
   */
  async stop(): Promise<void> {
    await this.store.save();
  }
}
