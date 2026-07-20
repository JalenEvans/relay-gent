import { computeIdentity, computeRecordHash } from "../domain/record/record-identity";
import type { Record } from "../domain/record/record.schema";
import type { StateStore } from "../state/store";

// ============================================================
// DeltaTracker — delta classification engine
// ============================================================
// Sits on top of StateStore and uses identity/hash functions from
// record-identity to classify records as NEW, CHANGED, or UNCHANGED.
//
// API:
//   filter(records)           → DeltaResult { newRecords, changedRecords, unchangedCount }
//   markDelivered(records)    → persists delivery state
// ============================================================

export interface DeltaResult {
  newRecords: Record[];
  changedRecords: Record[];
  unchangedCount: number;
}

export class DeltaTracker {
  constructor(private store: StateStore) {}

  /**
   * Classify each record as NEW, CHANGED, or UNCHANGED by comparing
   * against previously delivered state in StateStore.
   *
   * - NOT in store              → NEW
   * - In store, hash differs    → CHANGED
   * - In store, hash matches    → UNCHANGED
   *
   * Preserves input record object references and order within each
   * output array. Does NOT modify StateStore.
   */
  async filter(records: Record[]): Promise<DeltaResult> {
    const newRecords: Record[] = [];
    const changedRecords: Record[] = [];
    let unchangedCount = 0;

    for (const record of records) {
      const identity = computeIdentity(record);
      const stored = this.store.get(identity);

      if (!stored) {
        // Not previously delivered → NEW
        newRecords.push(record);
      } else {
        const hash = computeRecordHash(record);
        if (hash === stored.hash) {
          // Same identity, same hash → UNCHANGED
          unchangedCount++;
        } else {
          // Same identity, different hash → CHANGED
          changedRecords.push(record);
        }
      }
    }

    return { newRecords, changedRecords, unchangedCount };
  }

  /**
   * Persist delivery state for each record to StateStore.
   * Must call store.save() after setting all records.
   */
  async markDelivered(records: Record[]): Promise<void> {
    for (const record of records) {
      const identity = computeIdentity(record);
      const hash = computeRecordHash(record);
      this.store.set(identity, hash);
    }
    await this.store.save();
  }
}
