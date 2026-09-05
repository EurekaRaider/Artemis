import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Browser plugin not available: regular Playwright, isolated Chrome profile.
// Reuses the shipped T8 assertions and T9 page audit over HTTP, never file://.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(process.argv[2] || "/tmp/artemis-im-settings-qa");
const base = process.env.IM_PROTOTYPE_URL || "http://127.0.0.1:8765";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true, chromiumSandbox: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
const page = await context.newPage();
page.setDefaultTimeout(8000);
const checks = [], errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => {
  if (["warning", "error"].includes(message.type()) && !message.location().url.endsWith("/favicon.ico")) errors.push(message.text());
});
page.on("response", (response) => {
  if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) errors.push(response.status() + " " + response.url());
});
page.on("requestfailed", (request) => errors.push(request.url() + ": " + request.failure().errorText));
let navigation = 0;
const load = async (hash = "im=manage") => {
  await page.goto(base + "/apple-inspired-ui.html?qa=" + ++navigation + "#settings=1&" + hash);
  await page.waitForFunction(() => !!window.ImPrototype);
  await page.locator("#settingsPanelIm").waitFor({ state: "visible" });
};
const click = (selector) => page.locator(selector).click();
const action = (name) => page.locator('[data-im-action="' + name + '"]');
const snapshot = () => page.evaluate(() => window.ImPrototype.snapshot());
const screenshot = async (name) => {
  await page.screenshot({ path: join(output, name + ".png") });
};
async function test(name, run) {
  try { await run(); checks.push({ name, passed: true }); console.log("PASS", name); }
  catch (error) { checks.push({ name, passed: false, error: String(error) }); console.error("FAIL", name, String(error)); await screenshot("failure-" + checks.length); }
}
try {
  await test("scope: supplied shell, other tabs, component catalog and T8 unchanged", async () => {
    const baseline = JSON.parse(await readFile(join(root, "tools/im-settings-baseline.json"), "utf8"));
    const html = await readFile(join(root, "apple-inspired-ui.html"), "utf8");
    const sha = (text) => createHash("sha256").update(text).digest("hex");
    assert.equal(sha(html.match(/<style>([\s\S]*?)<\/style>/)[1]), baseline.styleSha256);
    assert.equal(sha(html.match(/<script>([\s\S]*?)<\/script>/)[1]), baseline.scriptSha256);
    assert.equal(sha(await readFile(join(root, "components.html"), "utf8")), baseline.componentsSha256);
    assert.equal(sha(await readFile(join(root, "tools/prototype-contracts.js"), "utf8")), baseline.t8Sha256);
    await load();
    assert.deepEqual(await page.locator(".settings-tab:not(#settingsTabIM)").allTextContents(), baseline.settingsLabels);
    const shell = await page.locator(".settings-panel").boundingBox();
    assert.equal(shell.width, baseline.settingsWidth); assert.equal(shell.height, baseline.settingsHeight);
    assert.equal(await page.locator(".settings-tab.active").innerText(), "消息接入");
    await page.locator(".settings-tab").first().click();
    assert.equal(await page.locator("#settingsPanelIm").isVisible(), false);
    assert.equal(await page.locator("#segLight").isVisible(), true);
  });
  await test("management: page identity, two columns, seven destinations, channel details", async () => {
    await load();
    assert.match(page.url(), /apple-inspired-ui\.html/);
    assert.match(await page.title(), /Artemis/);
    assert.equal(await page.locator("#settingsPanelIm").getAttribute("data-mode"), "manage");
    assert.equal(await page.locator("#settingsPanelIm").getAttribute("data-compact"), "false");
    assert.equal(await page.locator('.im-channel-list [data-im-view]').count(), 7);
    assert.equal(await page.locator("vite-error-overlay").count(), 0);
    assert.equal(await page.locator('#settingsPanelIm [role="switch"]').count(), 1);
    assert.match(await page.locator("#settingsPanelIm").innerText(), /配对请求 · 待确认/);
    await screenshot("manage-light");
    await click("#im-nav-slack");
    assert.match(await page.locator("#settingsPanelIm").innerText(), /Manifest/);
    assert.equal(await page.locator('#settingsPanelIm input[type="password"]').count(), 3);
    await click("#im-nav-wecom");
    assert.match(await page.locator("#settingsPanelIm").innerText(), /长连接免公网/);
  });
  await test("credentials: blank secrets, cancel focus, saved state and cleared administrator input", async () => {
    await load();
    assert.equal(await page.locator("#im-credential-form").count(), 0);
    await action("edit-credentials").click();
    assert.equal(await page.locator("#im-credential-form input[required]").count(), 9);
    assert.equal(await page.locator("#im-credential-appSecret").inputValue(), "");
    await page.locator("#im-credential-appSecret").fill("temporary-demo-secret");
    await action("cancel-credentials").click();
    assert.equal(await page.locator("#im-edit-credentials").evaluate((element) => element === document.activeElement), true);
    await action("edit-credentials").click();
    assert.equal(await page.locator("#im-credential-appSecret").inputValue(), "");
    for (const input of await page.locator("#im-credential-form input[required]").all()) await input.fill("demo-value");
    await page.locator("#im-credential-form button[type=submit]").click();
    assert.equal(await page.locator("#im-credential-form").count(), 0);
    assert.equal(JSON.stringify(await snapshot()).includes("temporary-demo-secret"), false);
    assert.equal(await page.locator("#im-bot-admin").count(), 0);
  });
  await test("pair request: approve adds an account; reject leaves accounts unchanged", async () => {
    await load();
    const before = (await snapshot()).channels.feishu.identities.length;
    await action("approve-pair").click();
    assert.equal((await snapshot()).channels.feishu.identities.length, before + 1);
    assert.equal(await action("approve-pair").count(), 0);
    await page.evaluate(() => window.ImPrototype.reset("manage"));
    await action("reject-pair").click();
    assert.equal((await snapshot()).channels.feishu.identities.length, before);
    assert.equal(await action("reject-pair").count(), 0);
  });
  await test("unbind: inline confirmation, focus, Escape, keep and explicit removal", async () => {
    await load();
    await action("unbind").first().click();
    assert.equal(await page.locator("#im-confirm-unbind").evaluate((element) => element === document.activeElement), true);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#settingsBackdrop").evaluate((element) => element.classList.contains("open")), true);
    assert.equal(await page.locator("#im-unbind-u_9f3a").evaluate((element) => element === document.activeElement), true);
    await action("unbind").first().click();
    await action("keep-binding").click();
    assert.equal((await snapshot()).channels.feishu.identities.length, 2);
    await action("unbind").first().click();
    await action("confirm-unbind").click();
    assert.equal((await snapshot()).channels.feishu.identities.length, 1);
  });
  await test("master switch: pause retains all configuration; unavailable setup explains guard", async () => {
    await load();
    const before = await snapshot();
    await action("toggle-enabled").click();
    const after = await snapshot();
    assert.equal(after.enabled, false); after.enabled = true; assert.deepEqual(after, before);
    await page.evaluate(() => window.ImPrototype.reset("empty"));
    assert.equal(await action("toggle-enabled").isDisabled(), true);
    assert.match(await page.locator("#im-switch-reason").innerText(), /注册/);
    await page.locator('[data-im-step="gateway"]').first().click();
    await action("setup-local").click();
    assert.equal((await snapshot()).device.id, "dev-demo");
    assert.match(await page.locator("#im-switch-reason").innerText(), /机器人/);
  });
  await test("wizard: six vertical steps, current step, constraints, non-destructive replay", async () => {
    await load("im=wizard");
    assert.equal(await page.locator(".im-setup-steps > li").count(), 6);
    assert.equal(await page.locator(".im-setup-steps [aria-current=step]").count(), 1);
    assert.match(await page.locator(".im-setup-steps [aria-current=step]").innerText(), /连接一个机器人/);
    assert.equal(await page.locator(".im-platform-card").count(), 3);
    assert.equal(await page.locator(".im-platform-cards").evaluate((element) => element.getBoundingClientRect().bottom <= document.querySelector("#settingsPanelIm").getBoundingClientRect().bottom + 1), true, "platform constraints visible in first viewport");
    await screenshot("wizard");
    await load();
    const before = await snapshot();
    await click("#im-replay-guide summary");
    assert.equal(await page.locator(".im-setup-steps").isVisible(), true);
    await page.locator('[data-im-step="permissions"]').click();
    assert.equal(await page.locator("#im-nav-permissions").getAttribute("aria-selected"), "true");
    assert.deepEqual(await snapshot(), before);
  });
  await test("pairing: five-minute expiry, clipboard, regeneration, automatic management transition", async () => {
    await load("im=wizard&im-fixture=pairing");
    await page.locator('[data-im-step="pairing"]').click();
    await action("generate-pair").click();
    assert.match(await page.locator("#im-pair-countdown").innerText(), /^5:00|4:59$/);
    const code = (await snapshot()).pairing.code;
    await click("#im-copy-pair");
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "/pair " + code);
    await page.evaluate(() => window.ImPrototype.setPairingRemaining(0));
    assert.equal(await page.locator("#im-copy-pair").isDisabled(), true);
    assert.match(await page.locator("#im-pair-status").innerText(), /过期/);
    await action("generate-pair").click();
    assert.notEqual((await snapshot()).pairing.code, code);
    await action("simulate-pair").click();
    assert.equal(await page.locator("#settingsPanelIm").getAttribute("data-mode"), "manage");
  });
  await test("projects: selection, safe defaults, dependent permissions, renewal and save", async () => {
    await load("im=manage&im-view=permissions");
    await page.locator("#im-project-website").check();
    assert.equal(await page.locator("#im-mode-website").inputValue(), "plan");
    assert.equal(await page.locator("#im-shell-website").isDisabled(), true);
    await page.locator("#im-mode-website").selectOption("execute");
    await page.locator("#im-shell-website").check();
    assert.equal(await page.locator("#im-network-website").isDisabled(), false);
    await page.locator("#im-network-website").check();
    await page.locator("#im-mode-website").selectOption("plan");
    assert.equal(await page.locator("#im-network-website").isDisabled(), true);
    await page.locator("#im-default-project").selectOption("website");
    await action("save-grants").click();
    assert.equal((await snapshot()).defaultProjectId, "website");
    assert.equal((await snapshot()).grants.find((grant) => grant.projectId === "website").mode, "plan");
    await screenshot("permissions");
  });
  await test("spaces: advanced collapsed, directory, invalid JSON, saved confirmation instruction", async () => {
    await load("im=manage&im-view=spaces");
    assert.equal(await page.locator("#im-space-advanced").getAttribute("open"), null);
    await click("#im-space-advanced summary");
    await page.locator("#im-space-admin").fill("demo-admin");
    await action("diagnostics").click();
    assert.match(await page.locator("#settingsPanelIm").innerText(), /已发现群聊/);
    assert.equal(await page.locator("#im-space-admin").inputValue(), "");
    await page.locator("#im-space-admin").fill("demo-admin");
    await page.locator("#im-space-json").fill("{invalid");
    await action("save-space").click();
    assert.equal(await page.locator("#im-feedback").getAttribute("role"), "alert");
    assert.equal((await snapshot()).space, null);
    await action("space-example").click();
    await page.locator("#im-space-admin").fill("demo-admin");
    await action("save-space").click();
    assert.equal((await snapshot()).space.id, "team-space");
    assert.match(await page.locator("#settingsPanelIm").innerText(), /space-confirm team-space/);
    assert.equal(await page.locator("#im-space-admin").inputValue(), "");
    await screenshot("spaces");
  });
  await test("keyboard: seven-destination arrow loop, Home, End and ARIA panels", async () => {
    await load();
    await page.locator("#im-nav-wecom").focus();
    await page.keyboard.press("ArrowDown");
    assert.equal(await page.locator("#im-nav-feishu").evaluate((element) => element === document.activeElement), true);
    await page.keyboard.press("End");
    assert.equal(await page.locator("#im-nav-spaces").evaluate((element) => element === document.activeElement), true);
    await page.keyboard.press("ArrowDown");
    assert.equal(await page.locator("#im-nav-wecom").evaluate((element) => element === document.activeElement), true);
    const wiring = await page.locator('.im-channel-list [data-im-view]').evaluateAll((tabs) => tabs.every((tab) => document.getElementById(tab.getAttribute("aria-controls"))));
    assert.equal(wiring, true);
  });
  await test("compact: horizontal channels, common menu, arrows, Escape and outside click", async () => {
    await page.setViewportSize({ width: 720, height: 900 });
    await load();
    assert.equal(await page.locator("#settingsPanelIm").getAttribute("data-compact"), "true");
    await click("#im-nav-more");
    assert.equal(await page.getByRole("menu", { name: "通用设置" }).isVisible(), true);
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#im-panel-spaces").isVisible(), true);
    await screenshot("compact");
    await click("#im-nav-more");
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("menu", { name: "通用设置" }).isVisible(), false);
    assert.equal(await page.locator("#settingsBackdrop").isVisible(), true);
    await click("#im-nav-more");
    await page.locator("#settingsPanelIm h2").click();
    assert.equal(await page.getByRole("menu", { name: "通用设置" }).isVisible(), false);
    assert.equal(await page.locator("#settingsPanelIm").evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true);
  });
  await test("visual matrix: light/dark, increased contrast, narrow screen and 200% zoom", async () => {
    for (const [name, width, theme, contrast, zoom] of [
      ["manage-dark", 1440, "dark", "normal", 1],
      ["high-contrast", 1440, "light", "high", 1],
      ["dark-high-contrast", 1440, "dark", "high", 1],
      ["narrow", 390, "light", "normal", 1],
      ["zoom200", 1440, "light", "normal", 2],
    ]) {
      // Browser zoom changes the CSS viewport budget. Use the 200% equivalent
      // viewport instead of CSS zoom, which crops the unchanged legacy shell.
      await page.setViewportSize({ width: width / zoom, height: 1000 / zoom });
      await load("im=manage&theme=" + theme + "&contrast=" + contrast);
      await page.waitForFunction(() => {
        const element = document.querySelector("#settingsPanelIm");
        return element.clientWidth > 0;
      });
      assert.equal(await page.locator("#settingsPanelIm").evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true, name + ": horizontal overflow");
      await screenshot(name);
    }
  });
  await test("T8: original 70/70 component contracts and 22 targeted cases", async () => {
    const tab = await context.newPage();
    await tab.goto(base + "/components.html");
    await tab.addScriptTag({ url: base + "/tools/prototype-contracts.js" });
    const result = await tab.evaluate(() => window.runPrototypeContracts());
    await writeFile(join(output, "t8.json"), JSON.stringify(result, null, 2));
    assert.equal(result.ok, true, JSON.stringify(result.failures));
    assert.equal(result.passedCards, 70); assert.equal(result.targetedCards, 22);
    await tab.close();
  });
  await test("T9: original normal / 200% scale / dock-closed page audit", async () => {
    const results = [];
    for (const [name, scale, hash] of [["normal", 1, ""], ["zoom200", 2, ""], ["closed", 1, "&dock=closed"]]) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: scale });
      const tab = await ctx.newPage();
      await tab.goto(base + "/apple-inspired-ui.html#audit=1" + hash);
      await tab.waitForFunction(() => !!document.getElementById("LAYOUT_OUT"));
      const result = JSON.parse(await tab.locator("#LAYOUT_OUT").textContent());
      results.push({ name, ...result });
      await ctx.close();
    }
    await writeFile(join(output, "t9.json"), JSON.stringify(results, null, 2));
    assert.equal(results.every((result) => result.ok), true, JSON.stringify(results.flatMap((result) => result.failures)));
  });
  await test("console health", async () => assert.deepEqual(errors, []));
} finally {
  await writeFile(join(output, "result.json"), JSON.stringify({ ok: checks.every((check) => check.passed), browser: browser.version(), base, checks, errors }, null, 2));
  await browser.close();
}
if (checks.some((check) => !check.passed)) process.exitCode = 1;
console.log(checks.filter((check) => check.passed).length + "/" + checks.length + " checks passed. Evidence: " + output);
