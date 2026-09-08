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
    const header = page.locator(".workspace-header");
    const trackSidebarOverlap = () =>
      page.evaluate(
        () =>
          new Promise((resolve) => {
            const started = performance.now();
            let maxOverlap = 0,
              frames = 0;
            const sample = () => {
              const drawer = document.querySelector(
                '.sidebar > [data-part="main"]',
              );
              const workspace = document.querySelector(".workspace");
              if (getComputedStyle(drawer).visibility === "visible") {
                maxOverlap = Math.max(
                  maxOverlap,
                  drawer.getBoundingClientRect().right -
                    workspace.getBoundingClientRect().left,
                );
              }
              frames++;
              if (performance.now() - started < 1000)
                requestAnimationFrame(sample);
              else resolve({ maxOverlap, frames });
            };
            requestAnimationFrame(sample);
          }),
      );
    const footer = sidebar.locator(".sidebar-footer");
    const expandedWidth = await sidebar.evaluate(
      (el) => el.getBoundingClientRect().width,
    );
    assert.equal(expandedWidth, 280);
    assert.equal((await header.boundingBox()).y, 0);
    assert.equal((await header.boundingBox()).height, 48);
    assert.equal((await footer.boundingBox()).height, 44);
    assert.equal(await sidebar.locator(".sidebar-search").isVisible(), false);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1280, 720),
    );
    await page.waitForFunction(() => innerHeight === 720);
    assert.equal(
      await footer.evaluate((el) => el.getBoundingClientRect().bottom),
      720,
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollHeight),
      720,
    );
    checks.push(
      "v143 expanded 280px sidebar, 48px header, 44px pinned footer and bounded page",
    );
    await page.screenshot({ path: join(output, "sidebar-expanded.png") });

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
    // A short crossing must not hide/inert the rail or reveal the drawer.
    await page.mouse.move(24, 200);
    await page.waitForTimeout(80);
    assert.equal(await sidebar.getAttribute("data-peek"), null);
    assert.equal(await rail.getAttribute("inert"), null);
    assert.equal(
      await rail.evaluate((el) => getComputedStyle(el).visibility),
      "visible",
    );
    await page.mouse.move(800, 400);
    await page.waitForTimeout(250);
    assert.equal(await sidebar.getAttribute("data-peek"), null);
    checks.push(
      "brief hover cancels the shared 200ms debounce without flicker",
    );
    assert.equal((await header.boundingBox()).x, 0);
    if (process.platform === "darwin") {
      assert.equal(
        await header.evaluate((el) => getComputedStyle(el).paddingInlineStart),
        "104px",
      );
      assert((await page.locator(".workspace-heading").boundingBox()).x >= 104);
      assert.deepEqual(
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].getWindowButtonPosition(),
        ),
        { x: 18, y: 17 },
      );
    }

    const railGeometry = await page.locator(".sidebar-rail").boundingBox();
    assert.equal(railGeometry.y, 48);
    assert.equal(railGeometry.y + railGeometry.height, 720);
    assert.match(
      await page
        .locator(".sidebar-rail")
        .evaluate((el) => getComputedStyle(el).backdropFilter),
      /railGlass/,
    );
    const openingFrames = trackSidebarOverlap();
    await page.mouse.move(24, 200);
    await page.waitForFunction(
      () =>
        document
          .querySelector('.sidebar > [data-part="main"]')
          ?.getAttribute("inert") === null,
    );
    assert.equal(await rail.getAttribute("inert"), "");
    const opening = await openingFrames;
    assert(opening.frames > 1);
    assert(opening.maxOverlap <= 1, `Opening overlap: ${opening.maxOverlap}px`);

    await main.evaluate((el) =>
      Promise.all(
        el
          .getAnimations()
          .map((animation) => animation.finished.catch(() => {})),
      ),
    );
    await page.waitForFunction(
      () =>
        document.querySelector(".workspace")?.getBoundingClientRect().x === 280,
    );
    const after = await page.locator(".workspace").boundingBox();
    assert.equal(after.x, 280);
    assert.equal(after.width, before.width - (280 - 48));
    assert.equal((await header.boundingBox()).x, 0);
    assert(
      (await draft.boundingBox()).x >=
        (await main.boundingBox()).x + (await main.boundingBox()).width,
    );
    await page.screenshot({ path: join(output, "sidebar-peek.png") });
    checks.push(
      "hover expansion shifts and narrows the conversation and composer without overlap",
    );
    assert.equal((await main.boundingBox()).y, 48);
    assert.equal((await main.boundingBox()).height, 672);
    const drawerTransition = await main.evaluate(
      (el) => getComputedStyle(el).transition,
    );
    assert.match(drawerTransition, /transform 0.56s/);
    assert.match(drawerTransition, /opacity 0.42s/);
    // Cross the brand text with the pointer, rather than jumping straight to
    // the button. Native drag regions swallow enter/exit events on macOS.
    const brand = await sidebar.locator(".sidebar-brand").boundingBox();
    const pin = await sidebar.locator(".sidebar-collapse").boundingBox();
    const pointerY = brand.y + brand.height / 2;
    for (let x = 24; x <= pin.x + pin.width / 2; x += 4) {
      await page.mouse.move(x, pointerY);
      assert.equal(await sidebar.getAttribute("data-peek"), "true");
      if (process.platform === "darwin") {
        assert.notEqual(
          await page.evaluate(
            ({ x, y }) =>
              getComputedStyle(
                document.elementFromPoint(x, y),
              ).getPropertyValue("-webkit-app-region"),
            { x, y: pointerY },
          ),
          "drag",
          `Pointer path crosses a native drag region at ${x}, ${pointerY}`,
        );
      }
    }
    await page.mouse.click(pin.x + pin.width / 2, pin.y + pin.height / 2);
    await page.mouse.move(800, 400);
    await page.waitForTimeout(800);
    assert.equal(await sidebar.getAttribute("data-state"), "ready");
    assert.equal(await draft.inputValue(), text);
    checks.push(
      "pointer crosses brand text to the right pin button and stays pinned after exit",
    );
    await sidebar.locator(".sidebar-collapse").click();
    await page.mouse.move(800, 400);
    await page.waitForTimeout(800);
    await page.mouse.move(24, 200);
    await page.waitForTimeout(850);
    assert.equal(await sidebar.getAttribute("data-peek"), "true");
    const closingFrames = trackSidebarOverlap();
    await page.mouse.move(800, 400);
    await page.waitForFunction(
      () => !document.querySelector(".sidebar")?.hasAttribute("data-peek"),
    );
    assert.equal(await main.getAttribute("inert"), "");
    await page.waitForFunction(
      () =>
        getComputedStyle(
          document.querySelector('.sidebar > [data-part="main"]'),
        ).visibility === "hidden",
    );
    const closing = await closingFrames;
    assert(closing.frames > 1);
    assert(closing.maxOverlap <= 1, `Closing overlap: ${closing.maxOverlap}px`);
    checks.push(
      `opening/closing frames do not overlap the conversation (${opening.frames + closing.frames} sampled frames)`,
    );
    checks.push(
      "drawer returns immediately with a 560ms slide and becomes inert",
    );
    await page.mouse.move(24, 200);
    await page.waitForFunction(
      () =>
        document.querySelector(".sidebar")?.getAttribute("data-peek") ===
        "true",
    );
    await sidebar.locator(".sidebar-collapse").focus();
    await page.keyboard.press("Escape");
    assert.equal(await sidebar.getAttribute("data-peek"), null);
    await page.waitForFunction(
      () => document.querySelector(".rail-brand") === document.activeElement,
    );
    assert(
      await page
        .locator(".rail-brand")
        .evaluate((el) => el === document.activeElement),
    );
    await page.keyboard.press("Enter");
    await page.mouse.move(800, 400);
    await page.waitForFunction(
      () =>
        document
          .querySelector(".app-shell")
          ?.getAttribute("data-sidebar-open") === "true",
    );
    await page.waitForFunction(
      () =>
        document.querySelector(".sidebar")?.getBoundingClientRect().width ===
        280,
    );
    assert(await sidebar.boundingBox().then((rect) => rect.width === 280));
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
    await page.waitForFunction(
      () =>
        document.querySelector(".sidebar")?.getBoundingClientRect().width ===
        250,
    );
    assert.equal(
      await footer.evaluate((el) => el.getBoundingClientRect().bottom),
      await page.evaluate(() => innerHeight),
    );
    assert.equal(await draft.inputValue(), text);
    checks.push(
      "narrow automatic collapse permits explicit keyboard pin at 250px",
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await sidebar.locator(".sidebar-collapse").click();
    assert.equal(
      await page
        .locator(".app-shell")
        .evaluate((el) => getComputedStyle(el).transitionDuration),
      "0s",
    );
    checks.push("reduced motion disables sidebar layout transitions");
    assert.deepEqual(errors, []);
    return { status: "passed", checks, errors };
  } finally {
    await app.close();
  }
}
