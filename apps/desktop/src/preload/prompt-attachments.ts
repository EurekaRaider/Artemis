import {
  MAX_PROMPT_ATTACHMENTS,
  MAX_PROMPT_FILE_BYTES,
  MAX_PROMPT_IMAGE_BYTES,
  MAX_PROMPT_TOTAL_BYTES,
  attachmentIsImage,
  MAX_PROMPT_IMAGES,
  promptAttachmentsSchema,
  type PromptAttachment,
  type PromptImage,
} from "@artemis/protocol";

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
  importInline?: (item: PromptAttachment) => Promise<PromptAttachment>,
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
    if (
      file.size >
      (isSupportedImageMimeType(file.type)
        ? MAX_PROMPT_IMAGE_BYTES
        : MAX_PROMPT_FILE_BYTES)
    ) {
      throw new Error(`Attachment exceeds the file size limit: ${file.name}`);
    }
    totalBytes += file.size;
    if (totalBytes > MAX_PROMPT_TOTAL_BYTES) {
      throw new Error("Attachments exceed the 200 MiB total limit.");
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
    if (importInline)
      attachments[index] = await importInline(attachments[index]!);
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
  if (complete.filter(attachmentIsImage).length > MAX_PROMPT_IMAGES) {
    throw new Error(`Attach no more than ${MAX_PROMPT_IMAGES} images.`);
  }
  return promptAttachmentsSchema.parse(complete);
}
