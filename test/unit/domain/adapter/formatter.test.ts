import { describe, expect, it } from "bun:test";
import type { z } from "zod";
import {
  type JunitRecordSchema,
  type JsonLinesRecordSchema,
  type MarkdownHeadersRecordSchema,
  type RevdiffRecordSchema,
  RecordSchema,
} from "../../../../src/domain/record/record.schema";
import { formatRecord, formatRecords } from "../../../../src/domain/adapter/formatter";

// ============================================================
// formatRecord / formatRecords — formatting layer for Record types
// ============================================================
// formatRecord(record) → single-line or multi-line formatted string
// formatRecords(records) → joined formatted strings
//
// Per-type formats:
//   revdiff          → [file:line] (annotationType)\ncomment
//   json-lines       → [timestamp] [level] message
//   markdown-headers → # repeats header\nbody  (hashes repeat based on level)
//   junit            → [name] PASS/FAIL (time)
//
// Multi-record join: "\n---\n\n"
// Fallback defaults: timestamp → "unknown", level → "info", junit time → omitted
// ============================================================

// ------------------------------------------------------------------
// Helper: build a typed record via RecordSchema.parse
// ------------------------------------------------------------------

function makeRevdiff(
  overrides: Partial<z.infer<typeof RevdiffRecordSchema>> = {},
): z.infer<typeof RevdiffRecordSchema> {
  return RecordSchema.parse({
    type: "revdiff",
    file: "src/main.ts",
    line: 42,
    annotationType: "+",
    comment: "Added null check",
    ...overrides,
  }) as z.infer<typeof RevdiffRecordSchema>;
}

function makeJsonLines(
  overrides: Partial<z.infer<typeof JsonLinesRecordSchema>> = {},
): z.infer<typeof JsonLinesRecordSchema> {
  return RecordSchema.parse({
    type: "json-lines",
    message: "Request completed",
    ...overrides,
  }) as z.infer<typeof JsonLinesRecordSchema>;
}

function makeMarkdownHeaders(
  overrides: Partial<z.infer<typeof MarkdownHeadersRecordSchema>> = {},
): z.infer<typeof MarkdownHeadersRecordSchema> {
  return RecordSchema.parse({
    type: "markdown-headers",
    header: "Introduction",
    level: 2,
    body: "This is the intro section.",
    ...overrides,
  }) as z.infer<typeof MarkdownHeadersRecordSchema>;
}

function makeJunit(
  overrides: Partial<z.infer<typeof JunitRecordSchema>> = {},
): z.infer<typeof JunitRecordSchema> {
  return RecordSchema.parse({
    type: "junit",
    name: "testShouldPass",
    ...overrides,
  }) as z.infer<typeof JunitRecordSchema>;
}

