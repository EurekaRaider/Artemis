import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { AttachmentStore } from "../src/main/attachment-store.js";

describe("attachment storage authorization and persistence", () => {
  it("binds originals to a task, rejects cross-task reads, and preserves forked originals", async () => {
    const root = await mkdtemp(join(tmpdir(), "artemis-attachment-store-"));
    try {
      const input = join(root, "input.txt");
      await writeFile(input, "original");
      const store = new AttachmentStore(join(root, "store"));
      const ref = await store.importPath(input);
      await store.bind("task-a", [ref]);
      await expect(store.bind("task-b", [ref])).rejects.toThrow(/another task/);
      await expect(
        store.operate("task-b", { action: "read", id: ref.id }),
      ).rejects.toThrow(/not available/);
      await store.copyThread("task-a", "task-c");
      await store.deleteThread("task-a");
      await rm(input);
      const reopened = new AttachmentStore(join(root, "store"));
      const result = await reopened.operate("task-c", {
        action: "read",
        id: ref.id,
      });
      expect(JSON.stringify(result)).toContain("original");
      await expect(
        reopened.operate("task-c", { action: "read", id: "../../input.txt" }),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { truncate } from "node:fs/promises";

describe("large documents and image normalization", () => {
  it("accepts 100 MiB originals and rejects larger files before reading", async () => {
    const root = await mkdtemp(join(tmpdir(), "artemis-attachment-size-"));
    try {
      const path = join(root, "large.txt");
      await writeFile(path, "");
      await truncate(path, 100 * 1024 * 1024);
      const store = new AttachmentStore(join(root, "store"));
      const ref = await store.importPath(path);
      expect(ref.size).toBe(100 * 1024 * 1024);
      expect(JSON.stringify(ref).length).toBeLessThan(1000);
      await truncate(path, 100 * 1024 * 1024 + 1);
      await expect(store.importPath(path)).rejects.toThrow(/100 MiB/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("retains PDF page positions including the last page and supports visual pages", async () => {
    const root = await mkdtemp(join(tmpdir(), "artemis-attachment-pdf-"));
    try {
      const doc = await PDFDocument.create(),
        font = await doc.embedFont(StandardFonts.Helvetica);
      doc.addPage().drawText("First page", { font });
      doc.addPage().drawText("LAST_PAGE_SENTINEL", { font });
      const path = join(root, "input.pdf");
      await writeFile(path, await doc.save());
      const store = new AttachmentStore(join(root, "store")),
        ref = await store.importPath(path);
      await store.bind("task", [ref]);
      const ready = await store.prepare(ref.id);
      expect(ready.status, ready.error).toBe("ready");
      expect(ready.pages).toBe(2);
      const text = await store.operate("task", {
        action: "read",
        id: ref.id,
        page: 2,
      });
      expect(JSON.stringify(text)).toContain("LAST_PAGE_SENTINEL");
      const search = await store.operate("task", {
        action: "search",
        id: ref.id,
        query: "LAST_PAGE",
      });
      expect(JSON.stringify(search)).toContain('"page":2');
      const image = (await store.operate("task", {
        action: "read",
        id: ref.id,
        page: 2,
        visual: true,
      })) as { data: string; width: number; height: number };
      expect(image.data.length).toBeGreaterThan(0);
      expect(
        Math.ceil(image.width / 32) * Math.ceil(image.height / 32),
      ).toBeLessThanOrEqual(2500);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20000);
  it("normalizes large transparent images and crops original coordinates", async () => {
    const root = await mkdtemp(join(tmpdir(), "artemis-attachment-image-"));
    try {
      const canvas = createCanvas(4000, 3000);
      canvas.getContext("2d").fillRect(100, 100, 100, 100);
      const path = join(root, "input.png");
      await writeFile(path, await canvas.encode("png"));
      const store = new AttachmentStore(join(root, "store")),
        ref = await store.importPath(path);
      await store.bind("task", [ref]);
      const ready = await store.prepare(ref.id);
      expect(ready.status, ready.error).toBe("ready");
      expect(ready.width).toBe(4000);
      const result = (await store.operate("task", {
        action: "read",
        id: ref.id,
      })) as { width: number; height: number };
      expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(2048);
      expect(
        Math.ceil(result.width / 32) * Math.ceil(result.height / 32),
      ).toBeLessThanOrEqual(2500);
      const crop = (await store.operate("task", {
        action: "read",
        id: ref.id,
        crop: { x: 100, y: 100, width: 100, height: 100 },
      })) as { width: number };
      expect(crop.width).toBe(100);
      await expect(
        store.operate("task", {
          action: "read",
          id: ref.id,
          crop: { x: 3999, y: 0, width: 10, height: 10 },
        }),
      ).rejects.toThrow(/outside/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20000);
  it("bounds Chinese output and resumes without losing the tail", async () => {
    const root = await mkdtemp(join(tmpdir(), "artemis-attachment-unicode-"));
    try {
      const store = new AttachmentStore(join(root, "store"));
      const ref = await store.importInline({
        type: "file",
        name: "中文.txt",
        mimeType: "text/plain",
        content: "中".repeat(5000) + "末尾",
      });
      await store.bind("task", [ref]);
      const first = (await store.operate("task", {
        action: "read",
        id: ref.id,
        maxTokens: 100,
      })) as { text: string; nextOffset: number };
      expect(Buffer.byteLength(first.text)).toBeLessThanOrEqual(100);
      expect(first.text).not.toContain("\uFFFD");
      const last = (await store.operate("task", {
        action: "read",
        id: ref.id,
        offset: 4998,
      })) as { text: string };
      expect(last.text).toContain("末尾");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

import { attachmentImageDimensions } from "../src/main/attachment-worker.js";
it("rejects pathological image dimensions before native decoding", () => {
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(100000, 16);
  bytes.writeUInt32BE(100000, 20);
  expect(() => attachmentImageDimensions(bytes)).toThrow(/100 megapixel/);
});

it("reports empty scanned pages honestly while retaining visual access and cancellation", async () => {
  const root = await mkdtemp(join(tmpdir(), "artemis-attachment-empty-"));
  try {
    const doc = await PDFDocument.create();
    doc.addPage();
    const path = join(root, "scan.pdf");
    await writeFile(path, await doc.save());
    const store = new AttachmentStore(join(root, "store"));
    const ref = await store.importPath(path);
    await store.bind("task", [ref]);
    const ready = await store.prepare(ref.id);
    expect(ready.status).toBe("error");
    expect(ready.error).toContain("No extractable text");
    const image = await store.operate("task", {
      action: "read",
      id: ref.id,
      page: 1,
      visual: true,
    });
    expect(image).toHaveProperty("data");
    const cancelled = await store.importPath(path);
    const controller = new AbortController();
    controller.abort();
    expect((await store.prepare(cancelled.id, controller.signal)).status).toBe(
      "error",
    );
    await store.bind("retained", [cancelled]);
    expect(await store.list("retained")).toHaveLength(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 20000);
