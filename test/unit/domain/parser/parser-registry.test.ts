import { describe, expect, it } from "bun:test";
import type { Parser } from "../../../../src/domain/parser/parser.interface";

// ============================================================
// ParserRegistry — manages named parsers with register/get/list
// ============================================================
// API:
//   - getParser(name): Parser       — retrieve by name, throws if missing
//   - registerParser(parser): void  — add or overwrite a parser
//   - listParsers(): string[]       — all registered parser names
//
// Defaults:
//   - "json-lines" parser is pre-registered on creation
// ============================================================

// --- helpers ------------------------------------------------

function stubParser(name: string): Parser {
  return {
    name,
    parse: () => [],
  };
}

import { createParserRegistry } from "../../../../src/domain/parser/parser-registry";

describe("ParserRegistry", () => {
  // ------------------------------------------------------------------
  // 1. getParser
  // ------------------------------------------------------------------
  describe("getParser", () => {
    it("returns the pre-registered json-lines parser", () => {
      const registry = createParserRegistry();
      const parser = registry.getParser("json-lines");
      expect(parser).toBeDefined();
      expect(parser.name).toBe("json-lines");
      expect(typeof parser.parse).toBe("function");
    });

    it("throws an Error for an unknown parser name", () => {
      const registry = createParserRegistry();
      expect(() => registry.getParser("nonexistent")).toThrow(Error);
    });

    it("throws with a message that includes the missing name", () => {
      const registry = createParserRegistry();
      expect(() => registry.getParser("nonexistent")).toThrow("nonexistent");
    });
  });

  // ------------------------------------------------------------------
  // 2. registerParser
  // ------------------------------------------------------------------
  describe("registerParser", () => {
    it("registers a custom parser that getParser can retrieve", () => {
      const registry = createParserRegistry();
      const custom = stubParser("my-custom");
      registry.registerParser(custom);
      const retrieved = registry.getParser("my-custom");
      expect(retrieved).toBe(custom);
    });

    it("overwrites an existing parser with the same name (last-write-wins)", () => {
      const registry = createParserRegistry();
      const first = stubParser("replaceable");
      const second = stubParser("replaceable");
      registry.registerParser(first);
      registry.registerParser(second);
      expect(registry.getParser("replaceable")).toBe(second);
      expect(registry.getParser("replaceable")).not.toBe(first);
    });
  });

  // ------------------------------------------------------------------
  // 3. listParsers
  // ------------------------------------------------------------------
  describe("listParsers", () => {
    it("includes the default json-lines parser", () => {
      const registry = createParserRegistry();
      expect(registry.listParsers()).toContain("json-lines");
    });

    it("returns newly registered parser names", () => {
      const registry = createParserRegistry();
      registry.registerParser(stubParser("alpha"));
      registry.registerParser(stubParser("beta"));
      const names = registry.listParsers();
      expect(names).toContain("alpha");
      expect(names).toContain("beta");
    });

    it("does not duplicate names when overwriting", () => {
      const registry = createParserRegistry();
      registry.registerParser(stubParser("dupe"));
      registry.registerParser(stubParser("dupe"));
      const names = registry.listParsers();
      const count = names.filter((n) => n === "dupe").length;
      expect(count).toBe(1);
    });

    it("returns an array", () => {
      const registry = createParserRegistry();
      expect(Array.isArray(registry.listParsers())).toBe(true);
    });
  });

  // ------------------------------------------------------------------
  // 4. Default registry
  // ------------------------------------------------------------------
  describe("defaults", () => {
    it("ships with exactly one default parser before any registration", () => {
      const registry = createParserRegistry();
      const names = registry.listParsers();
      expect(names).toHaveLength(1);
      expect(names[0]).toBe("json-lines");
    });

    it("creates independent registries (no shared state)", () => {
      const a = createParserRegistry();
      const b = createParserRegistry();
      a.registerParser(stubParser("only-in-a"));
      expect(b.listParsers()).not.toContain("only-in-a");
    });
  });
});
