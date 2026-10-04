import { z } from "zod";
import {
  artifactAnnotationSchema,
  officeDocumentPathSchema,
  promptAttachmentsSchema,
  isAttachmentReference,
  type AppLocale,
  type ArtifactAnnotation,
  type ArtifactSelection,
  type PromptAttachment,
  type PromptFile,
  type PromptAttachmentReference,
} from "@artemis/protocol";
import { appendPromptAttachments } from "../conversation/composer-drafts.js";
import { officeCopy } from "./office-copy.js";

const MIME = "application/vnd.artemis.office-annotations+json";
export function isStoredOfficeAnnotations(
  attachment: PromptAttachment,
): attachment is PromptAttachmentReference {
  return isAttachmentReference(attachment) && attachment.mimeType === MIME;
}

export async function restoreOfficeAnnotationAttachment(
  attachment: PromptAttachmentReference,
  read: (
    offset: number,
  ) => Promise<{ text: string; nextOffset?: number | undefined }>,
): Promise<PromptFile> {
  let content = "";
  let offset = 0;
  for (;;) {
    const page = await read(offset);
    content += page.text;
    if (content.length > 200_000)
      throw new Error("Office annotation attachment exceeds its size limit");
    if (page.nextOffset === undefined) break;
    if (page.nextOffset <= offset)
      throw new Error("Invalid Office annotation page offset");
    offset = page.nextOffset;
  }
  const restored: PromptFile = {
    type: "file",
    name: attachment.name,
    mimeType: MIME,
    content,
  };
  if (!readOfficeAnnotations(restored))
    throw new Error("Invalid Office annotation attachment");
  return restored;
}
const annotationFileSchema = z.object({
  protocolVersion: z.literal(1),
  path: officeDocumentPathSchema,
  annotations: z.array(artifactAnnotationSchema).min(1),
});
export type OfficeAnnotationFile = z.infer<typeof annotationFileSchema>;
export type OfficeAnnotationReference = {
  path: string;
  annotation: ArtifactAnnotation;
};

export function readOfficeAnnotations(attachment: PromptAttachment) {
  if (
    !("type" in attachment) ||
    attachment.type !== "file" ||
    attachment.mimeType !== MIME
  )
    return undefined;
  try {
    const parsed = annotationFileSchema.safeParse(
      JSON.parse(attachment.content),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function officeAnnotationAttachment(
  file: OfficeAnnotationFile,
): PromptFile {
  return {
    type: "file",
    name: file.path.split(/[\\/]/u).at(-1) ?? file.path,
    mimeType: MIME,
    content: JSON.stringify(file),
  };
}

// One attachment per document retains the existing send/queue/recovery path
// without consuming a separate attachment slot for every comment.
export function addOfficeAnnotation(
  attachments: readonly PromptAttachment[],
  path: string,
  annotation: ArtifactAnnotation,
): PromptAttachment[] | undefined {
  const index = attachments.findIndex(
    (item) => readOfficeAnnotations(item)?.path === path,
  );
  let next: PromptAttachment[];
  if (index >= 0) {
    const previous = attachments[index]!;
    const file = readOfficeAnnotations(previous)!;
    next = [...attachments];
    next[index] = {
      ...officeAnnotationAttachment({
        ...file,
        annotations: [...file.annotations, annotation],
      }),
      name: previous.name,
    };
  } else {
    const result = appendPromptAttachments(attachments, [
      officeAnnotationAttachment({
        protocolVersion: 1,
        path,
        annotations: [annotation],
      }),
    ]);
    if (result.limited) return undefined;
    next = result.attachments;
  }
  return promptAttachmentsSchema.safeParse(next).success ? next : undefined;
}

export function changeOfficeAnnotation(
  attachments: readonly PromptAttachment[],
  attachmentIndex: number,
  annotationId: string,
  text: string | undefined,
): PromptAttachment[] | undefined {
  const attachment = attachments[attachmentIndex];
  const file = attachment && readOfficeAnnotations(attachment);
  if (!file) return undefined;
  const annotations =
    text === undefined
      ? file.annotations.filter((item) => item.id !== annotationId)
      : file.annotations.map((item) =>
          item.id === annotationId ? { ...item, text } : item,
        );
  if (
    annotations.length &&
    !annotationFileSchema.safeParse({ ...file, annotations }).success
  )
    return undefined;
  const next = attachments.flatMap((item, index) =>
    index !== attachmentIndex
      ? [item]
      : annotations.length
        ? [
            {
              ...officeAnnotationAttachment({ ...file, annotations }),
              name: item.name,
            },
          ]
        : [],
  );
  return promptAttachmentsSchema.safeParse(next).success ? next : undefined;
}

export function officeSelectionLabel(
  value: ArtifactSelection,
  locale: AppLocale,
) {
  const t = officeCopy(locale);
  if (value.kind === "paragraph") return `${t.paragraph} ${value.index + 1}`;
  if (value.kind === "object")
    return `${t.page} ${value.page} · ${t.object} ${[value.index, ...(value.path ?? [])].map((index) => index + 1).join(".")}${value.cell ? ` · R${value.cell.row + 1}C${value.cell.column + 1}` : ""}`;
  if (value.kind === "cells") return `${value.sheet} · ${value.range}`;
  return `${t.page} ${value.page} · ${t.regionSelection}`;
}
