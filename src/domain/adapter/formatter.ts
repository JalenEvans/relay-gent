import type { Record } from "../record/record.schema";

// ============================================================
// formatRecord — single Record → formatted string
// ============================================================

export function formatRecord(record: Record): string {
  switch (record.type) {
    case "revdiff": {
      return `[${record.file}:${record.line}] (${record.annotationType})\n${record.comment}`;
    }
    case "json-lines": {
      const timestamp = record.timestamp ?? "unknown";
      const level = record.level ?? "info";
      return `[${timestamp}] [${level}] ${record.message}`;
    }
    case "markdown-headers": {
      const hashes = "#".repeat(record.level);
      const prefix = hashes.length > 0 ? `${hashes} ` : "";
      return `${prefix}${record.header}\n${record.body}`;
    }
    case "junit": {
      const status = record.failure || record.error ? "FAIL" : "PASS";
      let timeStr = "";
      if (record.time !== undefined) {
        const formatted =
          Number.isInteger(record.time) && record.time !== 0
            ? `${record.time}.0`
            : String(record.time);
        timeStr = ` (${formatted})`;
      }
      return `[${record.name}] ${status}${timeStr}`;
    }
  }
}

// ============================================================
// formatRecords — multiple Records → joined string
// ============================================================

export function formatRecords(records: Record[]): string {
  if (records.length === 0) return "";
  return records.map(formatRecord).join("\n---\n\n");
}
