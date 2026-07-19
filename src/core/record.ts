import { z } from "zod";

// ============================================================
// RecordSchema — Zod discriminated union on `type` field
// ============================================================

const BaseRecordSchema = z.object({
  schemaVersion: z.literal(1).default(1),
});

const RevdiffRecordSchema = BaseRecordSchema.extend({
  type: z.literal("revdiff"),
  file: z.string(),
  line: z.number(),
  endLine: z.number().optional(),
  annotationType: z.enum(["+", "-", " ", "file-level"]),
  comment: z.string(),
});

const JsonLinesRecordSchema = BaseRecordSchema.extend({
  type: z.literal("json-lines"),
  timestamp: z.string().optional(),
  level: z.string().optional(),
  message: z.string(),
}).passthrough();

const MarkdownHeadersRecordSchema = BaseRecordSchema.extend({
  type: z.literal("markdown-headers"),
  header: z.string(),
  level: z.number().nonnegative(),
  body: z.string(),
});

const JunitRecordSchema = BaseRecordSchema.extend({
  type: z.literal("junit"),
  name: z.string(),
  classname: z.string().optional(),
  time: z.number().optional(),
  failure: z.string().optional(),
  error: z.string().optional(),
});

const RecordSchema = z.discriminatedUnion("type", [
  RevdiffRecordSchema,
  JsonLinesRecordSchema,
  MarkdownHeadersRecordSchema,
  JunitRecordSchema,
]);

type Record = z.infer<typeof RecordSchema>;

export {
  BaseRecordSchema,
  RevdiffRecordSchema,
  JsonLinesRecordSchema,
  MarkdownHeadersRecordSchema,
  JunitRecordSchema,
  RecordSchema,
  type Record,
};
