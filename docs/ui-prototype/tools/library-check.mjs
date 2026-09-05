/** Real-browser contracts for shared UI, static catalog, and offline entry points. */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
const { inlineAssets } = createRequire(import.meta.url)("./inline-assets.cjs");
const root = new URL("../", import.meta.url);
const out = process.env.ARTEMIS_UI_CHECK_OUTPUT || "/tmp/artemis-library-check";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
page.setDefaultTimeout(5000);
async function check(name, run) {
  await run();
  checks.push(name);
}
try {
  await page.goto(new URL("components.html", root).href);
  await check("catalog has all 73 cards and no duplicate IDs", async () => {
    assert.equal(await page.locator(".spec[data-card]").count(), 73);
    assert.equal(
      await page
        .locator("[id]")
        .evaluateAll(
          (els) => new Set(els.map((el) => el.id)).size === els.length,
        ),
      true,
    );
  });
  await page.addScriptTag({
    url: new URL("tools/prototype-contracts.js", root).href,
  });
  await check("existing catalog behavior contracts", async () => {
    const result = await page.evaluate(() => window.runPrototypeContracts());
    await writeFile(
      out + "/prototype-contracts.json",
      JSON.stringify(result, null, 2),
    );
    assert.equal(result.ok, true, JSON.stringify(result.failures));
  });
  await page.goto(new URL("components.html", root).href);
  await check(
    "dialog variants and environment actions retain shared controls",
    async () => {
      await page.locator("#openDangerDlg").click();
      assert.equal(
        await page.locator("#dlgConfirm").getAttribute("data-variant"),
        "danger",
      );
      assert.equal(
        await page
          .locator("#dlgConfirm")
          .evaluate((el) => el.classList.contains("ui-button")),
        true,
      );
      await page.keyboard.press("Escape");
      await page.locator("#envCommit").click();
      assert.equal(await page.locator("#dlgT").textContent(), "提交更改");
      assert.equal(
        await page.locator("#dlgConfirm").getAttribute("data-variant"),
        "primary",
      );
      await page.keyboard.press("Escape");
      assert.equal(
        await page
          .locator("#envCommit")
          .evaluate((el) => el === document.activeElement),
        true,
      );
    },
  );
  await check("shared select keyboard and focus restore", async () => {
    await page.locator("#sel1").click();
    await page.keyboard.press("End");
    const chosen = await page.evaluate(() =>
      document.activeElement.textContent.replace("✓", "").trim(),
    );
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#sel1 .val").textContent(), chosen);
    assert.equal(
      await page.locator("#sel1").getAttribute("aria-expanded"),
      "false",
    );
    assert.equal(
      await page
        .locator("#sel1")
        .evaluate((el) => el === document.activeElement),
      true,
    );
  });
  await page.goto(new URL("apple-inspired-ui.html", root).href);
  await check(
    "nested dialog preserves environment and consumes one Escape",
    async () => {
      await page.locator("#envTrigger").click();
      await page.locator('[data-dialog="commit"]').click();
      await page.keyboard.press("Escape");
      assert.equal(
        await page.locator("#prototypeDialog").evaluate((el) => el.open),
        false,
      );
      assert.equal(
        await page.locator("#envTrigger").getAttribute("aria-expanded"),
        "true",
      );
      await page.keyboard.press("Escape");
      assert.equal(
        await page.locator("#envTrigger").getAttribute("aria-expanded"),
        "false",
      );
      assert.equal(
        await page
          .locator("#envTrigger")
          .evaluate((el) => el === document.activeElement),
        true,
      );
    },
  );
  await check("settings focus and vertical keyboard navigation", async () => {
    await page.locator("#settingsBtn").click();
    await page.locator("#settingsTabGeneral").focus();
    await page.keyboard.press("ArrowDown");
    assert.equal(
      await page.locator("#settingsTabProviders").getAttribute("aria-selected"),
      "true",
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await page
        .locator("#settingsBtn")
        .evaluate((el) => el === document.activeElement),
      true,
    );
  });
  await check(
    "multiple independent instances, idempotent mount, destroy and remount",
    async () => {
      const result = await page.evaluate(() => {
        const UI = window.ArtemisUI,
          host = document.createElement("div");
        host.id = "library-fixtures";
        host.style =
          "position:fixed;inset:100px 20px 20px;z-index:1000;background:white;color:black";
        document.body.append(host);
        function fixture(label) {
          const trigger = UI.button({ label }),
            panel = document.createElement("div");
          panel.style = "position:relative";
          panel.append(
            UI.button({ label: "First" }),
            UI.button({ label: "Second" }),
          );
          host.append(trigger, panel);
          return { trigger, panel };
        }
        const a = fixture("A"),
          b = fixture("B");
        let changes = 0;
        const one = UI.menu(a.trigger, a.panel, {
            onSelect() {
              changes++;
            },
          }),
          two = UI.menu(b.trigger, b.panel);
        const same = one === UI.menu(a.trigger, a.panel);
        one.open();
        two.open();
        two.close();
        const isolated = one.isOpen && !two.isOpen;
        one.destroy();
        a.trigger.click();
        const removed = a.trigger.getAttribute("aria-expanded") === "false";
        const remount = UI.menu(a.trigger, a.panel, {
          onSelect() {
            changes++;
          },
        });
        a.trigger.click();
        a.panel.querySelector("button").click();
        const clean = changes === 1;
        remount.destroy();
        two.destroy();
        host.remove();
        return { same, isolated, removed, clean };
      });
      assert.deepEqual(result, {
        same: true,
        isolated: true,
        removed: true,
        clean: true,
      });
    },
  );
  await check(
    "button factory renders text safely and keeps native disabled behavior",
    async () => {
      assert.deepEqual(
        await page.evaluate(() => {
          const el = ArtemisUI.button({
            label: "<img src=x onerror=alert(1)>",
            disabled: true,
          });
          let called = 0;
          el.addEventListener("click", () => called++);
          el.click();
          return {
            text: el.textContent,
            children: el.children.length,
            called,
            type: el.type,
          };
        }),
        {
          text: "<img src=x onerror=alert(1)>",
          children: 0,
          called: 0,
          type: "button",
        },
      );
    },
  );
  await check(
    "goal save failure preserves draft; destroy ignores late save",
    async () => {
      const result = await page.evaluate(async () => {
        const root = document.createElement("div"),
          input = document.createElement("textarea"),
          save = ArtemisUI.button({ label: "Save" }),
          revert = ArtemisUI.button({ label: "Revert" }),
          status = document.createElement("span");
        input.value = "original";
        root.append(input, save, revert, status);
        document.body.append(root);
        const failed = ArtemisPatterns.goalEditor(root, {
          input,
          save,
          revert,
          status,
          onSave: async () => {
            throw new Error("unavailable");
          },
        });
        input.value = "draft";
        input.dispatchEvent(new Event("input"));
        await failed.save();
        const retained =
          input.value === "draft" &&
          !input.disabled &&
          status.classList.contains("error");
        failed.destroy();
        let finish;
        const pending = ArtemisPatterns.goalEditor(root, {
          input,
          save,
          revert,
          status,
          onSave: () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        });
        input.value = "new draft";
        input.dispatchEvent(new Event("input"));
        const request = pending.save();
        pending.destroy();
        finish("late server value");
        await request;
        const ignored = input.value === "new draft";
        root.remove();
        return { retained, ignored };
      });
      assert.deepEqual(result, { retained: true, ignored: true });
    },
  );
  await check(
    "primary and danger hover colors retain their contrasting text",
    async () => {
      const primary = page
        .locator('.ui-button[data-variant="primary"]')
        .first();
      await primary.hover();
      await page.waitForTimeout(250);
      assert.equal(
        await primary.evaluate((el) => getComputedStyle(el).color),
        "rgb(255, 255, 255)",
      );
      await page.evaluate(() => {
        const danger = ArtemisUI.button({ label: "Delete", variant: "danger" });
        danger.id = "test-danger";
        danger.style.cssText =
          "position:fixed;top:70px;right:10px;z-index:1000";
        document.body.append(danger);
      });
      await page.locator("#test-danger").hover();
      await page.waitForTimeout(250);
      assert.equal(
        await page
          .locator("#test-danger")
          .evaluate((el) => getComputedStyle(el).color),
        "rgb(255, 255, 255)",
      );
      await page.locator("#test-danger").evaluate((el) => el.remove());
    },
  );
  await check("theme parity across both consumers", async () => {
    const catalog = await browser.newPage();
    await catalog.goto(new URL("components.html", root).href);
    await page.mouse.move(0, 0);
    await catalog.mouse.move(0, 0);
    for (const direction of ["a", "b", "c"])
      for (const theme of ["light", "dark"])
        for (const contrast of ["normal", "high"]) {
          const state = { direction, theme, contrast };
          for (const p of [page, catalog])
            await p.evaluate(
              (state) => Object.assign(document.documentElement.dataset, state),
              state,
            );
          await page.waitForTimeout(400);
          const snapshot = async (p) =>
            p
              .locator('.ui-button[data-variant="primary"]')
              .first()
              .evaluate((el) => {
                const css = getComputedStyle(el);
                return [css.backgroundColor, css.color, css.borderRadius];
              });
          assert.deepEqual(
            await snapshot(page),
            await snapshot(catalog),
            JSON.stringify(state),
          );
        }
    await catalog.close();
  });
  await check(
    "single-file offline export resolves every script and stylesheet",
    async () => {
      const { fileURLToPath, pathToFileURL } = await import("node:url");
      for (const name of ["components.html", "apple-inspired-ui.html"]) {
        const file = out + "/bundled-" + name;
        await writeFile(file, inlineAssets(fileURLToPath(new URL(name, root))));
        await page.goto(pathToFileURL(file).href);
        assert.equal(await page.evaluate(() => ArtemisUI.version), "0.1.0");
        assert.equal(
          await page.locator('link[rel="stylesheet"],script[src]').count(),
          0,
        );
        assert.equal((await page.locator(".ui-button").count()) > 0, true);
      }
    },
  );
  await page.goto(new URL("apple-inspired-ui.html", root).href);
  await page.screenshot({ path: out + "/workspace.png" });
  await page.goto(new URL("components.html", root).href + "#goto=01");
  await page.screenshot({ path: out + "/catalog.png" });
  assert.deepEqual(errors, []);
  await writeFile(
    out + "/results.json",
    JSON.stringify({ ok: true, checks, errors }, null, 2),
  );
  console.log("PASS " + checks.length + " library checks; " + out);
} finally {
  await browser.close();
}
