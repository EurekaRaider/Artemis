import { z } from "zod";

export const OFFICE_DOCUMENT_PROTOCOL_VERSION = 1 as const;

export const officeDocumentFormatSchema = z.enum([
  "pdf",
  "excel",
  "word",
  "powerpoint",
]);
export type OfficeDocumentFormat = z.infer<typeof officeDocumentFormatSchema>;

export const officeDocumentOperationSchema = z.enum([
  "create",
  "write",
  "read",
  "modify",
  "delete",
]);
export type OfficeDocumentOperation = z.infer<
  typeof officeDocumentOperationSchema
>;

export const officeCellValueSchema = z.union([
  z.string().max(1_000_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export type OfficeCellValue = z.infer<typeof officeCellValueSchema>;

const pdfContentSchema = z.object({
  format: z.literal("pdf"),
  pages: z
    .array(
      z.object({
        text: z.string().max(1_000_000),
        width: z.number().positive().max(20_000).optional(),
        height: z.number().positive().max(20_000).optional(),
      }),
    )
    .max(10_000),
});

const excelContentSchema = z.object({
  format: z.literal("excel"),
  sheets: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(31),
        rows: z
          .array(z.array(officeCellValueSchema).max(16_384))
          .max(1_048_576),
      }),
    )
    .min(1)
    .max(1_024),
});

const wordContentSchema = z.object({
  format: z.literal("word"),
  paragraphs: z
    .array(
      z.object({
        text: z.string().max(1_000_000),
        heading: z.number().int().min(1).max(6).optional(),
      }),
    )
    .max(1_000_000),
});

const powerpointContentSchema = z.object({
  format: z.literal("powerpoint"),
  slides: z
    .array(
      z.object({
        title: z.string().max(100_000).optional(),
        body: z.array(z.string().max(1_000_000)).max(100_000),
      }),
    )
    .max(100_000),
});

export const officeDocumentContentSchema = z.discriminatedUnion("format", [
  pdfContentSchema,
  excelContentSchema,
  wordContentSchema,
  powerpointContentSchema,
]);
export type OfficeDocumentContent = z.infer<typeof officeDocumentContentSchema>;

const replaceTextPatchSchema = z.object({
  type: z.literal("replace-text"),
  find: z.string().min(1).max(1_000_000),
  replacement: z.string().max(1_000_000),
  all: z.boolean(),
});

const setCellPatchSchema = z.object({
  type: z.literal("set-cell"),
  sheet: z.string().trim().min(1).max(31),
  row: z.number().int().min(1).max(1_048_576),
  column: z.number().int().min(1).max(16_384),
  value: officeCellValueSchema,
});

export const officeDocumentPatchSchema = z.discriminatedUnion("type", [
  replaceTextPatchSchema,
  setCellPatchSchema,
]);
export type OfficeDocumentPatch = z.infer<typeof officeDocumentPatchSchema>;

export const officeDocumentPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(4_096)
  .refine(
    (value) =>
      !value.includes("\0") &&
      !value.startsWith("/") &&
      !value.startsWith("\\") &&
      !/^[A-Za-z]:[\\/]/u.test(value) &&
      !value.split(/[\\/]/u).some((segment) => segment === ".."),
    "Office document path must be a safe workspace-relative path",
  );

const requestBase = {
  protocolVersion: z.literal(OFFICE_DOCUMENT_PROTOCOL_VERSION),
  requestId: z.string().trim().min(1).max(200),
  format: officeDocumentFormatSchema,
  path: officeDocumentPathSchema,
};

const createOrWriteRequestSchema = z
  .object({
    ...requestBase,
    operation: z.enum(["create", "write"]),
    content: officeDocumentContentSchema,
  })
  .superRefine((request, context) => {
    if (request.content.format !== request.format) {
      context.addIssue({
        code: "custom",
        path: ["content", "format"],
        message: "Content format must match the requested document format",
      });
    }
  });

const readOrDeleteRequestSchema = z.object({
  ...requestBase,
  operation: z.enum(["read", "delete"]),
});

const modifyRequestSchema = z
  .object({
    ...requestBase,
    operation: z.literal("modify"),
    patch: officeDocumentPatchSchema,
  })
  .superRefine((request, context) => {
    if (request.patch.type === "set-cell" && request.format !== "excel") {
      context.addIssue({
        code: "custom",
        path: ["patch", "type"],
        message: "The set-cell patch is only valid for Excel documents",
      });
    }
  });

export const officeDocumentRequestSchema = z.union([
  createOrWriteRequestSchema,
  readOrDeleteRequestSchema,
  modifyRequestSchema,
]);
export type OfficeDocumentRequest = z.infer<typeof officeDocumentRequestSchema>;

export const officeDocumentResultSchema = z.object({
  protocolVersion: z.literal(OFFICE_DOCUMENT_PROTOCOL_VERSION),
  requestId: z.string().trim().min(1).max(200),
  operation: officeDocumentOperationSchema,
  format: officeDocumentFormatSchema,
  path: officeDocumentPathSchema,
  changed: z.boolean(),
  content: officeDocumentContentSchema.optional(),
  warnings: z.array(z.string().max(2_000)).max(100).default([]),
});
export type OfficeDocumentResult = z.infer<typeof officeDocumentResultSchema>;

export const officeDocumentCapabilitiesSchema = z.object({
  protocolVersion: z.literal(OFFICE_DOCUMENT_PROTOCOL_VERSION),
  platforms: z
    .array(z.enum(["win32", "darwin"]))
    .min(1)
    .max(2),
  formats: z
    .array(
      z.object({
        format: officeDocumentFormatSchema,
        operations: z
          .array(officeDocumentOperationSchema)
          .min(1)
          .max(officeDocumentOperationSchema.options.length),
        fidelity: z.literal("normalized"),
      }),
    )
    .min(1)
    .max(officeDocumentFormatSchema.options.length),
});
export type OfficeDocumentCapabilities = z.infer<
  typeof officeDocumentCapabilitiesSchema
>;
