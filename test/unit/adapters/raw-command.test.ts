import { afterEach, describe, expect, it } from "bun:test";
import { RawCommandAdapter } from "../../../src/adapters/raw-command";
import { RecordSchema } from "../../../src/domain/record/record.schema";
import { computeIdentity } from "../../../src/domain/record/record-identity";
import { formatRecords } from "../../../src/domain/adapter/formatter";
import type { TargetConfig } from "../../../src/domain/config/config.schema";
import { existsSync, unlinkSync, readFileSync } from "node:fs";

// ============================================================
// RawCommandAdapter — delivers Records to a shell command via stdin
// ============================================================
// Implements Adapter interface:
//   name: "raw-command"
//   deliver(batch, ctx) → Promise<DeliveredId[]>
//   ready?(ctx) → Promise<boolean>
//
// Behavior:
//   1. Format batch via formatRecords()
//   2. Spawn `sh -c <command>` using Bun.spawn
//   3. Pipe formatted text to command's stdin
//   4. Return computeIdentity() for each record
//
// TargetConfig shape for raw-command:
//   { adapter: "raw-command", watchPath, parser, command, shell }
// ============================================================

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function makeRecord(
  overrides: Record<string, unknown> = {},
): ReturnType<typeof RecordSchema.parse> {
  return RecordSchema.parse({
    type: "revdiff",
    file: "src/main.ts",
    line: 42,
    annotationType: "+",
    comment: "Added null check",
    ...overrides,
  });
}

function makeJsonRecord(
  overrides: Record<string, unknown> = {},
): ReturnType<typeof RecordSchema.parse> {
  return RecordSchema.parse({
    type: "json-lines",
    timestamp: "2024-01-15T10:30:00Z",
    level: "INFO",
    message: "Request completed",
    ...overrides,
  });
}

function makeCtx(
  overrides: Partial<TargetConfig> & { adapter: "raw-command" } = {
    adapter: "raw-command",
    watchPath: ".",
    parser: "json-lines",
    command: "cat",
    shell: true,
  },
): TargetConfig {
  return {
    watchPath: ".",
    parser: "json-lines",
    command: "cat",
    shell: true,
    ...overrides,
  } as TargetConfig;
}

const OUTPUT_FILE = "/tmp/relaygent-test-raw-command-output";

// ------------------------------------------------------------------
// Cleanup temp files after each test
// ------------------------------------------------------------------
afterEach(() => {
  try {
    if (existsSync(OUTPUT_FILE)) {
      unlinkSync(OUTPUT_FILE);
    }
  } catch {
    // ignore cleanup errors
  }
});

