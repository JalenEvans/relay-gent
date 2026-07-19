import type { Parser } from "./parser.interface";

// ============================================================
// Parser Registry — manages named parsers with register/get/list
// ============================================================
// Ships with a "json-lines" stub parser pre-registered.
// Real implementation of json-lines parsing comes in Chunk 2.
// ============================================================

const jsonLinesStub: Parser = {
  name: "json-lines",
  parse: () => [],
};

type ParserRegistry = {
  getParser(name: string): Parser;
  registerParser(parser: Parser): void;
  listParsers(): string[];
};

function createParserRegistry(): ParserRegistry {
  const parsers = new Map<string, Parser>();

  // Pre-register the default json-lines stub
  parsers.set(jsonLinesStub.name, jsonLinesStub);

  return {
    getParser(name: string): Parser {
      const parser = parsers.get(name);
      if (!parser) {
        throw new Error(`Unknown parser: ${name}`);
      }
      return parser;
    },

    registerParser(parser: Parser): void {
      parsers.set(parser.name, parser);
    },

    listParsers(): string[] {
      return Array.from(parsers.keys());
    },
  };
}

export { createParserRegistry };
