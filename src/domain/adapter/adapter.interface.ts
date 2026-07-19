import type { TargetConfig } from "../config/config.schema";
import type { Record } from "../record/record.schema";

// ============================================================
// Delivered ID — returned after successful delivery to confirm
// what was sent.
// ============================================================

type DeliveredId = string;

// ============================================================
// Adapter Interface — the contract every adapter must implement.
//
// An adapter takes a batch of Records and delivers them to an
// external system (e.g., opencode, claude, codex, or a raw
// command).
// ============================================================

interface Adapter {
  /** Unique name identifying this adapter (e.g., "opencode", "claude") */
  name: string;

  /**
   * Deliver a batch of records to the target system.
   * Returns an array of delivered IDs for tracking.
   */
  deliver(batch: Record[], ctx: TargetConfig): Promise<DeliveredId[]>;

  /**
   * Optional readiness check.
   * Returns true if the adapter is ready to accept deliveries.
   * Used to verify connections before starting the watch loop.
   */
  ready?(ctx: TargetConfig): Promise<boolean>;
}

export type { Adapter, DeliveredId };