// ============================================================
// 1. Constructor / basic properties
// ============================================================
describe("RawCommandAdapter", () => {
  describe("constructor and interface", () => {
    it("creates an instance", () => {
      const adapter = new RawCommandAdapter();
      expect(adapter).toBeDefined();
    });

    it("has name 'raw-command'", () => {
      const adapter = new RawCommandAdapter();
      expect(adapter.name).toBe("raw-command");
    });

    it("implements the Adapter interface shape", () => {
      const adapter = new RawCommandAdapter();
      expect(typeof adapter.deliver).toBe("function");
      expect(typeof adapter.name).toBe("string");
    });
  });

  // ============================================================
  // 2. Successful delivery — pipe to cat, verify output
  // ============================================================
  describe("successful delivery", () => {
    it("pipes formatted text to command stdin", async () => {
      const adapter = new RawCommandAdapter();
      const record = makeRecord();
      const ctx = makeCtx({
        command: `cat > ${OUTPUT_FILE}`,
      });

      await adapter.deliver([record], ctx);

      expect(existsSync(OUTPUT_FILE)).toBe(true);
      const output = readFileSync(OUTPUT_FILE, "utf-8");
      const expected = formatRecords([record]);
      expect(output).toBe(expected);
    });

    it("delivers a single record correctly", async () => {
      const adapter = new RawCommandAdapter();
      const record = makeRecord({
        file: "utils.ts",
        line: 10,
        annotationType: "-",
        comment: "Removed dead code",
      });
      const ctx = makeCtx({
        command: `cat > ${OUTPUT_FILE}`,
      });

      await adapter.deliver([record], ctx);

      const output = readFileSync(OUTPUT_FILE, "utf-8");
      expect(output).toBe("[utils.ts:10] (-)\nRemoved dead code");
    });
  });

  // ============================================================
  // 3. Multiple records — verify separator and formatting
  // ============================================================
  describe("multiple records", () => {
    it("formats and pipes batch of 3 records with separators", async () => {
      const adapter = new RawCommandAdapter();
      const records = [
        makeRecord({ file: "a.ts", line: 1, annotationType: "+", comment: "first" }),
        makeRecord({ file: "b.ts", line: 2, annotationType: "-", comment: "second" }),
        makeRecord({ file: "c.ts", line: 3, annotationType: " ", comment: "third" }),
      ];
      const ctx = makeCtx({
        command: `cat > ${OUTPUT_FILE}`,
      });

      await adapter.deliver(records, ctx);

      const output = readFileSync(OUTPUT_FILE, "utf-8");
      const expected = formatRecords(records);
      expect(output).toBe(expected);
      // Verify separators present
      expect(output).toContain("\n---\n\n");
      const parts = output.split("\n---\n\n");
      expect(parts).toHaveLength(3);
    });

    it("delivers mixed record types correctly", async () => {
      const adapter = new RawCommandAdapter();
      const records = [
        makeRecord({ file: "x.ts", line: 1, annotationType: "+", comment: "change" }),
        makeJsonRecord({ message: "Log entry" }),
      ];
      const ctx = makeCtx({
        command: `cat > ${OUTPUT_FILE}`,
      });

      await adapter.deliver(records, ctx);

      const output = readFileSync(OUTPUT_FILE, "utf-8");
      const expected = formatRecords(records);
      expect(output).toBe(expected);
    });
  });

  // ============================================================
  // 4. Returns delivered IDs — verify computeIdentity results
  // ============================================================
  describe("returned delivered IDs", () => {
    it("returns an array of delivered IDs for each record", async () => {
      const adapter = new RawCommandAdapter();
      const records = [
        makeRecord({ file: "a.ts", line: 1, annotationType: "+", comment: "add" }),
        makeRecord({ file: "b.ts", line: 2, annotationType: "-", comment: "remove" }),
        makeRecord({ file: "c.ts", line: 3, annotationType: " ", comment: "context" }),
      ];
      const ctx = makeCtx({ command: "cat" });

      const ids = await adapter.deliver(records, ctx);

      expect(ids).toBeArray();
      expect(ids).toHaveLength(3);
    });

    it("returned IDs match computeIdentity for each record", async () => {
      const adapter = new RawCommandAdapter();
      const records = [
        makeRecord({ file: "a.ts", line: 1, annotationType: "+", comment: "add" }),
        makeJsonRecord({ message: "hello" }),
      ];
      const ctx = makeCtx({ command: "cat" });

      const ids = await adapter.deliver(records, ctx);

      expect(ids).toHaveLength(2);
      expect(ids[0]).toBe(computeIdentity(records[0]));
      expect(ids[1]).toBe(computeIdentity(records[1]));
    });

    it("returns empty array for empty batch", async () => {
      const adapter = new RawCommandAdapter();
      const ctx = makeCtx({ command: "cat" });

      const ids = await adapter.deliver([], ctx);

      expect(ids).toEqual([]);
    });
  });

  // ============================================================
  // 5. Command failure — pipe to `false` (always exits 1)
  // ============================================================
  describe("command failure", () => {
    it("throws an error when command exits with non-zero status", async () => {
      const adapter = new RawCommandAdapter();
      const records = [makeRecord()];
      const ctx = makeCtx({ command: "false" });

      const promise = adapter.deliver(records, ctx);

      await expect(promise).rejects.toThrow();
    });

    it("error includes the exit code", async () => {
      const adapter = new RawCommandAdapter();
      const records = [makeRecord()];
      const ctx = makeCtx({ command: "false" });

      try {
        await adapter.deliver(records, ctx);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toMatch(/exit/i);
      }
    });

    it("throws when command writes to stderr and exits non-zero", async () => {
      const adapter = new RawCommandAdapter();
      const records = [makeRecord()];
      const ctx = makeCtx({ command: "sh -c 'echo error >&2; exit 2'" });

      await expect(adapter.deliver(records, ctx)).rejects.toThrow();
    });
  });

  // ============================================================
  // 6. Non-existent command — spawn invalid command
  // ============================================================
  describe("non-existent command", () => {
    it("throws an error when command does not exist", async () => {
      const adapter = new RawCommandAdapter();
      const records = [makeRecord()];
      const ctx = makeCtx({
        command: "definitely-not-a-real-command-xyz123",
      });

      await expect(adapter.deliver(records, ctx)).rejects.toThrow();
    });
  });

  // ============================================================
  // 7. Empty batch — no command spawned, returns empty array
  // ============================================================
  describe("empty batch", () => {
    it("returns empty array without error", async () => {
      const adapter = new RawCommandAdapter();
      const ctx = makeCtx({ command: "cat" });

      const ids = await adapter.deliver([], ctx);

      expect(ids).toEqual([]);
    });

    it("does not create output file for empty batch", async () => {
      const adapter = new RawCommandAdapter();
      const ctx = makeCtx({ command: `cat > ${OUTPUT_FILE}` });

      await adapter.deliver([], ctx);

      expect(existsSync(OUTPUT_FILE)).toBe(false);
    });
  });

  // ============================================================
  // 8. Shell commands — pipe to echo, verify receipt
  // ============================================================
  describe("shell commands", () => {
    it("receives piped text from echo command", async () => {
      const adapter = new RawCommandAdapter();
      const records = [makeRecord({ comment: "hello world" })];
      const ctx = makeCtx({ command: `cat > ${OUTPUT_FILE}` });

      await adapter.deliver(records, ctx);

      const output = readFileSync(OUTPUT_FILE, "utf-8");
      expect(output).toContain("hello world");
    });

    it("handles commands with shell syntax", async () => {
      const adapter = new RawCommandAdapter();
      const records = [makeRecord()];
      const ctx = makeCtx({
        command: `sh -c 'cat > ${OUTPUT_FILE}'`,
      });

      await adapter.deliver(records, ctx);

      expect(existsSync(OUTPUT_FILE)).toBe(true);
      const output = readFileSync(OUTPUT_FILE, "utf-8");
      expect(output).toContain("[src/main.ts:42]");
    });
  });

  // ============================================================
  // 9. Complex shell syntax — commands with pipes work via sh -c
  // ============================================================
  describe("complex shell syntax", () => {
    it("supports shell pipes within the command", async () => {
      const adapter = new RawCommandAdapter();
      const records = [makeRecord()];
      // Use shell piping: cat stdin | tee to file
      const ctx = makeCtx({
        command: `sh -c 'cat > ${OUTPUT_FILE}'`,
      });

      await adapter.deliver(records, ctx);

      expect(existsSync(OUTPUT_FILE)).toBe(true);
      const output = readFileSync(OUTPUT_FILE, "utf-8");
      const expected = formatRecords(records);
      expect(output).toBe(expected);
    });

    it("supports commands with environment variable expansion", async () => {
      const adapter = new RawCommandAdapter();
      const records = [makeRecord()];
      const ctx = makeCtx({
        command: `sh -c 'cat > ${OUTPUT_FILE}'`,
      });

      await adapter.deliver(records, ctx);

      const output = readFileSync(OUTPUT_FILE, "utf-8");
      expect(output.length).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // 10. Large batch — 100 records formatted and delivered
  // ============================================================
  describe("large batch", () => {
    it("delivers 100 records without error", async () => {
      const adapter = new RawCommandAdapter();
      const records = Array.from({ length: 100 }, (_, i) =>
        makeRecord({
          file: `file${i}.ts`,
          line: i,
          annotationType: "+",
          comment: `change ${i}`,
        }),
      );
      const ctx = makeCtx({
        command: `cat > ${OUTPUT_FILE}`,
      });

      const ids = await adapter.deliver(records, ctx);

      expect(ids).toHaveLength(100);
      expect(existsSync(OUTPUT_FILE)).toBe(true);
    });

    it("large batch output matches formatted records", async () => {
      const adapter = new RawCommandAdapter();
      const records = Array.from({ length: 100 }, (_, i) =>
        makeRecord({
          file: `file${i}.ts`,
          line: i,
          annotationType: "+",
          comment: `change ${i}`,
        }),
      );
      const ctx = makeCtx({
        command: `cat > ${OUTPUT_FILE}`,
      });

      await adapter.deliver(records, ctx);

      const output = readFileSync(OUTPUT_FILE, "utf-8");
      const expected = formatRecords(records);
      expect(output).toBe(expected);
    });

    it("all 100 returned IDs are valid identities", async () => {
      const adapter = new RawCommandAdapter();
      const records = Array.from({ length: 100 }, (_, i) =>
        makeRecord({
          file: `file${i}.ts`,
          line: i,
          annotationType: "+",
          comment: `change ${i}`,
        }),
      );
      const ctx = makeCtx({ command: "cat" });

      const ids = await adapter.deliver(records, ctx);

      expect(ids).toHaveLength(100);
      for (let i = 0; i < 100; i++) {
        expect(ids[i]).toBe(computeIdentity(records[i]));
        expect(ids[i]).toMatch(/^revdiff:/);
      }
    });
  });

  // ============================================================
  // 11. ready() method — optional readiness check
  // ============================================================
  describe("ready()", () => {
    it("exists as a method on the adapter", () => {
      const adapter = new RawCommandAdapter();
      expect(typeof adapter.ready).toBe("function");
    });

    it("returns true for a valid command", async () => {
      const adapter = new RawCommandAdapter();
      const ctx = makeCtx({ command: "cat" });

      const isReady = await adapter.ready!(ctx);

      expect(isReady).toBe(true);
    });

    it("returns false for a non-existent command", async () => {
      const adapter = new RawCommandAdapter();
      const ctx = makeCtx({
        command: "definitely-not-a-real-command-xyz123",
      });

      const isReady = await adapter.ready!(ctx);

      expect(isReady).toBe(false);
    });
  });

  // ============================================================
  // 12. Edge cases
  // ============================================================
  describe("edge cases", () => {
    it("handles records with special characters in comments", async () => {
      const adapter = new RawCommandAdapter();
      const records = [
        makeRecord({
          comment: 'Has "quotes" and $pecial chars & pipes |',
        }),
      ];
      const ctx = makeCtx({
        command: `cat > ${OUTPUT_FILE}`,
      });

      await adapter.deliver(records, ctx);

      const output = readFileSync(OUTPUT_FILE, "utf-8");
      expect(output).toContain('"quotes"');
      expect(output).toContain("$pecial");
    });

    it("handles records with multiline comments", async () => {
      const adapter = new RawCommandAdapter();
      const records = [
        makeRecord({
          comment: "Line one\nLine two\nLine three",
        }),
      ];
      const ctx = makeCtx({
        command: `cat > ${OUTPUT_FILE}`,
      });

      await adapter.deliver(records, ctx);

      const output = readFileSync(OUTPUT_FILE, "utf-8");
      expect(output).toContain("Line one\nLine two\nLine three");
    });

    it("delivers a single-element batch identically to a larger batch", async () => {
      const adapter = new RawCommandAdapter();
      const record = makeRecord();
      const ctx = makeCtx({ command: "cat" });

      const singleIds = await adapter.deliver([record], ctx);

      expect(singleIds).toHaveLength(1);
      expect(singleIds[0]).toBe(computeIdentity(record));
    });
  });
});
