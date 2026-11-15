import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const require = createRequire(import.meta.url);
const { _electron } = require("playwright-core");
const output = resolve(
  process.argv[2] ?? "artifacts/verification/provider-credentials/local",
);
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), "artemis-provider-ui-"));
const env = {
  ...process.env,
  ARTEMIS_SMOKE_VIEW: "nocturne-settings-providers",
  ARTEMIS_SMOKE_THEME: "dark",
  ARTEMIS_SMOKE_MATERIAL: "solid",
  ARTEMIS_SMOKE_LOCALE: "zh-CN",
  ARTEMIS_SMOKE_MULTI_UI: "1",
  ARTEMIS_SMOKE_SCALE: "1",
  ARTEMIS_SMOKE_WINDOW_WIDTH: "1440",
  ARTEMIS_SMOKE_WINDOW_HEIGHT: "1000",
  ARTEMIS_SMOKE_SCREENSHOT: join(directory, "smoke.png"),
  ARTEMIS_SMOKE_ACCESSIBILITY: join(directory, "audit.json"),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.ARTEMIS_DEV_SERVER_URL;
let app;
const errors = [];
const geometry = [];
try {
  app = await _electron.launch({
    executablePath: require("electron"),
    args: [appDirectory, `--user-data-dir=${directory}`],
    cwd: appDirectory,
    env,
  });
  await app.evaluate(({ app }) => {
    app.__providerQuit = app.quit;
    app.__providerExit = app.exit;
    app.quit = () => {};
    app.exit = () => {};
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.waitForSelector('[data-renderer-ready="true"]');
  const deadline = Date.now() + 60000;
  while (true) {
    try {
      await readFile(join(directory, "audit.json"));
      break;
    } catch {
      assert.ok(Date.now() < deadline, "smoke setup timed out");
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  assert.ok(page.url().includes("index.html"));
  assert.ok(await page.locator(".provider-workspace").isVisible());
  assert.equal(await page.locator("vite-error-overlay").count(), 0);
  assert.equal(
    await page.locator(".provider-detail .provider-defaults").count(),
    0,
  );
  assert.ok(
    await page.getByText("新任务全局默认", { exact: true }).isVisible(),
  );
  await page.locator(".provider-add-service").click();
  await page
    .locator(".provider-catalog-dialog")
    .getByRole("button", { name: "openai", exact: true })
    .click();
  const input = page.locator(".provider-api-key input");
  await input.focus();
  // Chromium's text insertion follows the same controlled input path as paste,
  // without touching the user's clipboard or any real credentials.
  await page.keyboard.insertText("synthetic-ui-key-do-not-use");
  const save = page.locator('.provider-key-field button[type="submit"]');
  await save.waitFor({ state: "visible" });
  for (const width of [1440, 1000, 980]) {
    await app.evaluate(
      ({ BrowserWindow }, width) =>
        BrowserWindow.getAllWindows()[0].setSize(width, 1000),
      width,
    );
    await page.waitForTimeout(200);
    const boxes = await page
      .locator(".provider-key-field")
      .evaluate((field) => {
        const rect = (element) => {
          const r = element.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, right: r.right };
        };
        return {
          field: rect(field),
          input: rect(field.querySelector("input")),
          save: rect(field.querySelector('button[type="submit"]')),
        };
      });
    assert.ok(
      boxes.input.width >= 120,
      `input remains usable at ${width}px: ${JSON.stringify(boxes)}`,
    );
    assert.ok(
      boxes.save.right <= boxes.field.right + 1,
      "save stays within key field",
    );
    geometry.push({ width, ...boxes });
    if (width === 1440) {
      await page.locator(".provider-key-field").screenshot({
        path: join(output, "save-button.png"),
      });
    }
    await page
      .locator(".settings-panel")
      .screenshot({ path: join(output, `provider-key-${width}.png`) });
  }
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1440, 1000),
  );
  await save.click();
  await page.waitForFunction(
    () => document.querySelector(".provider-api-key input")?.value === "",
  );
  const saved = await page.evaluate(async () =>
    (await window.artemis.getSettings()).credentials.some(
      (item) => item.providerId === "openai" && item.type === "api_key",
    ),
  );
  assert.equal(
    saved,
    true,
    "key persisted through real IPC with OS encryption",
  );
  await page.locator(".provider-detail-heading button").click();
  await page.screenshot({ path: join(output, "provider-remove-menu.png") });
  await page.getByRole("menuitem").click();
  await page
    .locator('.model-delete-dialog button[data-variant="danger"]')
    .click();
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll(".provider-navigation-name")].some(
        (item) => item.textContent === "openai",
      ),
  );
  const removed = await page.evaluate(
    async () =>
      !(await window.artemis.getSettings()).credentials.some(
        (item) => item.providerId === "openai",
      ),
  );
  assert.equal(removed, true);
  assert.deepEqual(errors, []);
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        passed: true,
        geometry,
        errors,
        browser: "Browser plugin not available; Playwright Electron",
        persistedAndRemoved: true,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, output, geometry }));
} catch (error) {
  if (app)
    await (
      await app.firstWindow()
    )
      .screenshot({ path: join(output, "failure.png") })
      .catch(() => {});
  throw error;
} finally {
  if (app) {
    await app
      .evaluate(({ app }) => {
        app.quit = app.__providerQuit;
        app.exit = app.__providerExit;
      })
      .catch(() => {});
    await app.close().catch(() => {});
  }
  await rm(directory, { recursive: true, force: true });
}
