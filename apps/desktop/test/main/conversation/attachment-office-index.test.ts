import { it, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { AttachmentStore } from "../../../src/main/conversation/attachment-store.js";

it.each(["docx", "xlsx", "pptx"])(
  "indexes all %s XML parts including auxiliary content",
  async (extension) => {
    const root = await mkdtemp(join(tmpdir(), "artemis-office-index-"));
    try {
      const zip = new JSZip();
      if (extension === "docx") {
        for (const name of [
          "document",
          "header1",
          "footer1",
          "footnotes",
          "endnotes",
          "comments",
        ])
          zip.file(
            `word/${name}.xml`,
            `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>MARK_${name}</w:t></w:r></w:p></w:document>`,
          );
      } else if (extension === "pptx") {
        for (const name of [
          "slides/slide1",
          "notesSlides/notesSlide1",
          "comments/comment1",
          "slideMasters/slideMaster1",
        ])
          zip.file(
            `ppt/${name}.xml`,
            `<a:root xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:p><a:r><a:t>MARK_${name}</a:t></a:r></a:p></a:root>`,
          );
      } else {
        zip.file(
          "xl/sharedStrings.xml",
          "<sst><si><t>SHARED_首中尾</t></si></sst>",
        );
        zip.file(
          "xl/workbook.xml",
          '<workbook><sheets><sheet name="隐藏表" sheetId="2" state="hidden"/></sheets></workbook>',
        );
        zip.file(
          "xl/worksheets/sheet2.xml",
          '<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1"><f>SUM(1,2)</f><v>3</v></c></row></sheetData></worksheet>',
        );
        zip.file(
          "xl/comments1.xml",
          '<comments><comment ref="A1"><text><t>COMMENT_MARK</t></text></comment></comments>',
        );
      }
      const path = join(root, `input.${extension}`);
      await writeFile(path, await zip.generateAsync({ type: "nodebuffer" }));
      const store = new AttachmentStore(join(root, "store"));
      const ref = await store.importPath(path);
      await store.bind("task", [ref]);
      const result = JSON.stringify(
        await store.operate("task", { action: "read", id: ref.id }),
      );
      if (extension === "xlsx")
        for (const marker of [
          "SHARED_首中尾",
          "隐藏表",
          "hidden",
          "SUM(1,2)",
          "cached=3",
          "COMMENT_MARK",
        ])
          expect(result).toContain(marker);
      else
        for (const entry of Object.keys(zip.files).filter((p) =>
          p.endsWith(".xml"),
        ))
          expect(result).toContain(
            `MARK_${entry.replace(/^(word|ppt)\//, "").replace(/\.xml$/, "")}`,
          );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  20000,
);
it("preserves originals when corrupt or encrypted Office parsing fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "artemis-office-errors-"));
  try {
    const store = new AttachmentStore(join(root, "store"));
    const zip = new JSZip();
    zip.file("word/document.xml", "<root><t>text</t></root>");
    const encrypted = await zip.generateAsync({
      type: "nodebuffer",
      compression: "STORE",
    });
    encrypted.writeUInt16LE(encrypted.readUInt16LE(6) | 1, 6);
    const central = encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    encrypted.writeUInt16LE(
      encrypted.readUInt16LE(central + 8) | 1,
      central + 8,
    );
    for (const [name, bytes] of [
      ["corrupt.docx", Buffer.from("broken")],
      ["encrypted.docx", encrypted],
    ] as const) {
      const path = join(root, name);
      await writeFile(path, bytes);
      const ref = await store.importPath(path);
      expect(ref.status).toBe("pending");
      const result = await store.prepare(ref.id);
      expect(result.status).toBe("error");
      expect(result.error).toBeTruthy();
      const { readFile } = await import("node:fs/promises");
      expect(await readFile(join(root, "store", ref.id, "original"))).toEqual(
        bytes,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
