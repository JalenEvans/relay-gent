import { describe, expect, it } from "bun:test";
import * as fc from "fast-check";
import { computeIdentity, normalizeBody } from "../../../../src/domain/record/record-identity";
import { RecordSchema } from "../../../../src/domain/record/record.schema";

// ============================================================
// Property-Based Tests — fast-check
// ============================================================
// Validates invariants that must hold for ALL possible inputs,
// not just hand-picked examples.
// ============================================================

describe("Property-Based Tests", () => {
  // ------------------------------------------------------------------
  // 1. Identity stability — same input → same identity
  // ------------------------------------------------------------------
  describe("identity stability", () => {
    it("revdiff: same record → same identity", () => {
      fc.assert(
        fc.property(
          fc.record({
            type: fc.constant("revdiff"),
            file: fc.string(),
            line: fc.nat(),
            annotationType: fc.constantFrom("+", "-", " ", "file-level"),
            comment: fc.string(),
          }),
          (record) => {
            const parsed = RecordSchema.parse(record);
            const id1 = computeIdentity(parsed);
            const id2 = computeIdentity(parsed);
            expect(id1).toBe(id2);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("json-lines: same record → same identity", () => {
      fc.assert(
        fc.property(
          fc.string(),
          fc.option(fc.string()),
          fc.option(fc.string()),
          (message, timestamp, level) => {
            const obj: Record<string, unknown> = { type: "json-lines", message };
            if (timestamp !== null) obj.timestamp = timestamp;
            if (level !== null) obj.level = level;
            const parsed = RecordSchema.parse(obj);
            const id1 = computeIdentity(parsed);
            const id2 = computeIdentity(parsed);
            expect(id1).toBe(id2);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("markdown-headers: same record → same identity", () => {
      fc.assert(
        fc.property(
          fc.record({
            type: fc.constant("markdown-headers"),
            header: fc.string(),
            level: fc.nat({ max: 6 }),
            body: fc.string(),
          }),
          (record) => {
            const parsed = RecordSchema.parse(record);
            const id1 = computeIdentity(parsed);
            const id2 = computeIdentity(parsed);
            expect(id1).toBe(id2);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("junit: same record → same identity", () => {
      fc.assert(
        fc.property(
          fc.string(),
          fc.option(fc.string()),
          fc.option(fc.float({ noNaN: true })),
          fc.option(fc.string()),
          fc.option(fc.string()),
          (name, classname, time, failure, error) => {
            const obj: Record<string, unknown> = { type: "junit", name };
            if (classname !== null) obj.classname = classname;
            if (time !== null) obj.time = time;
            if (failure !== null) obj.failure = failure;
            if (error !== null) obj.error = error;
            const parsed = RecordSchema.parse(obj);
            const id1 = computeIdentity(parsed);
            const id2 = computeIdentity(parsed);
            expect(id1).toBe(id2);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // ------------------------------------------------------------------
  // 2. Different bodies → different identities
  // ------------------------------------------------------------------
  describe("different bodies produce different identities", () => {
    it("revdiff: different comments → different identities", () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), (body1, body2) => {
          fc.pre(body1 !== body2);
          const record1 = RecordSchema.parse({
            type: "revdiff",
            file: "test.ts",
            line: 1,
            annotationType: "+",
            comment: body1,
          });
          const record2 = RecordSchema.parse({
            type: "revdiff",
            file: "test.ts",
            line: 1,
            annotationType: "+",
            comment: body2,
          });
          expect(computeIdentity(record1)).not.toBe(computeIdentity(record2));
        }),
        { numRuns: 100 },
      );
    });

    it("json-lines: different messages → different identities", () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), (msg1, msg2) => {
          fc.pre(msg1 !== msg2);
          const record1 = RecordSchema.parse({
            type: "json-lines",
            message: msg1,
          });
          const record2 = RecordSchema.parse({
            type: "json-lines",
            message: msg2,
          });
          expect(computeIdentity(record1)).not.toBe(computeIdentity(record2));
        }),
        { numRuns: 100 },
      );
    });

    it("markdown-headers: different bodies → different identities", () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), (body1, body2) => {
          fc.pre(body1 !== body2);
          const record1 = RecordSchema.parse({
            type: "markdown-headers",
            header: "Test",
            level: 1,
            body: body1,
          });
          const record2 = RecordSchema.parse({
            type: "markdown-headers",
            header: "Test",
            level: 1,
            body: body2,
          });
          expect(computeIdentity(record1)).not.toBe(computeIdentity(record2));
        }),
        { numRuns: 100 },
      );
    });
  });

  // ------------------------------------------------------------------
  // 3. Identity format invariant
  // ------------------------------------------------------------------
  describe("identity format", () => {
    it("always starts with the record type prefix", () => {
      const types = ["revdiff", "json-lines", "markdown-headers", "junit"] as const;

      for (const type of types) {
        fc.assert(
          fc.property(
            type === "revdiff"
              ? fc.record({
                  type: fc.constant("revdiff"),
                  file: fc.string({ minLength: 1 }),
                  line: fc.nat(),
                  annotationType: fc.constantFrom("+", "-", " ", "file-level"),
                  comment: fc.string(),
                })
              : type === "json-lines"
                ? fc.record({
                    type: fc.constant("json-lines"),
                    message: fc.string({ minLength: 1 }),
                  })
                : type === "markdown-headers"
                  ? fc.record({
                      type: fc.constant("markdown-headers"),
                      header: fc.string({ minLength: 1 }),
                      level: fc.nat({ max: 6 }),
                      body: fc.string({ minLength: 1 }),
                    })
                  : fc.record({
                      type: fc.constant("junit"),
                      name: fc.string({ minLength: 1 }),
                    }),
            (record) => {
              const identity = computeIdentity(RecordSchema.parse(record));
              expect(identity.startsWith(`${type}:`)).toBe(true);
            },
          ),
          { numRuns: 50 },
        );
      }
    });

    it("always ends with a 64-char hex hash", () => {
      fc.assert(
        fc.property(
          fc.record({
            type: fc.constant("revdiff"),
            file: fc.string(),
            line: fc.nat(),
            annotationType: fc.constantFrom("+", "-", " ", "file-level"),
            comment: fc.string(),
          }),
          (record) => {
            const identity = computeIdentity(RecordSchema.parse(record));
            const hash = identity.split(":").at(-1);
            expect(hash).toMatch(/^[0-9a-f]{64}$/);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // ------------------------------------------------------------------
  // 4. normalizeBody invariants
  // ------------------------------------------------------------------
  describe("normalizeBody invariants", () => {
    it("always returns a 64-char hex string", () => {
      fc.assert(
        fc.property(fc.string(), (input) => {
          const hash = normalizeBody(input);
          expect(hash).toMatch(/^[0-9a-f]{64}$/);
        }),
        { numRuns: 200 },
      );
    });

    it("is deterministic — same input → same output", () => {
      fc.assert(
        fc.property(fc.string(), (input) => {
          expect(normalizeBody(input)).toBe(normalizeBody(input));
        }),
        { numRuns: 200 },
      );
    });

    it("trimming is idempotent — trimmed body hashes same as double-trimmed", () => {
      fc.assert(
        fc.property(fc.string(), (input) => {
          const trimmed = input.trim();
          expect(normalizeBody(trimmed)).toBe(normalizeBody(input));
        }),
        { numRuns: 200 },
      );
    });
  });
});
