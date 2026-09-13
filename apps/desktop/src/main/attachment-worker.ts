import { estimateTextTokens, textWithinTokenBudget } from "@artemis/protocol";

/** Read supported image headers before asking a native decoder to allocate pixels. */
export function attachmentImageDimensions(bytes: Buffer): {
  width: number;
  height: number;
} {
  let width = 0,
    height = 0;
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else if (
    bytes.length >= 10 &&
    /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString("ascii"))
  ) {
    width = bytes.readUInt16LE(6);
    height = bytes.readUInt16LE(8);
  } else if (
    bytes.length >= 30 &&
    bytes.subarray(0, 4).toString() === "RIFF" &&
    bytes.subarray(8, 12).toString() === "WEBP"
  ) {
    const format = bytes.subarray(12, 16).toString();
    if (format === "VP8X") {
      width = bytes.readUIntLE(24, 3) + 1;
      height = bytes.readUIntLE(27, 3) + 1;
    } else if (format === "VP8L") {
      const packed = bytes.readUInt32LE(21);
      width = (packed & 0x3fff) + 1;
      height = ((packed >>> 14) & 0x3fff) + 1;
    } else if (format === "VP8 ") {
      width = bytes.readUInt16LE(26) & 0x3fff;
      height = bytes.readUInt16LE(28) & 0x3fff;
    }
  } else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++]!;
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker) &&
        length >= 7
      ) {
        height = bytes.readUInt16BE(offset + 3);
        width = bytes.readUInt16BE(offset + 5);
        break;
      }
      offset += length;
    }
  }
  if (!width || !height) throw new Error("Unsupported or invalid image header");
  if (width * height > 100000000)
    throw new Error("Image exceeds the 100 megapixel decode limit");
  return { width, height };
}

import { parentPort } from "node:worker_threads";
import { readFile, writeFile } from "node:fs/promises";
import { parseOffice, type OfficeContentNode } from "officeparser";
import {
  createCanvas,
  loadImage,
  type Canvas,
  type Image,
} from "@napi-rs/canvas";

