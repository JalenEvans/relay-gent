import type { Record } from "../record/record.schema";

/**
 * IdentityComputeError — raised when identity computation fails.
 *
 * Should never happen with valid records; indicates a bug in the
 * getRecordKey/getRecordBody logic.
 */
class IdentityComputeError extends Error {
  constructor(
    public readonly record: Record,
    public readonly reason: string,
  ) {
    super(`Failed to compute identity: ${reason}`);
    this.name = "IdentityComputeError";
  }
}

export { IdentityComputeError };