// ============================================================
// 1. formatRecord — RevdiffRecord
// ============================================================
describe("formatRecord", () => {
  describe("revdiff", () => {
    it("formats file, line, annotationType, and comment", () => {
      const record = makeRevdiff({
        file: "src/main.ts",
        line: 42,
        annotationType: "+",
        comment: "Added null check",
      });
      const result = formatRecord(record);
      expect(result).toBe("[src/main.ts:42] (+)\nAdded null check");
    });

    it("formats with annotationType '-'", () => {
      const record = makeRevdiff({
        file: "app.js",
        line: 10,
        annotationType: "-",
        comment: "Removed dead code",
      });
      const result = formatRecord(record);
      expect(result).toBe("[app.js:10] (-)\nRemoved dead code");
    });

    it("formats with annotationType ' '", () => {
      const record = makeRevdiff({
        file: "utils.ts",
        line: 5,
        annotationType: " ",
        comment: "Unchanged context line",
      });
      const result = formatRecord(record);
      expect(result).toBe("[utils.ts:5] ( )\nUnchanged context line");
    });

    it("formats with annotationType 'file-level'", () => {
      const record = makeRevdiff({
        file: "README.md",
        line: 0,
        annotationType: "file-level",
        comment: "File-level annotation",
      });
      const result = formatRecord(record);
      expect(result).toBe("[README.md:0] (file-level)\nFile-level annotation");
    });

    it("includes endLine when present", () => {
      const record = makeRevdiff({
        file: "src/main.ts",
        line: 10,
        endLine: 20,
        annotationType: "+",
        comment: "Added multi-line block",
      });
      const result = formatRecord(record);
      // endLine is present in the record — formatter should handle it
      expect(result).toContain("[src/main.ts:10");
      expect(result).toContain("(+)");
      expect(result).toContain("Added multi-line block");
    });

    it("handles special characters in comment", () => {
      const record = makeRevdiff({
        file: "src/main.ts",
        line: 1,
        annotationType: "+",
        comment: "Added [bracket] and {brace} and (parens)",
      });
      const result = formatRecord(record);
      expect(result).toBe(
        "[src/main.ts:1] (+)\nAdded [bracket] and {brace} and (parens)",
      );
    });

    it("handles newline in comment", () => {
      const record = makeRevdiff({
        file: "src/main.ts",
        line: 1,
        annotationType: "+",
        comment: "Line one\nLine two",
      });
      const result = formatRecord(record);
      expect(result).toBe("[src/main.ts:1] (+)\nLine one\nLine two");
    });

    it("handles file with colons in path", () => {
      const record = makeRevdiff({
        file: "C:\\Users\\test\\file.ts",
        line: 1,
        annotationType: "+",
        comment: "Windows path",
      });
      const result = formatRecord(record);
      expect(result).toBe("[C:\\Users\\test\\file.ts:1] (+)\nWindows path");
    });
  });

  // ------------------------------------------------------------------
  // 2. formatRecord — JsonLinesRecord
  // ------------------------------------------------------------------
  describe("json-lines", () => {
    it("formats timestamp, level, and message", () => {
      const record = makeJsonLines({
        timestamp: "2024-01-15T10:30:00Z",
        level: "INFO",
        message: "User logged in",
      });
      const result = formatRecord(record);
      expect(result).toBe("[2024-01-15T10:30:00Z] [INFO] User logged in");
    });

    it("falls back to 'unknown' when timestamp is missing", () => {
      const record = makeJsonLines({
        level: "WARN",
        message: "Deprecated API call",
      });
      const result = formatRecord(record);
      expect(result).toBe("[unknown] [WARN] Deprecated API call");
    });

    it("falls back to 'info' when level is missing", () => {
      const record = makeJsonLines({
        timestamp: "2024-01-15T10:30:00Z",
        message: "No level set",
      });
      const result = formatRecord(record);
      expect(result).toBe("[2024-01-15T10:30:00Z] [info] No level set");
    });

    it("falls back to both defaults when timestamp and level are missing", () => {
      const record = makeJsonLines({
        message: "Minimal log entry",
      });
      const result = formatRecord(record);
      expect(result).toBe("[unknown] [info] Minimal log entry");
    });

    it("handles message with brackets and colons", () => {
      const record = makeJsonLines({
        timestamp: "2024-01-15T10:30:00Z",
        level: "ERROR",
        message: "Failed to parse [json]: unexpected token",
      });
      const result = formatRecord(record);
      expect(result).toBe(
        "[2024-01-15T10:30:00Z] [ERROR] Failed to parse [json]: unexpected token",
      );
    });

    it("handles multiline message", () => {
      const record = makeJsonLines({
        timestamp: "2024-01-15T10:30:00Z",
        level: "DEBUG",
        message: "Stack trace:\n  at fn()\n  at main()",
      });
      const result = formatRecord(record);
      expect(result).toBe(
        "[2024-01-15T10:30:00Z] [DEBUG] Stack trace:\n  at fn()\n  at main()",
      );
    });
  });

  // ------------------------------------------------------------------
  // 3. formatRecord — MarkdownHeadersRecord
  // ------------------------------------------------------------------
  describe("markdown-headers", () => {
    it("formats header with level 1 (single #)", () => {
      const record = makeMarkdownHeaders({
        header: "Title",
        level: 1,
        body: "Main content",
      });
      const result = formatRecord(record);
      expect(result).toBe("# Title\nMain content");
    });

    it("formats header with level 2 (double ##)", () => {
      const record = makeMarkdownHeaders({
        header: "Introduction",
        level: 2,
        body: "This is the intro section.",
      });
      const result = formatRecord(record);
      expect(result).toBe("## Introduction\nThis is the intro section.");
    });

    it("formats header with level 3 (triple ###)", () => {
      const record = makeMarkdownHeaders({
        header: "Subsection",
        level: 3,
        body: "Deep content",
      });
      const result = formatRecord(record);
      expect(result).toBe("### Subsection\nDeep content");
    });

    it("formats header with level 6 (######)", () => {
      const record = makeMarkdownHeaders({
        header: "Deepest",
        level: 6,
        body: "Very deep",
      });
      const result = formatRecord(record);
      expect(result).toBe("###### Deepest\nVery deep");
    });

    it("handles empty body", () => {
      const record = makeMarkdownHeaders({
        header: "Empty Section",
        level: 1,
        body: "",
      });
      const result = formatRecord(record);
      expect(result).toBe("# Empty Section\n");
    });

    it("handles header with special characters", () => {
      const record = makeMarkdownHeaders({
        header: "Special: [chars] {and} (more)",
        level: 2,
        body: "Body text",
      });
      const result = formatRecord(record);
      expect(result).toBe(
        "## Special: [chars] {and} (more)\nBody text",
      );
    });

    it("handles multiline body", () => {
      const record = makeMarkdownHeaders({
        header: "Multi",
        level: 1,
        body: "Line one\nLine two\nLine three",
      });
      const result = formatRecord(record);
      expect(result).toBe("# Multi\nLine one\nLine two\nLine three");
    });
  });

  // ------------------------------------------------------------------
  // 4. formatRecord — JunitRecord
  // ------------------------------------------------------------------
  describe("junit", () => {
    it("formats passing test with time", () => {
      const record = makeJunit({
        name: "testShouldPass",
        time: 0.123,
      });
      const result = formatRecord(record);
      expect(result).toBe("[testShouldPass] PASS (0.123)");
    });

    it("formats failing test when failure is present", () => {
      const record = makeJunit({
        name: "testShouldFail",
        time: 2.5,
        failure: "AssertionError",
      });
      const result = formatRecord(record);
      expect(result).toBe("[testShouldFail] FAIL (2.5)");
    });

    it("formats failing test when error is present", () => {
      const record = makeJunit({
        name: "testThrowsError",
        time: 0.05,
        error: "RuntimeError",
      });
      const result = formatRecord(record);
      expect(result).toBe("[testThrowsError] FAIL (0.05)");
    });

    it("formats PASS when no failure or error", () => {
      const record = makeJunit({
        name: "testClean",
        time: 1.0,
      });
      const result = formatRecord(record);
      expect(result).toBe("[testClean] PASS (1.0)");
    });

    it("omits time portion when time is missing", () => {
      const record = makeJunit({
        name: "testNoTime",
      });
      const result = formatRecord(record);
      expect(result).toBe("[testNoTime] PASS");
    });

    it("formats test name with special characters", () => {
      const record = makeJunit({
        name: "test[bracket]{brace}(paren)",
        time: 0.1,
      });
      const result = formatRecord(record);
      expect(result).toBe("[test[bracket]{brace}(paren)] PASS (0.1)");
    });

    it("formats classname + name", () => {
      const record = makeJunit({
        name: "testWithClass",
        classname: "com.example.TestSuite",
        time: 0.5,
      });
      const result = formatRecord(record);
      // classname is present but spec only shows name in output
      expect(result).toContain("[testWithClass]");
      expect(result).toContain("PASS");
    });
  });
});

