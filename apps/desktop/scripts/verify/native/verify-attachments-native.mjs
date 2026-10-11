import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron } from "playwright-core";
import JSZip from "jszip";
import { PDFDocument, StandardFonts } from "pdf-lib";

const require = createRequire(import.meta.url);
const output = resolve(
  process.env.ARTEMIS_ATTACHMENT_EVIDENCE ??
    "artifacts/verification/attachment-on-demand/native",
);
await mkdir(output, { recursive: true });
const root = await mkdtemp(join(tmpdir(), "Artemis-附件验证-"));
const profile = join(root, "profile");
const executable = process.env.ARTEMIS_ATTACHMENT_EXE;
const report = {
  platform: process.platform,
  arch: process.arch,
  packaged: !!executable,
  checks: [],
};
let app;
try {
  const paths = [];
  for (let i = 0; i < 1000; i++) {
    const path = join(root, `sample-${i}.txt`);
    await writeFile(path, `Original ${i}`);
    paths.push(path);
  }
  const text = '中文😀"\\\t\n'.repeat(3000) + "COMPLETE_TAIL";
  const fixtures = [
    {
      name: "utf16.txt",
      bytes: Buffer.from("\uFEFF" + text, "utf16le"),
      expected: "\uFEFF" + text,
    },
  ];
  for (const [name, part, xml, expected] of [
    [
      "body.docx",
      "word/document.xml",
      "<document><p><t><![CDATA[DOCX_TAIL]]></t></p></document>",
      "DOCX_TAIL",
    ],
    [
      "book.xlsx",
      "xl/worksheets/sheet1.xml",
      '<worksheet><row><c r="A1"><f t="shared" si="0" ref="A1:A2">1+2</f><v>3</v></c></row></worksheet>',
      "formula=1+2; cached=3",
    ],
    [
      "slides.pptx",
      "ppt/notesSlides/notesSlide1.xml",
      "<notes><p><t>PPTX_NOTES_TAIL</t></p></notes>",
      "PPTX_NOTES_TAIL",
    ],
  ]) {
    const zip = new JSZip();
    zip.file(part, xml);
    fixtures.push({
      name,
      bytes: await zip.generateAsync({ type: "nodebuffer" }),
      expected,
    });
  }
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText("PDF_FIRST", { font });
  pdf.addPage();
  pdf.addPage().drawText("PDF_LAST", { font });
  fixtures.push({
    name: "pages.pdf",
    bytes: await pdf.save(),
    expected: "PDF_LAST",
  });
  fixtures.push({
    name: "image.png",
    bytes: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    ),
    image: true,
  });
  for (const fixture of fixtures) {
    fixture.path = join(root, fixture.name);
    await writeFile(fixture.path, fixture.bytes);
  }
  async function launch() {
    app = await electron.launch({
      executablePath: executable ?? require("electron"),
      args: [
        ...(executable ? [] : [resolve("apps/desktop")]),
        `--user-data-dir=${profile}`,
      ],
      env: { ...process.env, ARTEMIS_DISABLE_AUTO_UPDATE: "1" },
    });
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!window.artemis);
    return page;
  }
  let page = await launch();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths });
  }, paths);
  await page.locator(".composer-leading > .composer-icon-button").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".composer-resource-chip").length === 50,
    { timeout: 60000 },
  );
  await page.getByRole("button", { name: "→", exact: true }).click();
  assert.equal(
    await page.getByText("51–100 / 1000", { exact: true }).count(),
    1,
  );
  assert.equal((await readdir(join(profile, "attachments"))).length, 1000);
  const directories = await readdir(join(profile, "attachments"));
  for (const id of directories)
    assert(
      !(await readdir(join(profile, "attachments", id))).includes(
        "text.sqlite",
      ),
    );
  report.checks.push(
    "1000 distinct originals; 50-item UI pagination; no eager parsing",
  );
  await page.screenshot({ path: join(output, "attachments.png") });
  await app.evaluate(
    ({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: paths,
      });
    },
    fixtures.map((f) => f.path),
  );
  const imported = await page.evaluate(() =>
    window.artemis.selectPromptAttachments(),
  );
  assert.deepEqual(imported.errors, []);
  assert.equal(imported.attachments.length, fixtures.length);
  for (const fixture of fixtures) await rm(fixture.path);
  for (const ref of imported.attachments) {
    const fixture = fixtures.find((f) => f.name === ref.name);
    if (fixture.image) {
      const image = await page.evaluate(
        (id) => window.artemis.previewPromptAttachment(id),
        ref.id,
      );
      assert(image.data.length > 0);
      continue;
    }
    let offset = 0,
      full = "";
    do {
      const result = await page.evaluate(
        ({ id, offset }) => window.artemis.previewPromptFile(id, offset),
        { id: ref.id, offset },
      );
      full += result.text;
      assert(result.nextOffset === undefined || result.nextOffset > offset);
      offset = result.nextOffset;
    } while (offset !== undefined);
    if (fixture.name === "utf16.txt") assert.equal(full, fixture.expected);
    else
      assert(full.includes(fixture.expected), `${fixture.name}: missing tail`);
  }
  report.checks.push(
    "originals survive source removal; native utility-process text/PDF/Office/image parsing; full UTF-16 pagination",
  );
  async function utilityWork(work, interrupt = false) {
    return app.evaluate(
      async ({ app, utilityProcess }, { work, interrupt }) =>
        new Promise((resolve, reject) => {
          const child = utilityProcess.fork(
            app.getAppPath() + "/dist-electron/attachment-worker.js",
            [],
            { stdio: "ignore" },
          );
          let finished = false;
          const timer = setTimeout(() => {
            child.kill();
            reject(new Error("Attachment worker timed out"));
          }, 60000);
          child.on("message", (message) => {
            if (finished || (message.progress && !interrupt)) return;
            finished = true;
            clearTimeout(timer);
            child.once("exit", () =>
              message.error
                ? reject(new Error(message.error))
                : resolve(
                    message.progress ? { interrupted: true } : message.result,
                  ),
            );
            child.kill();
          });
          child.postMessage(work);
        }),
      { work, interrupt },
    );
  }
  const pdfRef = imported.attachments.find((ref) => ref.name === "pages.pdf");
  const visual = await utilityWork({
    action: "image",
    path: join(profile, "attachments", pdfRef.id, "original"),
    mimeType: "application/pdf",
    page: 1,
  });
  assert(visual.data.length > 100 && visual.width > 0);
  report.checks.push(
    "PDF page visual rendering inside the Electron utility process",
  );
  const recoveryPath = join(root, "recovery.txt"),
    indexPath = join(root, "recovery.sqlite");
  const recoveryText = "恢复😀".repeat(1000000) + "RECOVERED_TAIL";
  await writeFile(recoveryPath, recoveryText);
  const parse = {
    action: "parse",
    path: recoveryPath,
    output: indexPath,
    mimeType: "text/plain",
  };
  assert.deepEqual(await utilityWork(parse, true), { interrupted: true });
  assert((await readdir(root)).includes("recovery.sqlite.partial"));
  const resumed = await utilityWork(parse);
  assert.equal(resumed.characters, recoveryText.length);
  const tail = await utilityWork({
    action: "read",
    path: indexPath,
    mimeType: "text/plain",
    offset: recoveryText.length - 14,
  });
  assert(tail.text.endsWith("RECOVERED_TAIL"));
  report.checks.push(
    "kill native parser after checkpoint, resume SQLite index with exact character count and tail",
  );

  assert.deepEqual(errors, []);
  await app.close();
  app = undefined;
  page = await launch();
  const ref = imported.attachments[0];
  const preview = await page.evaluate(
    (id) => window.artemis.previewPromptFile(id),
    ref.id,
  );
  assert(preview.text.length > 0);
  report.checks.push(
    "saved originals and index reopen after application restart",
  );
  report.electron = await app.evaluate(() => ({
    electron: process.versions.electron,
    arch: process.arch,
    platform: process.platform,
  }));
  await app.close();
  app = undefined;
  // Confirm the original remains a separate local copy in the app profile.
  assert(
    (await readFile(join(profile, "attachments", ref.id, "original"))).equals(
      fixtures[0].bytes,
    ),
  );
  report.passed = true;
} catch (error) {
  report.error = String(error?.stack ?? error);
  throw error;
} finally {
  if (app) await app.close();
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 300,
  });
}
