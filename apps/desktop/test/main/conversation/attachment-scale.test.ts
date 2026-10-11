import { it, expect } from "vitest";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AttachmentStore } from "../../../src/main/conversation/attachment-store.js";
it.skipIf(process.env.ARTEMIS_ATTACHMENT_SCALE !== "1")(
  "streams a 2 GiB text original through the disk index",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "artemis-attachment-scale-"));
    const started = Date.now();
    try {
      const path = join(root, "large.txt"),
        file = await open(path, "w");
      const block = Buffer.alloc(1024 * 1024, 65);
      try {
        for (let i = 0; i < 2048; i++) await file.write(block);
        await file.write(Buffer.from("FIRST"), 0, 5, 0);
        await file.write(Buffer.from("MIDDLE"), 0, 6, 1024 ** 3);
        await file.write(Buffer.from("LAST"), 0, 4, 2 * 1024 ** 3 - 4);
      } finally {
        await file.close();
      }
      const store = new AttachmentStore(join(root, "store"));
      const ref = await store.importPath(path);
      const saved = Date.now();
      expect(ref.size).toBe(2 * 1024 ** 3);
      expect(ref.status).toBe("pending");
      await store.bind("task", [ref]);
      await rm(path);
      const ready = await store.prepare(ref.id);
      const parsed = Date.now();
      expect(ready.status, ready.error).toBe("ready");
      expect(ready.characters).toBe(2 * 1024 ** 3);
      for (const [offset, marker] of [
        [0, "FIRST"],
        [1024 ** 3, "MIDDLE"],
        [2 * 1024 ** 3 - 4, "LAST"],
      ] as const)
        expect(
          JSON.stringify(
            await store.operate("task", {
              action: "read",
              id: ref.id,
              offset,
              maxTokens: 10,
            }),
          ),
        ).toContain(marker);
      console.log(
        JSON.stringify({
          bytes: ref.size,
          saveMs: saved - started,
          parseMs: parsed - saved,
          totalMs: Date.now() - started,
        }),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  300000,
);

import JSZip from "jszip";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
it
  .skipIf(process.env.ARTEMIS_ATTACHMENT_SCALE !== "1")
  .each(["docx", "xlsx", "pptx"])(
  "streams >100 MiB %s XML without whole-document AST",
  async (extension) => {
    const root = await mkdtemp(join(tmpdir(), "artemis-office-scale-"));
    try {
      const zip = new JSZip();
      const prefix =
        extension === "docx"
          ? "word/document.xml"
          : extension === "xlsx"
            ? "xl/worksheets/sheet1.xml"
            : "ppt/slides/slide1.xml";
      const block = "A".repeat(65536);
      async function* xml() {
        yield "<root>";
        for (let i = 0; i < 1664; i++) {
          const marker =
            i === 0
              ? "FIRST_MARK"
              : i === 832
                ? "MIDDLE_MARK"
                : i === 1663
                  ? "LAST_MARK"
                  : "";
          yield extension === "xlsx"
            ? `<row><c r="A${i + 1}" t="inlineStr"><is><t>${block}${marker}</t></is></c></row>`
            : `<p><t>${block}${marker}</t></p>`;
        }
        yield "</root>";
      }
      zip.file(prefix, Readable.from(xml()));
      const path = join(root, `large.${extension}`);
      await pipeline(
        zip.generateNodeStream({ streamFiles: true, compression: "STORE" }),
        createWriteStream(path),
      );
      const store = new AttachmentStore(join(root, "store"));
      const started = Date.now();
      const ref = await store.importPath(path);
      const saved = Date.now();
      expect(ref.size).toBeGreaterThan(100 * 1024 ** 2);
      await store.bind("task", [ref]);
      const ready = await store.prepare(ref.id);
      const parsed = Date.now();
      expect(ready.status, ready.error).toBe("ready");
      for (const marker of ["FIRST_MARK", "MIDDLE_MARK", "LAST_MARK"])
        expect(
          JSON.stringify(
            await store.operate("task", {
              action: "search",
              id: ref.id,
              query: marker,
            }),
          ),
        ).toContain(marker);
      await mkdir("artifacts/verification/attachment-on-demand/current", {
        recursive: true,
      });
      await appendFile(
        "artifacts/verification/attachment-on-demand/current/scale.jsonl",
        JSON.stringify({
          extension,
          bytes: ref.size,
          saveMs: saved - started,
          parseMs: parsed - saved,
          totalMs: Date.now() - started,
        }) + "\n",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  300000,
);
it.skipIf(process.env.ARTEMIS_ATTACHMENT_SCALE !== "1")(
  "reads a >100 MiB PDF using random access and page positions",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "artemis-pdf-scale-"));
    try {
      const path = join(root, "large.pdf"),
        file = await open(path, "w");
      let offset = 0;
      const offsets = [0];
      const write = async (value: string) => {
        const data = Buffer.from(value);
        await file.write(data);
        offset += data.length;
      };
      const object = async (id: number, content: string) => {
        offsets[id] = offset;
        await write(`${id} 0 obj\n${content}\nendobj\n`);
      };
      await write("%PDF-1.7\n");
      await object(1, "<< /Type /Catalog /Pages 2 0 R >>");
      await object(2, "<< /Type /Pages /Kids [3 0 R 6 0 R 8 0 R] /Count 3 >>");
      const page = (content: number) =>
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents ${content} 0 R >>`;
      await object(3, page(4));
      const command = "BT /F1 12 Tf 50 700 Td (FIRST_MARK) Tj ET\n";
      const padding = "%" + "A".repeat(65534) + "\n";
      offsets[4] = offset;
      await write(
        `4 0 obj\n<< /Length ${command.length + padding.length * 1664} >>\nstream\n`,
      );
      await write(command);
      for (let i = 0; i < 1664; i++) await write(padding);
      await write("endstream\nendobj\n");
      await object(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
      await object(6, page(7));
      const middle = "BT /F1 12 Tf 50 700 Td (MIDDLE_MARK) Tj ET\n";
      await object(
        7,
        `<< /Length ${middle.length} >>\nstream\n${middle}endstream`,
      );
      await object(8, page(9));
      const last = "BT /F1 12 Tf 50 700 Td (LAST_MARK) Tj ET\n";
      await object(9, `<< /Length ${last.length} >>\nstream\n${last}endstream`);
      const xref = offset;
      await write("xref\n0 10\n0000000000 65535 f \n");
      for (let i = 1; i < 10; i++)
        await write(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
      await write(
        `trailer\n<< /Size 10 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`,
      );
      await file.close();
      const store = new AttachmentStore(join(root, "store")),
        started = Date.now();
      const ref = await store.importPath(path),
        saved = Date.now();
      expect(ref.size).toBeGreaterThan(100 * 1024 ** 2);
      await store.bind("task", [ref]);
      const ready = await store.prepare(ref.id),
        parsed = Date.now();
      expect(ready.status, ready.error).toBe("ready");
      for (const [i, marker] of [
        "FIRST_MARK",
        "MIDDLE_MARK",
        "LAST_MARK",
      ].entries())
        expect(
          JSON.stringify(
            await store.operate("task", {
              action: "read",
              id: ref.id,
              page: i + 1,
            }),
          ),
        ).toContain(marker);
      await appendFile(
        "artifacts/verification/attachment-on-demand/current/scale.jsonl",
        JSON.stringify({
          extension: "pdf",
          bytes: ref.size,
          saveMs: saved - started,
          parseMs: parsed - saved,
          totalMs: Date.now() - started,
        }) + "\n",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  300000,
);
