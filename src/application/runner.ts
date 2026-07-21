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
   * (Stub for GREEN phase — full wiring in later chunks.)
   */
  async onFileChange(_filePath: string): Promise<void> {
    // no-op until the pipeline is wired
  }

  /**
   * Gracefully stop the runner, persisting current state.
   */
  async stop(): Promise<void> {
    await this.store.save();
  }
}
