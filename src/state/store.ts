import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// ============================================================
// StateStore — persistence layer for delivered record tracking
// ============================================================
// Stores delivered records as JSON at:
//   <baseDir>/targets/<name>/state.json
//
// State shape:
//   { records: { [identity]: { delivered_at, hash } },
//     last_run: ISO timestamp | null,
//     total_delivered: number }
// ============================================================

interface StateRecord {
  delivered_at: string;
  hash: string;
}

interface StateData {
  records: Record<string, StateRecord>;
  last_run: string | null;
  total_delivered: number;
}

export class StateStore {
  readonly statePath: string;
  readonly baseDir: string;
  readonly name: string;

  private _records: Record<string, StateRecord> = {};
  private _lastRun: string | null = null;
  private _totalDelivered = 0;

  constructor(name: string, baseDir?: string) {
    this.name = name;
    this.baseDir = baseDir ?? join(homedir(), ".relay-gent");
    this.statePath = join(this.baseDir, "targets", name, "state.json");
  }

  /**
   * Load state from disk. If the file doesn't exist or the JSON is corrupt,
   * initialise with empty state.
   */
  async load(): Promise<void> {
    try {
      const raw = await readFile(this.statePath, "utf-8");
      const data = JSON.parse(raw) as StateData;
      this._records = data.records ?? {};
      this._lastRun = data.last_run ?? null;
      this._totalDelivered = data.total_delivered ?? 0;
    } catch {
      // File not found, corrupt JSON, or any other read error — start fresh
      this.clear();
    }
  }

  /**
   * Persist state to disk using an atomic write pattern:
   * write to statePath.tmp, then rename to statePath.
   * Updates last_run to the current ISO timestamp.
   * Creates the target directory if it doesn't exist.
   */
  async save(): Promise<void> {
    const dir = join(this.statePath, "..");
    await mkdir(dir, { recursive: true });

    const now = new Date().toISOString();
    this._lastRun = now;

    const data: StateData = {
      records: this._records,
      last_run: now,
      total_delivered: this._totalDelivered,
    };

    const tmpPath = `${this.statePath}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
    await rename(tmpPath, this.statePath);
  }

  /** Reset all in-memory state to defaults. */
  clear(): void {
    this._records = {};
    this._totalDelivered = 0;
    this._lastRun = null;
  }

  /**
   * Retrieve a stored record by identity string.
   * Returns `undefined` if no record exists for that identity.
   */
  get(identity: string): { delivered_at: string; hash: string } | undefined {
    return this._records[identity];
  }

  /**
   * Store a record for the given identity.
   * - Assigns the current ISO timestamp as `delivered_at`.
   * - Increments `total_delivered` ONLY when the identity is new (not an
   *   overwrite of an existing record).
   */
  set(identity: string, hash: string): void {
    const now = new Date().toISOString();

    if (!this._records[identity]) {
      this._totalDelivered++;
    }

    this._records[identity] = {
      delivered_at: now,
      hash,
    };
  }

  /** Return a shallow copy of all stored records. */
  getAllRecords(): Record<string, { delivered_at: string; hash: string }> {
    return { ...this._records };
  }

  /** Total number of unique identities ever stored. */
  get totalDelivered(): number {
    return this._totalDelivered;
  }

  /** ISO timestamp of the last `save()` call, or `null` if never saved. */
  get lastRun(): string | null {
    return this._lastRun;
  }
}
