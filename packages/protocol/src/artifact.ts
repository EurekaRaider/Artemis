import { z } from "zod";
import { officeDocumentPathSchema, officeCellValueSchema } from "./office.js";

export const ARTIFACT_PROTOCOL_VERSION = 1 as const;
const id = z.string().min(1).max(200);
const version = z.number().int().nonnegative().safe();
const page = z.number().int().min(1).max(100_000);
export const artifactFormatSchema = z.enum(["word", "powerpoint", "excel"]);

export const artifactSelectionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("paragraph"),
      index: version,
      start: version,
      end: version,
    })
    .strict()
    .refine((v) => v.end >= v.start),
  z.object({ kind: z.literal("object"), page, index: version }).strict(),
  z
    .object({
      kind: z.literal("cells"),
      sheet: z.string().min(1).max(128),
      range: z
        .string()
        .regex(
          /^\$?[A-Z]{1,3}\$?[1-9]\d{0,6}(?::\$?[A-Z]{1,3}\$?[1-9]\d{0,6})?$/u,
        ),
    })
    .strict(),
  z
    .object({
      kind: z.literal("region"),
      page,
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().positive().max(1),
      height: z.number().positive().max(1),
    })
    .strict()
    .refine((v) => v.x + v.width <= 1 && v.y + v.height <= 1),
]);
export type ArtifactSelection = z.infer<typeof artifactSelectionSchema>;

export const artifactOperationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("replace-text"),
      paragraph: version,
      start: version,
      end: version,
      text: z.string().max(1_000_000),
    })
    .strict()
    .refine((v) => v.end >= v.start),
  z
    .object({
      type: z.literal("set-object-text"),
      page,
      object: version,
      text: z.string().max(1_000_000),
    })
    .strict(),
  z
    .object({
      type: z.literal("set-cells"),
      sheet: z.string().min(1).max(128),
      row: z.number().int().min(1).max(1_048_576),
      column: z.number().int().min(1).max(16_384),
      values: z
        .array(z.array(officeCellValueSchema).min(1).max(256))
        .min(1)
        .max(1_000),
    })
    .strict()
    .refine(
      (v) =>
        v.row + v.values.length - 1 <= 1_048_576 &&
        v.values.every(
          (row) =>
            row.length === v.values[0]!.length &&
            v.column + row.length - 1 <= 16_384,
        ),
    ),
  z
    .object({
      type: z.literal("set-formula"),
      sheet: z.string().min(1).max(128),
      row: z.number().int().min(1).max(1_048_576),
      column: z.number().int().min(1).max(16_384),
      formula: z.string().startsWith("=").max(8_192),
    })
    .strict(),
]);
export type ArtifactOperation = z.infer<typeof artifactOperationSchema>;

export const artifactSessionSchema = z
  .object({
    protocolVersion: z.literal(ARTIFACT_PROTOCOL_VERSION),
    documentId: id,
    sessionId: id,
    path: officeDocumentPathSchema,
    format: artifactFormatSchema,
    engineVersion: z.string().min(1).max(100),
    version,
    savedVersion: version,
    previewVersion: version.nullable(),
    sequence: version,
    status: z.enum([
      "opening",
      "editing",
      "saving",
      "saved",
      "conflict",
      "recovering",
      "failed",
      "closed",
    ]),
    error: z.string().max(4_096).optional(),
  })
  .strict()
  .refine(
    (s) =>
      s.savedVersion <= s.version &&
      (s.previewVersion === null || s.previewVersion <= s.version) &&
      (s.status !== "saved" || s.savedVersion === s.version),
  );
export type ArtifactSession = z.infer<typeof artifactSessionSchema>;

export const artifactAnnotationSchema = z
  .object({
    protocolVersion: z.literal(ARTIFACT_PROTOCOL_VERSION),
    id,
    documentId: id,
    sessionId: id,
    sourceVersion: version,
    selection: artifactSelectionSchema,
    quote: z.string().max(8_192).optional(),
    text: z.string().trim().min(1).max(8_192),
  })
  .strict();
