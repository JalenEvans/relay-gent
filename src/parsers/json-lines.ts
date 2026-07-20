import type { Parser } from "../domain/parser/parser.interface";
import { JsonLinesRecordSchema } from "../domain/record/record.schema";

// ============================================================
// JSON-Lines Parser — newline-delimited JSON into Records
// ============================================================
// Each non-empty line is treated as a standalone JSON object.
// Required field: message (string)
// Optional fields: timestamp, level
// Extra fields are preserved via schema .passthrough()
// Malformed lines are silently skipped.
// ============================================================

function createJsonLinesParser(): Parser {
  return {
    name: "json-lines",
    parse(content: string) {
      const lines = content.split("\n");
      const records: ReturnType<typeof JsonLinesRecordSchema.parse>[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === "") continue;

        try {
          const parsed: unknown = JSON.parse(trimmed);
          const withType = { ...(parsed as Record<string, unknown>), type: "json-lines" as const };
          const result = JsonLinesRecordSchema.safeParse(withType);
          if (result.success) {
            records.push(result.data);
          }
        } catch {
          // Skip malformed JSON lines silently
        }
      }

      return records;
    },
  };
}

export { createJsonLinesParser };
