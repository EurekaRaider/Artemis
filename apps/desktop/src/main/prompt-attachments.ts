import { readFile, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute } from "node:path";

import {
  MAX_PROMPT_ATTACHMENTS,
  MAX_PROMPT_IMAGES,
  promptAttachmentsSchema,
  type PromptAttachment,
  type PromptFile,
  type PromptImage,
} from "@artemis/protocol";
import { parseOffice, type OfficeContentNode } from "officeparser";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_FILE_CHARACTERS = 200_000;

const imageMimeTypes = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
} as const;

const documentMimeTypes = {
  ".pdf": "application/pdf",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
} as const;

const textMimeTypes: Record<string, string> = {
  ".css": "text/css",
  ".csv": "text/csv",
  ".htm": "text/html",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".jsx": "text/jsx",
  ".md": "text/markdown",
  ".mjs": "text/javascript",
  ".toml": "application/toml",
  ".ts": "text/typescript",
  ".tsx": "text/tsx",
  ".xml": "application/xml",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
};

function imageMimeType(path: string): PromptImage["mimeType"] | undefined {
  return imageMimeTypes[
    extname(path).toLowerCase() as keyof typeof imageMimeTypes
  ];
}

function nodeText(node: OfficeContentNode): string {
  if (typeof node.text === "string") {
    return node.text;
  }
  return (node.children ?? []).map(nodeText).join("");
}

async function extractDocument(path: string): Promise<string> {
  const parsed = await parseOffice(path, {
    decompressionLimits: {
      maxUncompressedBytes: 128 * 1024 * 1024,
      maxZipEntries: 5_000,
      maxTableCells: 1_000_000,
    },
    extractAttachments: false,
    ignoreComments: true,
    ignoreHeadersAndFooters: true,
    ignoreNotes: true,
    ignoreSlideMasters: true,
    includeRawContent: false,
    ocr: false,
  });
  return parsed.content.map(nodeText).filter(Boolean).join("\n");
}

function decodeText(path: string, bytes: Buffer): string {
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`Unsupported binary attachment: ${basename(path)}`);
  }
  const controlCharacters =
    content.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu)?.length ?? 0;
  if (controlCharacters > Math.max(2, Math.floor(content.length / 100))) {
    throw new Error(`Unsupported binary attachment: ${basename(path)}`);
  }
  return content;
}

function validateContentLength(name: string, content: string): string {
  if (content.length > MAX_FILE_CHARACTERS) {
    throw new Error(
      `File content exceeds ${MAX_FILE_CHARACTERS.toLocaleString("en-US")} characters: ${name}`,
    );
  }
  return content;
}

async function loadFile(path: string, bytes: Buffer): Promise<PromptFile> {
  const extension = extname(path).toLowerCase();
  const documentMimeType =
    documentMimeTypes[extension as keyof typeof documentMimeTypes];
  const content = validateContentLength(
    basename(path),
    documentMimeType ? await extractDocument(path) : decodeText(path, bytes),
  );
  return {
    type: "file",
    name: basename(path),
    mimeType: documentMimeType ?? textMimeTypes[extension] ?? "text/plain",
    content,
  };
}

export async function loadPromptAttachments(
  inputPaths: readonly string[],
): Promise<PromptAttachment[]> {
  if (inputPaths.length === 0 || inputPaths.length > MAX_PROMPT_ATTACHMENTS) {
    throw new Error(
      `Attach no more than ${MAX_PROMPT_ATTACHMENTS} files at a time.`,
    );
  }

  const attachments: PromptAttachment[] = [];
  let imageCount = 0;
  let totalBytes = 0;
  for (const inputPath of inputPaths) {
    if (typeof inputPath !== "string" || !isAbsolute(inputPath)) {
      throw new Error("Attachment path must be absolute.");
    }
    const path = await realpath(inputPath);
    const information = await stat(path);
    if (!information.isFile()) {
      throw new Error(`Attachment is not a file: ${basename(path)}`);
    }
    if (information.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(`Attachment is larger than 10 MiB: ${basename(path)}`);
    }
    totalBytes += information.size;
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new Error("Attachments exceed the 20 MiB total limit.");
    }

    const bytes = await readFile(path);
    const mimeType = imageMimeType(path);
    if (mimeType) {
      imageCount += 1;
      if (imageCount > MAX_PROMPT_IMAGES) {
        throw new Error(`Attach no more than ${MAX_PROMPT_IMAGES} images.`);
      }
      attachments.push({
        name: basename(path),
        mimeType,
        data: bytes.toString("base64"),
      });
    } else {
      attachments.push(await loadFile(path, bytes));
    }
  }
  return promptAttachmentsSchema.parse(attachments);
}
