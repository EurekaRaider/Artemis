import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scan } from "./nocturne-review06-scan.mjs";
import { probeControlStates } from "./nocturne-review06-state-probes.mjs";
import { review06Variants } from "../../../test/fixtures/nocturne-review06.mjs";
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const output = resolve(
  process.argv[2] ?? "artifacts/verification/ui-redesign/review-06/local",
);
const runtime = join(output, "supplemental-runtime");
await mkdir(runtime, { recursive: true });
await build({
  entryPoints: [
    join(desktop, "scripts/fixtures/nocturne-review06-supplemental.tsx"),
  ],
  bundle: true,
  format: "esm",
  platform: "browser",
  outdir: runtime,
  loader: {
    ".woff2": "file",
    ".woff": "file",
    ".ttf": "file",
    ".svg": "file",
    ".png": "file",
  },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "silent",
});
await writeFile(
  join(runtime, "index.html"),
  '<!doctype html><html><head><meta charset="utf-8"><title>Artemis UI fixture</title><link rel="stylesheet" href="./nocturne-review06-supplemental.css"></head><body style="margin:0"><div id="root"></div><script type="module" src="./nocturne-review06-supplemental.js"></script></body></html>',
);
await writeFile(
  join(runtime, "main.cjs"),
  'const {app,BrowserWindow}=require("electron");app.setPath("userData",__dirname+"/profile");app.whenReady().then(()=>new BrowserWindow({width:1440,height:900,useContentSize:true,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}}).loadURL("about:blank"));',
);
const require = createRequire(import.meta.url),
  { _electron } = require("playwright-core");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({
  executablePath: require("electron"),
  args: [join(runtime, "main.cjs")],
  env,
});
const records = [];
const controlFamilies = new Set();
try {
  const page = await app.firstWindow();
  for (const variant of review06Variants)
    for (const state of [
      "csv",
      "notifications",
      "update-announcement",
      "icons",
      "icons12",
      "icons14",
      "icons24",
      "resource-icons",
      "controls",
      "attachments",
    ]) {
      const id = `${state}-${variant.theme}-${variant.locale}`;
      const record = {
        id,
        state,
        ...variant,
        kind: "isolated production component; synthetic UI props; no backend or capabilities",
        checks: [],
        scans: [],
        screenshots: [],
        errors: [],
      };
      const check = (name, actual, pass) =>
        record.checks.push({ name, actual, pass: Boolean(pass) });
      const errorListener = (error) => record.errors.push(error.message);
      page.on("pageerror", errorListener);
      try {
        await page.setViewportSize({
          width: 1440,
          height:
            state.startsWith("icons") || state === "resource-icons"
              ? 1800
              : 900,
        });
        await page.goto(
          `file://${join(runtime, "index.html")}?view=${state}&theme=${variant.theme}&locale=${variant.locale}`,
        );
        await page.waitForSelector(".app-shell");
        await page.evaluate(() => document.fonts.ready);
        if (state === "csv") {
          check(
            "CSV table rows",
            await page.locator(".workspace-csv-preview tbody tr").count(),
            (await page.locator(".workspace-csv-preview tbody tr").count()) >=
              3,
          );
          await page.locator(".workspace-csv-preview td").first().click();
        }
        if (state === "attachments") {
          await page.getByText("retrieval-survey.pdf", { exact: false }).waitFor();
          check("ready attachment and selected skill", {
            attachments: await page.locator(".composer-image-strip .composer-resource-chip").count(),
            skills: await page.locator(".composer-selected-skill").count(),
          }, (await page.locator(".composer-image-strip .composer-resource-chip").count()) === 1 && (await page.locator(".composer-selected-skill").count()) === 1);
        }
        if (state === "notifications")
          check(
            "notification stack",
            await page.locator('[data-artemis-component="toast"]').count(),
            (await page.locator('[data-artemis-component="toast"]').count()) ===
              3,
          );
        if (state === "update-announcement")
          check(
            "real update dialog",
            await page.locator(".update-announcement").count(),
            (await page.locator(".update-announcement").count()) === 1,
          );
        if (state.startsWith("icons")) {
          const catalog = await page
            .locator(".fixture-icons")
            .evaluate((element) => {
              const expected = Number(element.dataset.expectedIcons);
              const size = Number(element.dataset.iconSize);
              const glyphs = [
                ...element.querySelectorAll(
                  "[data-icon-catalog-entry] svg[data-artemis-icon]",
                ),
              ];
              return {
                expected,
                size,
                count: glyphs.length,
                unique: new Set(glyphs.map((icon) => icon.dataset.artemisIcon))
                  .size,
                wrongSizes: glyphs
                  .filter(
                    (icon) =>
                      Math.abs(icon.getBoundingClientRect().width - size) >
                        0.01 ||
                      Math.abs(icon.getBoundingClientRect().height - size) >
                        0.01,
                  )
                  .map((icon) => icon.dataset.artemisIcon),
              };
            });
          check(
            "production icon library rendered",
            catalog,
            catalog.count === catalog.expected &&
              catalog.unique === catalog.expected &&
              catalog.wrongSizes.length === 0,
          );
        }
        if (state === "resource-icons")
          check(
            "production resource icon library rendered",
            await page
              .locator(".fixture-resource-icons .resource-avatar")
              .count(),
            (await page
              .locator(".fixture-resource-icons .resource-avatar")
              .count()) >= 50,
          );
        if (state === "controls")
          check(
            "public component states",
            await page.locator(":disabled").count(),
            (await page.locator(":disabled").count()) >= 3,
          );
        const filename = `${id}.png`;
        await page.screenshot({ path: join(output, filename), scale: "css" });
        record.screenshots.push(filename);
        record.scans.push({ screenshot: filename, ...(await scan(page)) });
        record.controlStates = await probeControlStates(
          page,
          output,
          record,
          controlFamilies,
        );
        check(
          "control state probes",
          record.controlStates.filter((state) => state.error),
          record.controlStates.every((state) => !state.error),
        );
        check(
          "generic scan",
          record.scans[0].violations,
          !record.scans[0].violations.length,
        );
        check("console health", record.errors, !record.errors.length);
        if (state === "attachments") {
          const progress = await page.getByRole("progressbar").evaluate((element) => ({
            value: element.getAttribute("aria-valuenow"),
            height: element.getBoundingClientRect().height,
            ratio: element.firstElementChild.getBoundingClientRect().width / element.getBoundingClientRect().width,
          }));
          check("copy progress uses its actual byte ratio", progress,
            progress.value === "64" && Math.abs(progress.height - 3) < 0.01 && Math.abs(progress.ratio - 0.64) < 0.01);
          await page.locator(".attachment-import-item button").click();
          await page.waitForFunction(() => !document.querySelector(".attachment-import-item"));
          const cancellations = await page.evaluate(() => window.fixtureAttachmentCancellations);
          check("cancel calls the supplied local fixture API once", cancellations,
            JSON.stringify(cancellations) === JSON.stringify(["local-copy"]));
          const after = `${id}-cancelled.png`;
          await page.screenshot({ path: join(output, after), scale: "css" });
          record.screenshots.push(after);
          record.scans.push({ screenshot: after, ...(await scan(page)) });
        }
      } catch (error) {
        record.error = String(error);
        check("fixture completed", String(error), false);
      }
      page.off("pageerror", errorListener);
      records.push(record);
      await writeFile(
        join(output, `${id}.metrics.json`),
        JSON.stringify(record, null, 2),
      );
      console.log(
        `${record.checks.every((check) => check.pass) ? "PASS" : "FAIL"} ${id}`,
      );
    }
  // Actual bundled design-plugin surface, with the same synthetic host port
  // used by verify-design-panel-rendered.mjs. No plugin runtime is executed.
  for (const variant of review06Variants) {
    const id = `design-panel-${variant.theme}-${variant.locale}`;
    const record = {
      id,
      state: "design-panel",
      ...variant,
      kind: "bundled panel with a synthetic host port",
      checks: [],
      scans: [],
      screenshots: [],
    };
    await page.goto(
      `file://${join(desktop, "resources/design-plugins/artemis-design/panel/index.html")}`,
    );
    const messages = Object.fromEntries(
      Object.entries(
        JSON.parse(
          await readFile(
            join(
              desktop,
              "src/shared/i18n/ui-locales",
              `${variant.locale}.json`,
            ),
            "utf8",
          ),
        ),
      )
        .filter(([key]) => key.startsWith("DesignPanel."))
        .map(([key, value]) => [key.slice(12), value]),
    );
    await page.evaluate(
      ({ variant, messages }) => {
        const port = {
          postMessage() {},
          addEventListener(type, listener) {
            port[`on${type}`] = listener;
          },
          start() {},
        };
        const event = new Event("artemis:port");
        event.ports = [port];
        window.dispatchEvent(event);
        document.body.style.width = "640px";
        document.body.style.margin = "80px auto";
        port.onmessage({ data: { type: "theme", theme: variant.theme } });
        port.onmessage({
          data: {
            type: "locale",
            locale: variant.locale,
            direction: variant.locale === "ar" ? "rtl" : "ltr",
            messages,
          },
        });
        port.onmessage({
          data: {
            type: "snapshot",
            snapshot: {
              documents: [],
              projectFiles: [
                { path: "index.html", bytes: 300, updatedAt: "1" },
              ],
              projectName: "Local design fixture",
            },
          },
        });
      },
      { variant, messages },
    );
    const filename = `${id}.png`;
    await page.screenshot({ path: join(output, filename), scale: "css" });
    record.screenshots.push(filename);
    record.scans.push({ screenshot: filename, ...(await scan(page)) });
    record.controlStates = await probeControlStates(
      page,
      output,
      record,
      controlFamilies,
    );
    record.checks.push({
      name: "control state probes",
      actual: record.controlStates.filter((state) => state.error),
      pass: record.controlStates.every((state) => !state.error),
    });
    record.checks.push({
      name: "generic scan",
      actual: record.scans[0].violations,
      pass: !record.scans[0].violations.length,
    });
    record.checks.push({
      name: "design file list rendered",
      actual: await page.locator(".design-file-card").count(),
      pass: (await page.locator(".design-file-card").count()) === 1,
    });
    records.push(record);
    await writeFile(
      join(output, `${id}.metrics.json`),
      JSON.stringify(record, null, 2),
    );
  }
} finally {
  await app.close();
}
await writeFile(
  join(output, "supplemental-report.json"),
  JSON.stringify(records, null, 2),
);
if (records.some((record) => record.checks.some((check) => !check.pass)))
  process.exitCode = 1;
