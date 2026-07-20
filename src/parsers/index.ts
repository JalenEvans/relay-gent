import { createParserRegistry } from "../domain/parser/parser-registry";
import { createJsonLinesParser } from "./json-lines";

const registry = createParserRegistry();
registry.registerParser(createJsonLinesParser());

export { registry };
