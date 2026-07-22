import { createParserRegistry } from "../domain/parser/parser-registry";
import type { Parser } from "../domain/parser/parser.interface";
import { createJsonLinesParser } from "./json-lines";

const registry = createParserRegistry();
registry.registerParser(createJsonLinesParser());

// Register a minimal typescript parser stub (real impl TBD)
registry.registerParser({ name: "typescript", parse: () => [] } as Parser);

export { registry };
