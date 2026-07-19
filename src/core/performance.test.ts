import { describe, expect, it } from "bun:test";
import { RecordSchema } from "./record";
import { computeIdentity, normalizeBody } from "./record-identity";

// ============================================================
// Performance Benchmarks
// ============================================================
// Ensures critical hot paths stay fast under high throughput.
// ============================================================

describe("Performance", () => {
  it("10,000 identity computations complete in <100ms", () => {
    const record = RecordSchema.parse({
      type: "revdiff",
      file: "src/main.ts",
      line: 42,
      annotationType: "+",
      comment: "Add new feature implementation",
    });

    const start = performance.now();
    for (let i = 0; i < 10_000; i++) {
      computeIdentity(record);
    }
    const elapsed = performance.now() - start;

    console.log(`  10,000 identity computations: ${elapsed.toFixed(2)}ms`);
    expect(elapsed).toBeLessThan(100);
  });

  it("10,000 record validations complete in <100ms", () => {
    const validRecord = {
      type: "revdiff",
      file: "src/main.ts",
      line: 42,
      annotationType: "+" as const,
      comment: "Add new feature implementation",
    };

    const start = performance.now();
    for (let i = 0; i < 10_000; i++) {
      RecordSchema.parse(validRecord);
    }
    const elapsed = performance.now() - start;

    console.log(`  10,000 record validations: ${elapsed.toFixed(2)}ms`);
    expect(elapsed).toBeLessThan(100);
  });

  it("10,000 body normalizations complete in <100ms", () => {
    const body = "This is a test body with some realistic content to hash.";

    const start = performance.now();
    for (let i = 0; i < 10_000; i++) {
      normalizeBody(body);
    }
    const elapsed = performance.now() - start;

    console.log(`  10,000 body normalizations: ${elapsed.toFixed(2)}ms`);
    expect(elapsed).toBeLessThan(100);
  });

  it("identity computation is stable under unicode-heavy input", () => {
    const record = RecordSchema.parse({
      type: "revdiff",
      file: "src/unicode.ts",
      line: 1,
      annotationType: "+",
      comment: "日本語テスト 🎉 émojis café résumé naïve über ñoño Здравствуй",
    });

    const start = performance.now();
    for (let i = 0; i < 10_000; i++) {
      computeIdentity(record);
    }
    const elapsed = performance.now() - start;

    console.log(`  10,000 unicode identity computations: ${elapsed.toFixed(2)}ms`);
    expect(elapsed).toBeLessThan(100);
  });
});