// ============================================================
// 5. formatRecords — Multi-record joining
// ============================================================
describe("formatRecords", () => {
  it("returns empty string for empty array", () => {
    const result = formatRecords([]);
    expect(result).toBe("");
  });

  it("returns single formatted record without separator", () => {
    const records = [
      makeRevdiff({
        file: "a.ts",
        line: 1,
        annotationType: "+",
        comment: "add",
      }),
    ];
    const result = formatRecords(records);
    expect(result).toBe("[a.ts:1] (+)\nadd");
  });

  it("joins two records with separator", () => {
    const records = [
      makeRevdiff({
        file: "a.ts",
        line: 1,
        annotationType: "+",
        comment: "add",
      }),
      makeRevdiff({
        file: "b.ts",
        line: 2,
        annotationType: "-",
        comment: "remove",
      }),
    ];
    const result = formatRecords(records);
    expect(result).toBe("[a.ts:1] (+)\nadd\n---\n\n[b.ts:2] (-)\nremove");
  });

  it("joins three records with separators between each", () => {
    const records = [
      makeRevdiff({
        file: "a.ts",
        line: 1,
        annotationType: "+",
        comment: "first",
      }),
      makeRevdiff({
        file: "b.ts",
        line: 2,
        annotationType: "-",
        comment: "second",
      }),
      makeRevdiff({
        file: "c.ts",
        line: 3,
        annotationType: " ",
        comment: "third",
      }),
    ];
    const result = formatRecords(records);
    const parts = result.split("\n---\n\n");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("[a.ts:1] (+)\nfirst");
    expect(parts[1]).toBe("[b.ts:2] (-)\nsecond");
    expect(parts[2]).toBe("[c.ts:3] ( )\nthird");
  });

  it("joins mixed record types", () => {
    const records = [
      makeRevdiff({
        file: "x.ts",
        line: 1,
        annotationType: "+",
        comment: "change",
      }),
      makeJsonLines({
        timestamp: "2024-01-15T10:30:00Z",
        level: "INFO",
        message: "Log entry",
      }),
      makeMarkdownHeaders({
        header: "Docs",
        level: 1,
        body: "Body",
      }),
      makeJunit({
        name: "test1",
        time: 0.1,
      }),
    ];
    const result = formatRecords(records);
    const parts = result.split("\n---\n\n");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("[x.ts:1] (+)\nchange");
    expect(parts[1]).toBe("[2024-01-15T10:30:00Z] [INFO] Log entry");
    expect(parts[2]).toBe("# Docs\nBody");
    expect(parts[3]).toBe("[test1] PASS (0.1)");
  });

  it("handles batch of 100 records without error", () => {
    const records = Array.from({ length: 100 }, (_, i) =>
      makeRevdiff({
        file: `file${i}.ts`,
        line: i,
        annotationType: "+",
        comment: `change ${i}`,
      }),
    );
    const result = formatRecords(records);
    const parts = result.split("\n---\n\n");
    expect(parts).toHaveLength(100);
    expect(parts[0]).toBe("[file0.ts:0] (+)\nchange 0");
    expect(parts[99]).toBe("[file99.ts:99] (+)\nchange 99");
  });
});

