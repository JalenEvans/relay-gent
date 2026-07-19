import { describe, expect, it } from "bun:test";
import { RecordSchema } from "./record";
import { computeIdentity, getRecordBody, getRecordKey, normalizeBody } from "./record-identity";

// ============================================================
// Record Identity — stable identity string: `<type>:<key>:<hash>`
// ============================================================
// Functions:
//   - getRecordKey(record)    → parser-specific key
//   - getRecordBody(record)   → text body to hash
//   - normalizeBody(body)     → NFC → CRLF→LF → trim → strip trailing \n → SHA-256
//   - computeIdentity(record) → `<type>:<key>:<hash>`
// ============================================================

// ------------------------------------------------------------------
// Fixture records
// ------------------------------------------------------------------

const revdiffRecord = RecordSchema.parse({
  type: "revdiff",
  file: "src/main.ts",
  line: 42,
  annotationType: "+",
  comment: "Added missing null check",
});

const jsonLinesRecord = RecordSchema.parse({
  type: "json-lines",
  timestamp: "2024-01-15T10:30:00Z",
  level: "INFO",
  message: "Request completed successfully",
});

const markdownHeadersRecord = RecordSchema.parse({
  type: "markdown-headers",
  header: "Installation",
  level: 2,
  body: "Run `npm install` to get started.",
});

const junitRecord = RecordSchema.parse({
  type: "junit",
  name: "testShouldPass",
  classname: "com.example.TestSuite",
  failure: "AssertionError: expected true to be false",
});

// ------------------------------------------------------------------
// 1. getRecordKey
// ------------------------------------------------------------------

describe("getRecordKey", () => {
  it("computes revdiff key as file:line:annotationType", () => {
    const key = getRecordKey(revdiffRecord);
    expect(key).toBe("src/main.ts:42:+");
  });

  it("computes revdiff key with file-level annotationType", () => {
    const record = RecordSchema.parse({
      type: "revdiff",
      file: "README.md",
      line: 0,
      annotationType: "file-level",
      comment: "File-level note",
    });
    expect(getRecordKey(record)).toBe("README.md:0:file-level");
  });

  it("computes json-lines key as timestamp:level", () => {
    const key = getRecordKey(jsonLinesRecord);
    expect(key).toBe("2024-01-15T10:30:00Z:INFO");
  });

  it("computes markdown-headers key as header", () => {
    const key = getRecordKey(markdownHeadersRecord);
    expect(key).toBe("Installation");
  });

  it("computes junit key as name:classname", () => {
    const key = getRecordKey(junitRecord);
    expect(key).toBe("testShouldPass:com.example.TestSuite");
  });

  it("handles optional fields — json-lines without timestamp or level", () => {
    const record = RecordSchema.parse({
      type: "json-lines",
      message: "bare message",
    });
    const key = getRecordKey(record);
    // Optional fields default to empty string in key
    expect(key).toBe(":");
  });

  it("handles optional fields — junit without classname", () => {
    const record = RecordSchema.parse({
      type: "junit",
      name: "standaloneTest",
    });
    const key = getRecordKey(record);
    // classname is optional, defaults to empty string
    expect(key).toBe("standaloneTest:");
  });
});

// ------------------------------------------------------------------
// 2. getRecordBody
// ------------------------------------------------------------------

describe("getRecordBody", () => {
  it("extracts comment from revdiff", () => {
    expect(getRecordBody(revdiffRecord)).toBe("Added missing null check");
  });

  it("extracts message from json-lines", () => {
    expect(getRecordBody(jsonLinesRecord)).toBe("Request completed successfully");
  });

  it("extracts body from markdown-headers", () => {
    expect(getRecordBody(markdownHeadersRecord)).toBe("Run `npm install` to get started.");
  });

  it("extracts failure from junit", () => {
    expect(getRecordBody(junitRecord)).toBe("AssertionError: expected true to be false");
  });

  it("falls back to error when failure is missing in junit", () => {
    const record = RecordSchema.parse({
      type: "junit",
      name: "errorOnlyTest",
      error: "NullPointerException",
    });
    expect(getRecordBody(record)).toBe("NullPointerException");
  });

  it("returns empty string when both failure and error are missing in junit", () => {
    const record = RecordSchema.parse({
      type: "junit",
      name: "passingTest",
    });
    expect(getRecordBody(record)).toBe("");
  });
});

// ------------------------------------------------------------------
// 3. normalizeBody
// ------------------------------------------------------------------