export interface AttachmentSegment {
  text: string;
  page?: number | undefined;
  label?: string;
}
export interface AttachmentWork {
  action: "parse" | "image" | "read" | "search";
  id?: string;
  name?: string;
  offset?: number | undefined;
  query?: string | undefined;
  maxTokens?: number;
  path: string;
  mimeType: string;
  output?: string;
  page?: number | undefined;
  crop?: { x: number; y: number; width: number; height: number } | undefined;
}
function text(node: OfficeContentNode): string {
  return typeof node.text === "string"
    ? node.text
    : (node.children ?? []).map(text).join("\n");
}
export async function processAttachment(
  work: AttachmentWork,
): Promise<unknown> {
  if (work.action === "read" || work.action === "search") {
    const segments = JSON.parse(
      await readFile(work.path, "utf8"),
    ) as AttachmentSegment[];
    const budget = Math.min(4000, work.maxTokens ?? 4000);
    if (
      work.page !== undefined &&
      (!Number.isInteger(work.page) ||
        work.page < 1 ||
        !segments.some((s) => s.page === work.page))
    )
      throw new Error("Page is outside the document");
    if (work.action === "search") {
      if (!work.query?.trim()) throw new Error("Search query is required");
      const matches = [];
      let remaining = budget,
        globalOffset = 0;
      for (const s of segments) {
        let from = 0;
        while (remaining > 0) {
          const index = s.text
            .toLocaleLowerCase()
            .indexOf(work.query.toLocaleLowerCase(), from);
          if (index < 0) break;
          const excerpt = textWithinTokenBudget(
            s.text.slice(Math.max(0, index - 100), index + 300),
            remaining,
          );
          matches.push({
            page: s.page,
            label: s.label,
            offset: s.page ? index : globalOffset + index,
            text: excerpt,
          });
          remaining -= estimateTextTokens(excerpt) + 80;
          from = index + work.query.length;
          if (matches.length >= 20) break;
        }
        globalOffset += s.text.length + 1;
        if (remaining <= 0 || matches.length >= 20) break;
      }
      return {
        id: work.id,
        matches,
        limited: matches.length >= 20 || remaining <= 0,
      };
    }
    const selected = segments.filter(
      (s) => work.page === undefined || s.page === work.page,
    );
    const text = selected.map((s) => s.text).join("\n"),
      offset = work.offset ?? 0;
    if (!Number.isInteger(offset) || offset < 0 || offset > text.length)
      throw new Error("Invalid attachment offset");
    const content = textWithinTokenBudget(text.slice(offset), budget);
    if (!content && offset < text.length) {
      throw new Error(
        "Attachment token budget is too small for the next character",
      );
    }
    let position = 0;
    const locations = selected
      .flatMap((s) => {
        const start = position;
        position += s.text.length + 1;
        return position > offset && start < offset + content.length
          ? [{ offset: start, page: s.page, label: s.label }]
          : [];
      })
      .slice(0, 20);
    return {
      id: work.id,
      name: work.name,
      page: work.page,
      offset,
      text: content,
      locations,
      nextOffset:
        offset + content.length < text.length
          ? offset + content.length
          : undefined,
      totalCharacters: text.length,
      empty: !text.length,
    };
  }
  if (work.action === "parse") {
    let segments: AttachmentSegment[];
    if (/pdf|officedocument/.test(work.mimeType)) {
      const parsed = await parseOffice(await readFile(work.path), {
        decompressionLimits: {
          maxUncompressedBytes: 128 * 1024 * 1024,
          maxZipEntries: 5000,
          maxTableCells: 1000000,
        },
        extractAttachments: false,
        ignoreComments: true,
        ignoreHeadersAndFooters: true,
        ignoreNotes: true,
        ignoreSlideMasters: true,
        includeRawContent: false,
        ocr: false,
      });
      segments = parsed.content.map((node, i) => ({
        text: text(node),
        ...(node.type === "page" ? { page: i + 1 } : {}),
        label: `${node.type} ${i + 1}`,
      }));
    } else {
      const bytes = await readFile(work.path);
      const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(content))
        throw new Error("Unsupported binary attachment");
      segments = [{ text: content }];
    }
    if (work.output)
      await writeFile(work.output, JSON.stringify(segments), { mode: 0o600 });
    return {
      characters: segments.reduce((n, s) => n + s.text.length, 0),
      pages: segments.filter((s) => s.page).length || undefined,
    };
  }
  let source: Image | Canvas;
  if (work.mimeType === "application/pdf") {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loading = pdfjs.getDocument({
      data: new Uint8Array(await readFile(work.path)),
      useSystemFonts: true,
    });
    const doc = await loading.promise;
    try {
      const page = await doc.getPage(work.page ?? 1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({
        scale: Math.min(2, 6000 / Math.max(base.width, base.height)),
      });
      const canvas = createCanvas(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
      await page.render({
        canvas: canvas as never,
        canvasContext: canvas.getContext("2d") as never,
        viewport,
      }).promise;
      source = canvas;
    } finally {
      await loading.destroy();
    }
  } else {
    const bytes = await readFile(work.path);
    attachmentImageDimensions(bytes);
    source = await loadImage(bytes);
  }
  const originalWidth = source.width,
    originalHeight = source.height;
  if (originalWidth * originalHeight > 100_000_000)
    throw new Error("Image exceeds the 100 megapixel decode limit");
  const crop = work.crop ?? {
    x: 0,
    y: 0,
    width: originalWidth,
    height: originalHeight,
  };
  if (
    ![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) ||
    crop.x < 0 ||
    crop.y < 0 ||
    crop.width <= 0 ||
    crop.height <= 0 ||
    crop.x + crop.width > originalWidth ||
    crop.y + crop.height > originalHeight
  )
    throw new Error("Crop is outside the image");
  let scale = Math.min(
    1,
    2048 / Math.max(crop.width, crop.height),
    Math.sqrt((2500 * 32 * 32) / (crop.width * crop.height)),
  );
  let width = Math.max(1, Math.floor(crop.width * scale)),
    height = Math.max(1, Math.floor(crop.height * scale));
  while (Math.ceil(width / 32) * Math.ceil(height / 32) > 2500) {
    scale *= 0.99;
    width = Math.max(1, Math.floor(crop.width * scale));
    height = Math.max(1, Math.floor(crop.height * scale));
  }
  const canvas = createCanvas(width, height);
  canvas
    .getContext("2d")
    .drawImage(
      source,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      width,
      height,
    );
  const bytes = await canvas.encode("png");
  const thumbnail = createCanvas(
    Math.max(1, Math.round(width * Math.min(1, 160 / Math.max(width, height)))),
    Math.max(
      1,
      Math.round(height * Math.min(1, 160 / Math.max(width, height))),
    ),
  );
  thumbnail
    .getContext("2d")
    .drawImage(canvas, 0, 0, thumbnail.width, thumbnail.height);
  return {
    data: bytes.toString("base64"),
    mimeType: "image/png",
    width,
    height,
    originalWidth,
    originalHeight,
    thumbnail: `data:image/png;base64,${(await thumbnail.encode("png")).toString("base64")}`,
  };
}
if (parentPort)
  parentPort.once("message", async (work: AttachmentWork) => {
    try {
      parentPort!.postMessage({ result: await processAttachment(work) });
    } catch (error) {
      parentPort!.postMessage({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
if (!parentPort && process.send)
  process.once("message", async (work: AttachmentWork) => {
    try {
      process.send!({ result: await processAttachment(work) });
    } catch (error) {
      process.send!({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

const electronPort = (
  process as NodeJS.Process & {
    parentPort?: {
      on(
        event: "message",
        listener: (message: { data: AttachmentWork }) => void,
      ): void;
      postMessage(value: unknown): void;
    };
  }
).parentPort;
if (electronPort)
  electronPort.on("message", async ({ data }) => {
    try {
      electronPort.postMessage({ result: await processAttachment(data) });
    } catch (error) {
      electronPort.postMessage({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
