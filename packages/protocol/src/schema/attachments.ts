import { z } from "zod";

export const promptImageSchema = z.object({
  attachmentId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(255),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
  data: z
    .string()
    .min(1)
    .max(14_000_000)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/u),
});

export type PromptImage = z.infer<typeof promptImageSchema>;

export const MAX_PROMPT_IMAGES = 20;

export const MAX_PROMPT_FILES = 10;

export const MAX_PROMPT_IMAGE_BYTES = 10 * 1024 * 1024;

export const MAX_PROMPT_FILE_BYTES = 100 * 1024 * 1024;

export const MAX_PROMPT_TOTAL_BYTES = 200 * 1024 * 1024;

export const promptImagesSchema = z
  .array(promptImageSchema)
  .max(MAX_PROMPT_IMAGES);

export const promptFileSchema = z.object({
  type: z.literal("file"),
  name: z.string().trim().min(1).max(255),
  mimeType: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/u),
  content: z.string().max(200_000),
});

export type PromptFile = z.infer<typeof promptFileSchema>;

export const promptAttachmentReferenceSchema = z.object({
  type: z.literal("attachment"),
  id: z.string().uuid(),
  kind: z.enum(["image", "file"]),
  name: z.string().trim().min(1).max(255),
  mimeType: z.string().min(1).max(120),
  size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  status: z.enum(["pending", "ready", "error"]),
  parseStatus: z.enum(["processing", "complete", "error"]).optional(),
  indexVersion: z.number().int().positive().optional(),
  error: z.string().max(1000).optional(),
  pages: z.number().int().nonnegative().optional(),
  characters: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  displayWidth: z.number().int().positive().optional(),
  displayHeight: z.number().int().positive().optional(),
  thumbnail: z.string().max(100000).optional(),
});

export type PromptAttachmentReference = z.infer<
  typeof promptAttachmentReferenceSchema
>;

export function isAttachmentReference(
  value: PromptAttachment,
): value is PromptAttachmentReference {
  return "type" in value && value.type === "attachment";
}

export function attachmentIsImage(value: PromptAttachment): boolean {
  return (
    !("type" in value) ||
    (value.type === "attachment" && value.kind === "image")
  );
}

export function attachmentBytes(value: PromptAttachment): number {
  if (isAttachmentReference(value)) return value.size;
  return "type" in value
    ? new TextEncoder().encode(value.content).length
    : Math.floor((value.data.length * 3) / 4) -
        (value.data.endsWith("==") ? 2 : value.data.endsWith("=") ? 1 : 0);
}

export const promptAttachmentSchema = z.union([
  promptAttachmentReferenceSchema,
  promptImageSchema,
  promptFileSchema,
]);

export type PromptAttachment = z.infer<typeof promptAttachmentSchema>;

export const MAX_PROMPT_ATTACHMENTS = 30;

export const promptAttachmentsSchema = z
  .array(promptAttachmentSchema)
  .superRefine((items, context) => {
    // Local references carry metadata; inline payloads retain transport limits.
    const attachments = items.filter((item) => !isAttachmentReference(item));
    const imageCount = attachments.filter((attachment) =>
      attachmentIsImage(attachment),
    ).length;
    if (imageCount > MAX_PROMPT_IMAGES) {
      context.addIssue({
        code: "custom",
        message: `Attach no more than ${MAX_PROMPT_IMAGES} images.`,
      });
    }
    if (attachments.length - imageCount > MAX_PROMPT_FILES) {
      context.addIssue({
        code: "custom",
        message: `Attach no more than ${MAX_PROMPT_FILES} documents.`,
      });
    }
    if (
      attachments.reduce((total, item) => total + attachmentBytes(item), 0) >
      MAX_PROMPT_TOTAL_BYTES
    ) {
      context.addIssue({
        code: "custom",
        message: "Attachments exceed the 200 MiB total limit.",
      });
    }
    for (const item of attachments) {
      if (
        attachmentIsImage(item) &&
        attachmentBytes(item) > MAX_PROMPT_IMAGE_BYTES
      ) {
        context.addIssue({
          code: "custom",
          message: `Image is larger than 10 MiB: ${item.name}`,
        });
      }
    }
    const fileCharacters = attachments.reduce(
      (total, attachment) =>
        total +
        ("type" in attachment && attachment.type === "file"
          ? attachment.content.length
          : 0),
      0,
    );
    if (fileCharacters > 400_000) {
      context.addIssue({
        code: "custom",
        message: "Attached file contents exceed the 400,000 character limit.",
      });
    }
  });
