import {
  MAX_PROMPT_ATTACHMENTS,
  MAX_PROMPT_IMAGES,
  promptAttachmentsSchema,
  type PromptAttachment,
  type PromptImage,
} from "@artemis/protocol";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const supportedImageMimeTypes = new Set<PromptImage["mimeType"]>([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

type ResolveFilePath = (file: File) => string;
type LoadPaths = (paths: string[]) => Promise<PromptAttachment[]>;

function encodeBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 32 * 1024;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)),
    );
  }
  return btoa(binary);
}

function isSupportedImageMimeType(
  mimeType: string,
): mimeType is PromptImage["mimeType"] {
  return supportedImageMimeTypes.has(mimeType as PromptImage["mimeType"]);
}

function fallbackImageName(mimeType: PromptImage["mimeType"]): string {
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.slice(6);
  return `pasted-image.${extension}`;
}

export async function readPromptAttachmentsFromFiles(
  files: readonly File[],
  resolveFilePath: ResolveFilePath,
  loadPaths: LoadPaths,
): Promise<PromptAttachment[]> {
  if (files.length === 0 || files.length > MAX_PROMPT_ATTACHMENTS) {
    throw new Error(
      `Attach no more than ${MAX_PROMPT_ATTACHMENTS} files at a time.`,
    );
  }

  const attachments: Array<PromptAttachment | undefined> = Array.from({
    length: files.length,
  });
  const localFiles: Array<{ index: number; path: string }> = [];
  let totalBytes = 0;

  for (const [index, file] of files.entries()) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(`Attachment is larger than 10 MiB: ${file.name}`);
    }
    totalBytes += file.size;
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new Error("Attachments exceed the 20 MiB total limit.");
    }

    const path = resolveFilePath(file);
    if (path) {
      localFiles.push({ index, path });
      continue;
    }
    if (!isSupportedImageMimeType(file.type)) {
      throw new Error(
        `Pasted file does not have a local path: ${file.name || "unnamed file"}`,
      );
    }

    attachments[index] = {
      name: file.name.trim() || fallbackImageName(file.type),
      mimeType: file.type,
      data: encodeBase64(await file.arrayBuffer()),
    };
  }

  if (localFiles.length > 0) {
    const loaded = await loadPaths(localFiles.map((file) => file.path));
    if (loaded.length !== localFiles.length) {
      throw new Error("Some pasted attachments could not be read.");
    }
    localFiles.forEach((file, index) => {
      attachments[file.index] = loaded[index];
    });
  }

  const complete = attachments.filter(
    (attachment): attachment is PromptAttachment => attachment !== undefined,
  );
  if (complete.length !== attachments.length) {
    throw new Error("Some pasted attachments could not be read.");
  }
  if (
    complete.filter((attachment) => !("type" in attachment)).length >
    MAX_PROMPT_IMAGES
  ) {
    throw new Error(`Attach no more than ${MAX_PROMPT_IMAGES} images.`);
  }
  return promptAttachmentsSchema.parse(complete);
}
