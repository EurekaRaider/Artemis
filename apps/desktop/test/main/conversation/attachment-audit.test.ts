import { it, expect } from "vitest";
import { mkdtemp, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { estimateTextTokens } from "@artemis/protocol";
import { AttachmentStore } from "../../../src/main/conversation/attachment-store.js";
async function fixture(
  run: (store: AttachmentStore, root: string) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "artemis-attachment-audit-"));
  try {
    await run(new AttachmentStore(join(root, "store")), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
it("budgets the serialized read result including escaping and locations", () =>
  fixture(async (store, root) => {
    const path = join(root, "quoted.txt");
    await writeFile(path, '"\\\t\n'.repeat(5000));
    const ref = await store.importPath(path);
    await store.bind("task", [ref]);
    const result = await store.operate("task", {
      action: "read",
      id: ref.id,
      maxTokens: 300,
    });
    expect(estimateTextTokens(JSON.stringify(result))).toBeLessThanOrEqual(300);
  }));
it("rejects exhausted budget before starting parsing and disallows out-of-scope IDs", () =>
  fixture(async (store, root) => {
    const path = join(root, "file.txt");
    await writeFile(path, "text");
    const ref = await store.importPath(path);
    await store.bind("task", [ref]);
    await expect(
      store.operate("task", { action: "read", id: ref.id, maxTokens: 0 }),
    ).rejects.toThrow(/budget/);
    expect(await readdir(join(root, "store", ref.id))).not.toContain(
      "text.sqlite",
    );
    await expect(
      store.operate("task", { action: "read", id: ref.id, ids: [] }),
    ).rejects.toThrow(/scope|message/);
    await expect(store.previewFile(ref.id)).rejects.toThrow(/task|bound/);
  }));
it("honors cancellation even for cached parses", () =>
  fixture(async (store, root) => {
    const path = join(root, "file.txt");
    await writeFile(path, "text");
    const ref = await store.importPath(path);
    await store.prepare(ref.id);
    const abort = new AbortController();
    abort.abort();
    await expect(store.prepare(ref.id, abort.signal)).rejects.toThrow();
  }));
it("retains Office CDATA and shared-formula metadata, and rejects missing shared strings", () =>
  fixture(async (store, root) => {
    const zip = new JSZip();
    zip.file(
      "xl/worksheets/sheet1.xml",
      '<worksheet><row><c r="A1"><f t="shared" si="0" ref="A1:A2">SUM(B1:C1)</f><v>3</v></c><c r="A2"><f t="shared" si="0"/><v>4</v></c><c r="B1" t="inlineStr"><is><t><![CDATA[CDATA_MARK]]></t></is></c></row></worksheet>',
    );
    const path = join(root, "book.xlsx");
    await writeFile(path, await zip.generateAsync({ type: "nodebuffer" }));
    let ref = await store.importPath(path);
    await store.bind("task", [ref]);
    let result = JSON.stringify(
      await store.operate("task", { action: "read", id: ref.id }),
    );
    expect(result).toContain("CDATA_MARK");
    expect(result).toContain("shared");
    expect(result).toContain("A1:A2");
    zip.file(
      "xl/worksheets/sheet1.xml",
      '<worksheet><row><c r="A1" t="s"><v>999</v></c></row></worksheet>',
    );
    await writeFile(path, await zip.generateAsync({ type: "nodebuffer" }));
    ref = await store.importPath(path);
    expect((await store.prepare(ref.id)).status).toBe("error");
  }));
it("returns Unicode search offsets in the original text", () =>
  fixture(async (store, root) => {
    const path = join(root, "unicode.txt");
    const content = "İİİ hello TARGET tail";
    await writeFile(path, content);
    const ref = await store.importPath(path);
    await store.bind("task", [ref]);
    const result = (await store.operate("task", {
      action: "search",
      id: ref.id,
      query: "TARGET",
    })) as { matches: Array<{ offset: number }> };
    expect(result.matches[0]?.offset).toBe(content.indexOf("TARGET"));
  }));
it("cancels one waiter without cancelling another reader of the same original", () =>
  fixture(async (store, root) => {
    const path = join(root, "shared.txt");
    await writeFile(path, "large text ".repeat(100000));
    const ref = await store.importPath(path);
    const first = new AbortController();
    const reading = store.prepare(ref.id, first.signal);
    const rejected = expect(reading).rejects.toThrow(/cancelled/);
    const surviving = store.prepare(ref.id);
    first.abort();
    await rejected;
    expect((await surviving).status).toBe("ready");
  }));
it("reads BOM-tagged UTF-16 text across streaming boundaries", () =>
  fixture(async (store, root) => {
    const path = join(root, "utf16.txt");
    const text = "\uFEFF" + "中文😀".repeat(20000) + "END";
    await writeFile(path, Buffer.from(text, "utf16le"));
    const ref = await store.importPath(path);
    await store.bind("task", [ref]);
    const result = (await store.operate("task", {
      action: "read",
      id: ref.id,
      offset: text.length - 3,
    })) as { text: string };
    expect(result.text).toBe("END");
  }));

it("reads empty PDF pages honestly and includes form values", () =>
  fixture(async (store, root) => {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage().drawText("Body", { font });
    doc.addPage();
    const formPage = doc.addPage();
    const field = doc.getForm().createTextField("Account");
    field.setText("FORM_VALUE");
    field.addToPage(formPage);
    const path = join(root, "form.pdf");
    await writeFile(path, await doc.save());
    const ref = await store.importPath(path);
    await store.bind("task", [ref]);
    expect(
      await store.operate("task", { action: "read", id: ref.id, page: 2 }),
    ).toMatchObject({ text: "", empty: true, visualReadingRequired: true });
    expect(
      JSON.stringify(
        await store.operate("task", { action: "read", id: ref.id, page: 3 }),
      ),
    ).toContain("FORM_VALUE");
  }));
it("restarts two readers safely after cancelling the last parse waiter", () =>
  fixture(async (store, root) => {
    const path = join(root, "restart.txt");
    await writeFile(path, "text ".repeat(100000));
    const ref = await store.importPath(path);
    const controller = new AbortController();
    const first = store.prepare(ref.id, controller.signal);
    const rejection = expect(first).rejects.toThrow(/cancelled/);
    controller.abort();
    await rejection;
    const results = await Promise.all([
      store.prepare(ref.id),
      store.prepare(ref.id),
    ]);
    expect(results.map((r) => r.status)).toEqual(["ready", "ready"]);
  }));
it("fits list and search envelopes and traverses every escaped character", () =>
  fixture(async (store, root) => {
    const content = '"\\\t\n'.repeat(200);
    const path = join(root, "quoted.txt");
    await writeFile(path, content);
    const ref = await store.importPath(path);
    await store.bind("task", [ref]);
    const listed = await store.operate("task", {
      action: "list",
      maxTokens: 300,
    });
    expect(estimateTextTokens(JSON.stringify(listed))).toBeLessThanOrEqual(300);
    const search = await store.operate("task", {
      action: "search",
      query: '"',
      maxTokens: 300,
    });
    expect(estimateTextTokens(JSON.stringify(search))).toBeLessThanOrEqual(300);
    let offset: number | undefined = 0,
      full = "";
    while (offset !== undefined) {
      const result = (await store.operate("task", {
        action: "read",
        id: ref.id,
        offset,
        maxTokens: 300,
      })) as { text: string; nextOffset?: number; complete: boolean };
      expect(estimateTextTokens(JSON.stringify(result))).toBeLessThanOrEqual(
        300,
      );
      expect(result.complete).toBe(result.nextOffset === undefined);
      full += result.text;
      offset = result.nextOffset;
    }
    expect(full).toBe(content);
  }));

it("preserves shared-string Unicode at disk segment boundaries", () =>
  fixture(async (store, root) => {
    const zip = new JSZip();
    const value = "A".repeat(16383) + "😀TAIL";
    zip.file("xl/sharedStrings.xml", `<sst><si><t>${value}</t></si></sst>`);
    zip.file(
      "xl/worksheets/sheet1.xml",
      '<worksheet><row><c r="A1" t="s"><v>0</v></c></row></worksheet>',
    );
    const path = join(root, "unicode.xlsx");
    await writeFile(path, await zip.generateAsync({ type: "nodebuffer" }));
    const ref = await store.importPath(path);
    await store.bind("task", [ref]);
    const result = (await store.operate("task", {
      action: "search",
      id: ref.id,
      query: "😀TAIL",
    })) as { matches: unknown[] };
    expect(result.matches).toHaveLength(1);
  }));

it("enforces tiny budgets on empty directories and reads empty text originals", () =>
  fixture(async (store, root) => {
    await expect(
      store.operate("task", { action: "list", maxTokens: 1 }),
    ).rejects.toThrow(/budget/);
    await expect(
      store.operate("task", { action: "search", query: "test", maxTokens: 1 }),
    ).rejects.toThrow(/budget/);
    const path = join(root, "empty.txt");
    await writeFile(path, "");
    const ref = await store.importPath(path);
    await store.bind("task", [ref]);
    expect(
      await store.operate("task", { action: "read", id: ref.id }),
    ).toMatchObject({ text: "", empty: true, complete: true });
  }));
