import { SHA256 } from "bun";
import type { Record } from "./record.schema";

// ============================================================
// Record Identity — stable identity string: `<type>:<key>`
// ============================================================

function getRecordKey(record: Record): string {
  switch (record.type) {
    case "revdiff":
      return `${record.file}:${record.line}:${record.annotationType}`;
    case "json-lines":
      return `${record.timestamp ?? ""}:${record.level ?? ""}`;
    case "markdown-headers":
      return record.header;
    case "junit":
      return `${record.name}:${record.classname ?? ""}`;
  }
}

function getRecordBody(record: Record): string {
  switch (record.type) {
    case "revdiff":
      return record.comment;
    case "json-lines":
      return record.message;
    case "markdown-headers":
      return record.body;
    case "junit":
      return record.failure ?? record.error ?? "";
  }
}

function normalizeBody(body: string): string {
  const normalized = body
    .normalize("NFC") // Unicode normalization
    .replace(/\r\n/g, "\n") // CRLF → LF
    .trim(); // Strip leading/trailing whitespace

  return SHA256.hash(normalized, "hex");
}

function computeIdentity(record: Record): string {
  const key = getRecordKey(record);
  return `${record.type}:${key}`;
}

function computeRecordHash(record: Record): string {
  const body = getRecordBody(record);
  return normalizeBody(body);
}

export { getRecordKey, getRecordBody, normalizeBody, computeIdentity, computeRecordHash };