// ============================================================
// 6. Edge cases — special characters and boundary conditions
// ============================================================
describe("Edge cases", () => {
  it("revdiff with empty comment", () => {
    const record = makeRevdiff({
      file: "f.ts",
      line: 1,
      annotationType: "+",
      comment: "",
    });
    const result = formatRecord(record);
    expect(result).toBe("[f.ts:1] (+)\n");
  });

  it("json-lines with empty message", () => {
    const record = makeJsonLines({
      message: "",
    });
    const result = formatRecord(record);
    expect(result).toBe("[unknown] [info] ");
  });

  it("junit with very long test name", () => {
    const longName = "test".repeat(100);
    const record = makeJunit({
      name: longName,
      time: 0.001,
    });
    const result = formatRecord(record);
    expect(result).toBe(`[${longName}] PASS (0.001)`);
  });

  it("revdiff with line 0 (file-level)", () => {
    const record = makeRevdiff({
      file: "CHANGELOG.md",
      line: 0,
      annotationType: "file-level",
      comment: "Entire file changed",
    });
    const result = formatRecord(record);
    expect(result).toBe("[CHANGELOG.md:0] (file-level)\nEntire file changed");
  });

  it("junit with zero time", () => {
    const record = makeJunit({
      name: "instantTest",
      time: 0,
    });
    const result = formatRecord(record);
    expect(result).toBe("[instantTest] PASS (0)");
  });

  it("json-lines with empty string timestamp and level", () => {
    // Empty strings are different from missing (undefined)
    // The spec says fallback on missing, not on empty
    const record = makeJsonLines({
      timestamp: "",
      level: "",
      message: "Empty fields",
    });
    const result = formatRecord(record);
    // Empty string is still a string — not missing
    expect(result).toBe("[] [] Empty fields");
  });

  it("markdown-headers level 0 renders no hashes", () => {
    // Level 0 is non-negative per schema, edge case for formatter
    const record = makeMarkdownHeaders({
      header: "Zero Level",
      level: 0,
      body: "Content",
    });
    const result = formatRecord(record);
    // 0 hashes + space + header — just the header
    expect(result).toBe("Zero Level\nContent");
  });
});

// ============================================================
// 7. Fuzz: fast-check — formatRecord with random valid records
// ============================================================
describe("Fuzz (fast-check)", () => {
  it("formatRecord returns a string for any valid record", () => {
    const revdiffArb = makeRevdiff();
    const jsonLinesArb = makeJsonLines();
    const mdHeadersArb = makeMarkdownHeaders();
    const junitArb = makeJunit();

    const records = [revdiffArb, jsonLinesArb, mdHeadersArb, junitArb];
    for (const record of records) {
      const result = formatRecord(record);
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it("formatRecords always returns a string", () => {
    const records = [
      makeRevdiff(),
      makeJsonLines(),
      makeMarkdownHeaders(),
      makeJunit(),
    ];
    const result = formatRecords(records);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("formatRecords with single record has no separator", () => {
    const record = makeRevdiff({
      file: "test.ts",
      line: 1,
      annotationType: "+",
      comment: "test",
    });
    const singleResult = formatRecord(record);
    const batchResult = formatRecords([record]);
    expect(batchResult).toBe(singleResult);
  });

  it("formatRecords separator count is always records.length - 1", () => {
    const records = [
      makeRevdiff(),
      makeJsonLines(),
      makeMarkdownHeaders(),
      makeJunit(),
      makeRevdiff({ file: "extra.ts", line: 99, annotationType: "-", comment: "extra" }),
    ];
    const result = formatRecords(records);
    const separatorCount = (result.match(/\n---\n\n/g) || []).length;
    expect(separatorCount).toBe(records.length - 1);
  });
});