export type ArtifactAnnotation = z.infer<typeof artifactAnnotationSchema>;

export const artifactSnapshotSchema = z
  .object({
    session: artifactSessionSchema,
    targets: z
      .array(
        z
          .object({
            selection: artifactSelectionSchema,
            text: z.string().max(100_000),
          })
          .strict(),
      )
      .max(20_000),
    sheets: z.array(z.string().max(128)).max(1_024),
    preview: z.object({ version, assetId: id }).strict().optional(),
    warnings: z.array(z.string().max(2_000)).max(100),
  })
  .strict()
  .refine((s) => !s.preview || s.preview.version === s.session.previewVersion);
export type ArtifactSnapshot = z.infer<typeof artifactSnapshotSchema>;

export const artifactEventSchema = z
  .object({
    protocolVersion: z.literal(ARTIFACT_PROTOCOL_VERSION),
    eventId: id,
    kind: z.enum([
      "opened",
      "applied",
      "preview",
      "saving",
      "saved",
      "external-change",
      "recovering",
      "recovered",
      "failed",
      "closed",
    ]),
    session: artifactSessionSchema,
    operationId: id.optional(),
    selection: artifactSelectionSchema.optional(),
  })
  .strict();
export type ArtifactEvent = z.infer<typeof artifactEventSchema>;

const requestBase = {
  protocolVersion: z.literal(2),
  requestId: id,
  format: artifactFormatSchema,
  path: officeDocumentPathSchema,
};
const sessionBase = { ...requestBase, sessionId: id };
export const artifactSessionRequestSchema = z.discriminatedUnion("operation", [
  z.object({ ...requestBase, operation: z.literal("open") }).strict(),
  z
    .object({
      ...sessionBase,
      operation: z.literal("apply"),
      operationId: id,
      expectedVersion: version,
      change: artifactOperationSchema,
    })
    .strict(),
  z.object({ ...sessionBase, operation: z.literal("snapshot") }).strict(),
  z
    .object({
      ...sessionBase,
      operation: z.literal("save"),
      expectedVersion: version,
    })
    .strict(),
  z
    .object({
      ...sessionBase,
      operation: z.literal("close"),
      discard: z.boolean().default(false),
    })
    .strict(),
]);
export type ArtifactSessionRequest = z.infer<
  typeof artifactSessionRequestSchema
>;

export interface ArtifactViewState {
  session: ArtifactSession;
  needsSnapshot: boolean;
  selection?: ArtifactSelection;
}

/** Gaps stop incremental projection until an authoritative snapshot is read. */
export function reduceArtifactEvent(
  previous: ArtifactViewState | undefined,
  event: ArtifactEvent,
): ArtifactViewState {
  const session = event.session;
  if (!previous)
    return {
      session,
      needsSnapshot: event.kind !== "opened",
      ...(event.selection ? { selection: event.selection } : {}),
    };
  if (
    previous.session.sessionId !== session.sessionId ||
    previous.session.documentId !== session.documentId
  )
    return previous;
  if (session.sequence <= previous.session.sequence) return previous;
  if (
    previous.needsSnapshot ||
    session.sequence !== previous.session.sequence + 1 ||
    session.version < previous.session.version
  )
    return { ...previous, needsSnapshot: true };
  return {
    session,
    needsSnapshot: false,
    ...(event.selection
      ? { selection: event.selection }
      : previous.selection
        ? { selection: previous.selection }
        : {}),
  };
}

export function restoreArtifactSnapshot(
  previous: ArtifactViewState | undefined,
  snapshot: ArtifactSnapshot,
): ArtifactViewState {
  if (
    previous &&
    (previous.session.sessionId !== snapshot.session.sessionId ||
      previous.session.sequence > snapshot.session.sequence)
  )
    return previous;
  return {
    session: snapshot.session,
    needsSnapshot: false,
    ...(previous?.selection ? { selection: previous.selection } : {}),
  };
}
