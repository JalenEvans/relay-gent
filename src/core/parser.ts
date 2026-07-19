import type { Record } from "./record";

// ============================================================
// Parser Interface — the contract every parser must implement.
//
// A parser takes raw content (from a file or stream) and produces
// an array of Record objects that the system can process.
// ============================================================

type Parser = {
  /** Unique name identifying this parser (e.g., "revdiff", "json-lines") */
  name: string;

  /** Parse raw content into an array of Records */
  parse(content: string): Record[];
};

export type { Parser };
