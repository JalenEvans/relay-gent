import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// ============================================================
// RecordStore — persistence layer for arbitrary record storage
// ============================================================
// Stores records as JSON at:
//   <baseDir>/targets/<name>/state.json
//
// State shape:
//   { records: { [key]: <any> },
//     total_delivered: number }
// ============================================================

interface StateData {
  // biome-ignore lint/suspicious/noExplicitAny: generic record store
  records: Record<string, any>;
  total_delivered: number;
}

export class RecordStore {
  readonly statePath: string;
  readonly baseDir: string;
  readonly name: string;

  // biome-ignore lint/suspicious/noExplicitAny: generic record store
  private _records: Record<string, any> = {};
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
      if (data.records && typeof data.records === "object" && !Array.isArray(data.records)) {
        this._records = data.records;
      } else {
        this._records = {};
      }
      this._totalDelivered = data.total_delivered ?? 0;
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === "EACCES" || nodeErr.code === "EPERM") {
        throw new Error(`Cannot read state file at ${this.statePath}: permission denied`);
      }
      if (nodeErr.code === "ENOENT" || err instanceof SyntaxError) {
        this.clear();
        return;
      }
      throw err;
    }
  }

  /**
   * Persist state to disk using an atomic write pattern:
   * write to a unique temporary file, then rename to statePath.
   * Uses a unique temp-file name per call to prevent race conditions
   * when save() is invoked concurrently.
   * Creates the target directory if it doesn't exist.
   */
  async save(): Promise<void> {
    const dir = join(this.statePath, "..");
    await mkdir(dir, { recursive: true });

    const data: StateData = {
      records: this._records,
      total_delivered: this._totalDelivered,
    };

    // Use a unique temp file per invocation so concurrent save() calls
    // do not race on the same path (one rename would consume the temp
    // file, leaving the other with nothing to rename).
    const tmpPath = `${this.statePath}.${randomUUID()}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
    await rename(tmpPath, this.statePath);
  }

  /** Reset all in-memory state to defaults. */
  clear(): void {
    this._records = {};
    this._totalDelivered = 0;
  }

  /**
   * Retrieve a stored record by key.
   * Returns `undefined` if no record exists for that key.
   */
  // biome-ignore lint/suspicious/noExplicitAny: generic record store
  get(key: string): any | undefined {
    return this._records[key];
  }

  /**
   * Store a record for the given key.
   * Overwriting an existing key replaces the value.
   * Increments `total_delivered` ONLY when the key is new (not an
   * overwrite of an existing record).
   */
  // biome-ignore lint/suspicious/noExplicitAny: generic record store
  set(key: string, record: any): void {
    if (!(key in this._records)) {
      this._totalDelivered++;
    }

    this._records[key] = record;
  }

  /** Return a shallow copy of all stored records. */
  // biome-ignore lint/suspicious/noExplicitAny: generic record store
  getAllRecords(): Record<string, any> {
    return { ...this._records };
  }

  /** Total number of unique keys ever stored. */
  get totalDelivered(): number {
    return this._totalDelivered;
  }
}
