import assert from "node:assert/strict";
import { join } from "node:path";

// Only the production Electron renderer is opened. The prototype is never loaded.
export async function verifyLatestUiInteractions({
  root,
  temp,
  output,
  electron,
}) {
  const { _electron } = await import(
    process.env.ARTEMIS_PLAYWRIGHT_MODULE || "playwright"
  );
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (
      key.startsWith("ARTEMIS_SMOKE_") ||
      key === "ELECTRON_RUN_AS_NODE" ||
      key === "ARTEMIS_DEV_SERVER_URL"
    )
      delete env[key];
  const app = await _electron.launch({
    executablePath: electron,
    args: [
      join(root, "apps/desktop"),
      `--user-data-dir=${join(temp, "interactions")}`,
      "--disable-gpu",
    ],
    env,
  });
  const checks = [],
    errors = [];
  try {
    const page = await app.firstWindow();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.locator('[data-renderer-ready="true"]').waitFor();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1440, 900),
    );
    const sidebar = page.locator(
      '[data-artemis-component="navigation-sidebar"]',
    );
    const main = sidebar.locator(':scope > [data-part="main"]');
    const rail = sidebar.locator(':scope > [data-part="rail"]');
    const draft = page.locator(".composer textarea");
    await draft.fill(
      "Migration draft · keep through navigation and Dock changes",
    );
    const text = await draft.inputValue();
    await sidebar.locator(".sidebar-collapse").click();
    await page.mouse.move(800, 400);
    await page.waitForFunction(
      () =>
        document.querySelector(".sidebar")?.getBoundingClientRect().width ===
        48,
    );
    assert.equal(await main.getAttribute("inert"), "");
    assert.equal(await rail.getAttribute("inert"), null);
    assert(
      await page
        .locator(".rail-brand")
        .evaluate((el) => el === document.activeElement),
    );
    checks.push("48px rail, main inert, keyboard focus restored");
    await page.screenshot({ path: join(output, "sidebar-rail.png") });
    const before = await page.locator(".workspace").boundingBox();
    await sidebar.hover();
    await page.waitForFunction(
      () =>
        document
          .querySelector('.sidebar > [data-part="main"]')
          ?.getAttribute("inert") === null,
    );
    assert.equal(await rail.getAttribute("inert"), "");
    const after = await page.locator(".workspace").boundingBox();
    assert.equal(before.x, after.x);
    assert.equal(before.width, after.width);
    await main.evaluate((el) =>
      Promise.all(
        el
          .getAnimations()
          .map((animation) => animation.finished.catch(() => {})),
      ),
    );
    await page.screenshot({ path: join(output, "sidebar-peek.png") });
    checks.push(
      "hover overlay preserves workspace geometry and hides duplicate rail controls",
    );
    await sidebar.locator(".sidebar-collapse").click();
    await page.mouse.move(800, 400);
    await page.waitForFunction(
      () =>
        document
          .querySelector(".app-shell")
          ?.getAttribute("data-sidebar-open") === "true",
    );
    assert(await sidebar.boundingBox().then((rect) => rect.width >= 240));
    assert.equal(await draft.inputValue(), text);
    checks.push("pin persists after pointer exit and preserves draft");
    const dockToggle = page.locator(".right-sidebar-toggle");
    await dockToggle.click();
    await dockToggle.click();
    assert.equal(await draft.inputValue(), text);
    checks.push("Dock open/close preserves composer draft");
    await sidebar.locator(".foot-icon").click();
    const dialog = page.locator(".settings-panel");
    await dialog.waitFor();
    for (const tab of [
      "general",
      "providers",
      "im",
      "agents",
      "capabilities",
      "maintenance",
    ]) {
      await page.locator(`#settings-tab-${tab}-button`).click();
      await page.locator(`#settings-tab-${tab}`).waitFor({ state: "visible" });
      await page.screenshot({ path: join(output, `settings-${tab}.png`) });
      checks.push(`settings ${tab} reachable`);
    }
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert(
      await sidebar
        .locator(".foot-icon")
        .evaluate((el) => el === document.activeElement),
    );
    assert.equal(await draft.inputValue(), text);
    checks.push("settings close restores trigger focus and draft");
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(980, 900),
    );
    await page.mouse.move(800, 400);
    await page.waitForFunction(
      () =>
        document.querySelector(".sidebar")?.getBoundingClientRect().width ===
        48,
    );
    await page.locator(".rail-brand").focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () =>
        document
          .querySelector(".app-shell")
          ?.getAttribute("data-sidebar-open") === "true",
    );
    assert.equal(await draft.inputValue(), text);
    checks.push("narrow automatic collapse permits explicit keyboard pin");
    assert.deepEqual(errors, []);
    return { status: "passed", checks, errors };
  } finally {
    await app.close();
  }
}
