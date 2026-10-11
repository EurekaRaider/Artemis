import { imageHeaderDimensions as attachmentImageDimensions } from "@artemis/platform";
export { attachmentImageDimensions };

import { parentPort } from "node:worker_threads";
import { readFile, rename, open } from "node:fs/promises";
import { AttachmentIndex, indexText, readIndex } from "./attachment-index.ts";
import type { Canvas, Image } from "@napi-rs/canvas";

export interface AttachmentWork {
  action: "parse" | "image" | "read" | "search";
  id?: string;
  part?: string | undefined;
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
let lastProgress = 0;
function progress() {
  if (Date.now() - lastProgress < 250) return;
  lastProgress = Date.now();
  const message = { progress: true };
  if (parentPort) parentPort.postMessage(message);
  else if (process.send) process.send(message);
  else electronPort?.postMessage(message);
}
async function openPdf(path: string) {
  const { createCanvas, DOMMatrix, Path2D, ImageData } =
    await import("@napi-rs/canvas");
  // PDF.js excludes Electron utility processes from its Node detection.
  // Supply native canvas primitives and its in-process worker explicitly;
  // the surrounding utility process remains the isolation/cancellation boundary.
  Object.assign(globalThis, { DOMMatrix, Path2D, ImageData });
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = import.meta
    .resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
  class CanvasFactory {
    create(width: number, height: number) {
      const canvas = createCanvas(width, height);
      return { canvas, context: canvas.getContext("2d") };
    }
    reset(target: { canvas: Canvas }, width: number, height: number) {
      target.canvas.width = width;
      target.canvas.height = height;
    }
    destroy(target: { canvas: Canvas | null; context: unknown }) {
      if (target.canvas) {
        target.canvas.width = 0;
        target.canvas.height = 0;
      }
      target.canvas = null;
      target.context = null;
    }
  }
  // Match PDF.js's Node filter behavior: no DOM/SVG filters in native canvas.
  class FilterFactory {
    addFilter() {
      return "none";
    }
    addHCMFilter = this.addFilter;
    addAlphaFilter = this.addFilter;
    addLuminosityFilter = this.addFilter;
    addKnockoutFilter = this.addFilter;
    addHighlightHCMFilter = this.addFilter;
    addSelectionHCMFilter = this.addFilter;
    addSelectionFilter = this.addFilter;
    createSelectionStyle() {
      return null;
    }
    destroy() {}
  }
  const file = await open(path, "r");
  const size = (await file.stat()).size;
  const initial = Buffer.alloc(Math.min(65536, size));
  await file.read(initial, 0, initial.length, 0);
  class Range extends pdfjs.PDFDataRangeTransport {
    override requestDataRange(begin: number, end: number) {
      const bytes = Buffer.alloc(end - begin);
      void file
        .read(bytes, 0, bytes.length, begin)
        .then(({ bytesRead }) =>
          this.onDataRange(begin, new Uint8Array(bytes.subarray(0, bytesRead))),
        );
    }
  }
  const loading = pdfjs.getDocument({
    range: new Range(size, new Uint8Array(initial)),
    disableAutoFetch: true,
    disableStream: true,
    useSystemFonts: true,
    disableFontFace: true,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    useWorkerFetch: false,
    CanvasFactory: CanvasFactory as never,
    FilterFactory: FilterFactory as never,
  });
  return {
    loading,
    close: async () => {
      await loading.destroy();
      await file.close();
    },
  };
}
export async function processAttachment(
  work: AttachmentWork,
): Promise<unknown> {
  if (work.action === "read" || work.action === "search")
    return readIndex(work, progress);
  if (work.action === "parse") {
    if (!work.output) throw new Error("Index output is required");
    const partial = `${work.output}.partial`;
    const index = new AttachmentIndex(partial, true);
    let result;
    try {
      let pages: number | undefined;
      if (work.mimeType === "application/pdf") {
        const pdf = await openPdf(work.path);
        try {
          const doc = await pdf.loading.promise;
          pages = doc.numPages;
          for (let n = 1; n <= pages; n++) {
            if (
              index.db
                .prepare("SELECT name FROM parts WHERE name=?")
                .get(`page:${n}`)
            )
              continue;
            index.db.exec("BEGIN");
            const page = await doc.getPage(n);
            let hasText = false;
            const reader = page.streamTextContent().getReader();
            try {
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                for (const item of value.items)
                  if ("str" in item) {
                    hasText ||= !!item.str.trim();
                    index.add(
                      item.str + (item.hasEOL ? "\n" : " "),
                      n,
                      `page ${n}`,
                    );
                  }
                progress();
              }
            } finally {
              reader.releaseLock();
            }
            const annotations = await page.getAnnotations();
            for (const note of annotations)
              if (note.contentsObj?.str)
                index.add(
                  `\nAnnotation: ${note.contentsObj.str}\n`,
                  n,
                  `page ${n} annotation`,
                );
            for (const note of annotations)
              if (note.fieldName || note.fieldValue !== undefined)
                index.add(
                  `\nForm field ${note.fieldName ?? ""}: ${JSON.stringify(note.fieldValue ?? "")}\n`,
                  n,
                  `page ${n} form`,
                );
            if (hasText) index.add("\n", n, `page ${n}`);
            else
              index.db
                .prepare("INSERT OR IGNORE INTO parts VALUES (?)")
                .run(`empty-page:${n}`);
            index.db.prepare("INSERT INTO parts VALUES (?)").run(`page:${n}`);
            index.db.exec("COMMIT");
            page.cleanup();
            progress();
          }
        } finally {
          await pdf.close();
        }
      } else if (/officedocument/.test(work.mimeType)) {
        const { indexOffice } = await import("./attachment-office-index.ts");
        await indexOffice(work.path, index, progress);
      } else await indexText(work.path, index, progress);
      result = index.finish(pages);
    } finally {
      index.close();
    }
    await rename(partial, work.output);
    return result;
  }
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  let source: Image | Canvas;
  if (work.mimeType === "application/pdf") {
    const pdf = await openPdf(work.path);
    const loading = pdf.loading;
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
      await pdf.close();
    }
  } else if (work.part) {
    const { officeImage } = await import("./attachment-office-index.ts");
    const bytes = await officeImage(work.path, work.part);
    attachmentImageDimensions(bytes);
    source = await loadImage(bytes);
  } else {
    const input = await open(work.path, "r");
    const info = await input.stat();
    try {
      if (info.size > 256 * 1024 * 1024)
        throw new Error("Image decoding exceeds the 256 MiB resource limit");
      const header = Buffer.alloc(Math.min(info.size, 65536));
      await input.read(header, 0, header.length, 0);
      attachmentImageDimensions(header);
    } finally {
      await input.close();
    }
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