describe("normalizeBody", () => {
  it("produces consistent hash for same input", () => {
    const body = "Hello, world!";
    const hash1 = normalizeBody(body);
    const hash2 = normalizeBody(body);
    expect(hash1).toBe(hash2);
  });

  it("trims leading and trailing whitespace", () => {
    const hashPlain = normalizeBody("hello");
    const hashPadded = normalizeBody("  hello  ");
    expect(hashPlain).toBe(hashPadded);
  });

  it("trims leading and trailing tabs and newlines", () => {
    const hashPlain = normalizeBody("hello");
    const hashNewlines = normalizeBody("\n\thello\n\t");
    expect(hashPlain).toBe(hashNewlines);
  });

  it("removes single trailing newline", () => {
    const hashPlain = normalizeBody("hello");
    const hashTrailing = normalizeBody("hello\n");
    expect(hashPlain).toBe(hashTrailing);
  });

  it("normalizes CRLF to LF", () => {
    const hashLF = normalizeBody("line1\nline2\nline3");
    const hashCRLF = normalizeBody("line1\r\nline2\r\nline3");
    expect(hashLF).toBe(hashCRLF);
  });

  it("normalizes Unicode NFC vs NFD", () => {
    // "café" — NFD separates the accent from 'e'
    const nfc = "caf\u00e9"; // NFC: é as single codepoint U+00E9
    const nfd = "cafe\u0301"; // NFD: e + combining acute accent U+0301
    const hashNFC = normalizeBody(nfc);
    const hashNFD = normalizeBody(nfd);
    expect(hashNFC).toBe(hashNFD);
  });

  it("produces a 64-character hex string (SHA-256)", () => {
    const hash = normalizeBody("test input");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("different inputs produce different hashes", () => {
    const hash1 = normalizeBody("alpha");
    const hash2 = normalizeBody("bravo");
    expect(hash1).not.toBe(hash2);
  });
});

// ------------------------------------------------------------------
// 4. computeIdentity
// ------------------------------------------------------------------

describe("computeIdentity", () => {
  it("returns format type:key:hash", () => {
    const identity = computeIdentity(revdiffRecord);
    const parts = identity.split(":");
    // type:key:hash → at minimum 3 colon-separated segments
    // but key itself may contain colons, so check first and last
    expect(identity.startsWith("revdiff:")).toBe(true);
    expect(identity.split(":").length).toBeGreaterThanOrEqual(3);
    // Hash is last 64-char segment
    const hash = identity.split(":").at(-1);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces stable identity for same record", () => {
    const id1 = computeIdentity(revdiffRecord);
    const id2 = computeIdentity(revdiffRecord);
    expect(id1).toBe(id2);
  });

  it("produces different identities for different records", () => {
    const id1 = computeIdentity(revdiffRecord);
    const id2 = computeIdentity(jsonLinesRecord);
    expect(id1).not.toBe(id2);
  });

  it("works for revdiff records", () => {
    const identity = computeIdentity(revdiffRecord);
    expect(identity).toMatch(/^revdiff:/);
    expect(identity).toContain("src/main.ts:42:+");
  });

  it("works for json-lines records", () => {
    const identity = computeIdentity(jsonLinesRecord);
    expect(identity).toMatch(/^json-lines:/);
    expect(identity).toContain("2024-01-15T10:30:00Z:INFO");
  });

  it("works for markdown-headers records", () => {
    const identity = computeIdentity(markdownHeadersRecord);
    expect(identity).toMatch(/^markdown-headers:/);
    expect(identity).toContain("Installation");
  });

  it("works for junit records", () => {
    const identity = computeIdentity(junitRecord);
    expect(identity).toMatch(/^junit:/);
    expect(identity).toContain("testShouldPass:com.example.TestSuite");
  });

  it("normalizes whitespace in body before hashing", () => {
    const clean = RecordSchema.parse({
      type: "revdiff",
      file: "f.ts",
      line: 1,
      annotationType: "+",
      comment: "clean comment",
    });
    const padded = RecordSchema.parse({
      type: "revdiff",
      file: "f.ts",
      line: 1,
      annotationType: "+",
      comment: "  clean comment  ",
    });
    // Same key, same normalized body → same identity
    expect(computeIdentity(clean)).toBe(computeIdentity(padded));
  });

  it("normalizes CRLF in body before hashing", () => {
    const lf = RecordSchema.parse({
      type: "markdown-headers",
      header: "Test",
      level: 1,
      body: "line1\nline2",
    });
    const crlf = RecordSchema.parse({
      type: "markdown-headers",
      header: "Test",
      level: 1,
      body: "line1\r\nline2",
    });
    expect(computeIdentity(lf)).toBe(computeIdentity(crlf));
  });
});
