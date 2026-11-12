import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
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
  process.argv[2] ?? "artifacts/verification/ui-redesign/review-02/local",
);
await mkdir(output, { recursive: true });
const filter = process.env.ARTEMIS_REVIEW_FILTER;
const results = filter
  ? await readFile(join(output, "report.json"), "utf8")
      .then(JSON.parse)
      .catch(() => [])
  : [];
const tabs = [
  "general",
  "providers",
  "agents",
  "im",
  "capabilities",
  "hooks",
  "maintenance",
];
const cases = [];
for (const theme of ["dark", "light"]) {
  for (const material of ["solid", "glass"])
    for (const view of ["conversation-timeline-empty", "goal-paused"])
      cases.push({ view, theme, material });
  for (const count of ["one", "three"])
    cases.push({ view: `conversation-timeline-empty-${count}`, theme });
  for (const view of [
    "nocturne-settings-providers",
    "environment-feedback-approval",
    "conversation-timeline-rich",
    "conversation-timeline-plan",
    "conversation-timeline-failed",
    "multi-question-ui",
    "environment-pr-checks",
    "nocturne-group",
    "nocturne-update-error",
    "nocturne-review-comment-wide",
    "secondary-pages-token-usage",
    "secondary-pages-archive",
    "secondary-pages-automations",
    "nocturne-resources-plugins",
    "nocturne-resources-mcp",
    "nocturne-resources-skills",
    "nocturne-thread-menu",
    "nocturne-workspace-menu",
    "nocturne-branch-menu",
    "nocturne-approval-menu",
    "icon-sizing-environment-commit",
    "nocturne-dock-files",
    "nocturne-computer-acting",
    "nocturne-computer-paused",
  ])
    cases.push({ view, theme });
}
for (const view of [
  "conversation-timeline-empty-three",
  "environment-feedback-approval",
  "multi-question-ui",
  "nocturne-settings-providers",
  "conversation-timeline-plan",
  "conversation-timeline-failed",
  "nocturne-group",
  "nocturne-review-comment-wide",
  "nocturne-thread-menu",
  "nocturne-workspace-menu",
  "nocturne-branch-menu",
  "secondary-pages-token-usage",
  "secondary-pages-archive",
  "secondary-pages-automations",
  "nocturne-resources-plugins",
  "nocturne-resources-mcp",
  "nocturne-resources-skills",
])
  cases.push({ view, theme: "dark", locale: "ar" });
for (const testCase of cases.filter(
  (c) =>
    !filter || new RegExp(filter).test([c.view, c.theme, c.locale].join("-")),
)) {
  const { view, theme, material = "solid", locale = "zh-CN" } = testCase;
  const id = [view, theme, material, locale].join("-");
  const prior = results.findIndex((r) => r.id === id);
  if (prior >= 0) results.splice(prior, 1);
  const dir = await mkdtemp(join(tmpdir(), "artemis-review02-"));
  const env = {
    ...process.env,
    ARTEMIS_SMOKE_VIEW: view,
    ARTEMIS_SMOKE_THEME: theme,
    ARTEMIS_SMOKE_MATERIAL: material,
    ARTEMIS_SMOKE_LOCALE: locale,
    ARTEMIS_SMOKE_DIRECTION: locale === "ar" ? "rtl" : "ltr",
    ARTEMIS_SMOKE_MULTI_UI: "1",
    ARTEMIS_SMOKE_SCALE: "1",
    ARTEMIS_SMOKE_WINDOW_WIDTH: "1440",
    ARTEMIS_SMOKE_WINDOW_HEIGHT: "900",
    ARTEMIS_SMOKE_SCREENSHOT: join(dir, "smoke.png"),
    ARTEMIS_SMOKE_ACCESSIBILITY: join(dir, "audit.json"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ARTEMIS_DEV_SERVER_URL;
  let app;
  let server;
  const errors = [];
  const checks = {};
  try {
    app = await _electron.launch({
      executablePath: require("electron"),
      args: [appDirectory, `--user-data-dir=${dir}`],
      cwd: appDirectory,
      env,
    });
    await app.evaluate(({ app }) => {
      app.__reviewQuit = app.quit;
      app.__reviewExit = app.exit;
      app.quit = () => {};
      app.exit = () => {};
    });
    const page = await app.firstWindow();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.waitForSelector('[data-renderer-ready="true"]', {
      timeout: 60000,
    });
    const until = Date.now() + 60000;
    let audit;
    while (Date.now() < until) {
      try {
        audit = JSON.parse(await readFile(join(dir, "audit.json"), "utf8"));
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    assert.ok(audit, "smoke setup finished");
    checks.runtimeErrors = errors;
    assert.deepEqual(errors, []);
    if (view.startsWith("nocturne-resources-")) {
      const section = view.slice("nocturne-resources-".length);
      const selected = page.locator(`#resource-management-tab-${section}`);
      assert.equal(
        await selected.getAttribute("aria-pressed"),
        "true",
        "requested resource section is selected",
      );
      if (section !== "plugins") {
        const panel = page.locator(`#resource-management-panel-${section}`);
        assert.equal(
          await panel.getAttribute("aria-labelledby"),
          `resource-management-tab-${section}`,
        );
        assert.ok(await panel.isVisible());
      }
    }
    if (view.endsWith("-menu")) {
      checks.menuFocus = await page
        .locator(
          '[role="menu"] :is([role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]):focus-visible',
        )
        .evaluateAll((items) =>
          items.map((item) => ({
            outline: getComputedStyle(item).outlineStyle,
            background: getComputedStyle(item).backgroundColor,
          })),
        );
      for (const item of checks.menuFocus) {
        assert.equal(item.outline, "none");
        assert.notEqual(item.background, "rgba(0, 0, 0, 0)");
      }
    }
    if (view === "nocturne-workspace-menu") {
      checks.workspaceIconColors = await page
        .locator(".environment-workspace-menu svg[data-environment-tone]")
        .evaluateAll((icons) =>
          icons.map((icon) => {
            const expected = document.createElement("span");
            expected.style.color = "var(--muted)";
            icon.parentElement.append(expected);
            const colors = {
              actual: getComputedStyle(icon).color,
              expected: getComputedStyle(expected).color,
            };
            expected.remove();
            return colors;
          }),
        );
      assert.ok(checks.workspaceIconColors.length > 0);
      for (const colors of checks.workspaceIconColors)
        assert.equal(colors.actual, colors.expected);
    }
    if (view === "nocturne-group") {
      assert.ok(
        (await page.locator(".group-message-heading time").count()) > 0,
        "history message times are visible",
      );
      assert.equal(await page.locator(".im-delegation-countdown").count(), 1);
    }
    const workspaceTrigger = page.locator(
      ".environment-popover .environment-workspace-trigger",
    );
    if (await workspaceTrigger.isVisible()) {
      checks.workspaceRow = await workspaceTrigger.evaluate((el) => {
        const row = el.getBoundingClientRect();
        const arrow = el.lastElementChild.getBoundingClientRect();
        return {
          top: row.top,
          bottom: row.bottom,
          arrowTop: arrow.top,
          arrowBottom: arrow.bottom,
        };
      });
      assert.ok(
        checks.workspaceRow.arrowTop >= checks.workspaceRow.top &&
          checks.workspaceRow.arrowBottom <= checks.workspaceRow.bottom,
        "workspace chevron remains inside the row",
      );
    }
    const shot = async (name = id) => {
      await page.screenshot({
        path: join(output, `${name}.png`),
        scale: "css",
      });
    };
    const geometry = () =>
      page
        .locator(".workspace-header")
        .first()
        .evaluate((x) => {
          const r = x.getBoundingClientRect();
          const sidebar = document
            .querySelector(".sidebar")
            .getBoundingClientRect();
          return {
            x: r.x,
            right: r.right,
            y: r.y,
            width: r.width,
            height: r.height,
            sidebarWidth: sidebar.width,
            sidebarX: sidebar.x,
            viewport: innerWidth,
          };
        });
    if (
      view.startsWith("conversation-timeline-empty") ||
      view === "goal-paused"
    ) {
      const g = await geometry();
      checks.header = g;
      assert.equal(g.y, 0);
      assert.equal(g.height, 46);
      assert.ok(Math.abs(g.width - (g.viewport - g.sidebarWidth)) <= 2);
      if (view.startsWith("conversation-timeline-empty")) {
        const count = view.endsWith("three") ? 3 : view.endsWith("one") ? 1 : 0;
        await page.waitForFunction(
          (count) =>
            document.querySelectorAll(".welcome-resume-card").length === count,
          count,
        );
        if (count) {
          const cardColumn = await page
            .locator(".welcome-resume")
            .boundingBox();
          const composer = await page.locator(".composer").boundingBox();
          assert.ok(
            Math.abs(cardColumn.x - composer.x) < 1,
            "resume cards align with the composer",
          );
          assert.ok(
            Math.abs(cardColumn.width - composer.width) < 1,
            "resume cards match composer width",
          );
        }
        checks.cards = await page.locator(".welcome-resume-card").count();
        assert.equal(checks.cards, count);
        assert.equal(
          await page.locator(".welcome-resume").count(),
          count ? 1 : 0,
        );
      }
    }
    if (view === "environment-feedback-approval") {
      // Real mouse paths: launcher -> terminal -> last close, then Dock toggle.
      await page.locator(".workspace-header .right-sidebar-toggle").click();
      const terminal = page
        .locator('[data-artemis-component="workspace-launcher"] button')
        .filter({
          has: page.locator('.workspace-launcher-icon[data-kind="terminal"]'),
        });
      await terminal.click();
      await page.locator(".terminal-panel").waitFor();
      await shot(id + "-terminal");
      await page
        .locator(
          '[data-artemis-component="workspace-tab"] > [data-part="close"]',
        )
        .last()
        .click();
      await page.waitForTimeout(650);
      const closed = await geometry();
      checks.dock = { closed };
      assert.ok(
        Math.abs(
          locale === "ar"
            ? closed.right - closed.sidebarX
            : closed.x - closed.sidebarWidth,
        ) < 1,
        "last close aligns to sidebar",
      );
      await shot(id + "-last-close");
      await page.locator(".workspace-header .right-sidebar-toggle").click();
      await shot(id + "-launcher");
      await page.locator(".right-sidebar-toggle").last().click();
      await page.waitForTimeout(650);
      const toggled = await geometry();
      assert.equal(toggled.x, closed.x);
      assert.equal(
        toggled.width,
        closed.width,
        "both close paths have exactly the same width",
      );
      checks.dock = { closed, toggled };
    }
    if (view === "multi-question-ui") {
      await page
        .locator(
          '[data-tree-row-id="thread:artemis-smoke-multi-ui-thread"] .thread-select',
        )
        .click();
      await page
        .locator(".user-input-card:not(.multi-question) .decision-option")
        .filter({ hasText: "Yes, run the checklist" })
        .click();
      await page.locator(".multi-question").waitFor();
      const state = await page
        .locator(".workspace-header .status-pill")
        .getAttribute("class");
      checks.statusClass = state;
      assert.ok(!state.split(" ").includes("idle"));
      assert.match(state, /waiting/);
    }
    if (view === "nocturne-approval-menu") {
      await page.locator(".approval-policy-trigger").click();
      await page.locator(".approval-policy-menu").waitFor();
    }
    if (view === "secondary-pages-token-usage") {
      if (env.ARTEMIS_SMOKE_USAGE_METADATA === "1") {
        const metadata = page.locator(".token-usage-model-metadata");
        await metadata.waitFor();
        const modelText = await metadata.innerText();
        const costs = await page
          .locator(".token-usage-details > .token-usage-detail-block")
          .first()
          .innerText();
        assert.match(modelText, /claude-sonnet-4-5/);
        for (const amount of [0.01234, 0.00456]) {
          const formatted = new Intl.NumberFormat(locale, {
            style: "currency",
            currency: "USD",
            minimumFractionDigits: 2,
            maximumFractionDigits: 6,
          }).format(amount);
          assert.ok(modelText.includes(formatted));
          assert.ok(costs.includes(formatted));
        }
        checks.usageMetadata = { modelText, costs };
        await shot(id + "-metadata");
        await app.evaluate(({ BrowserWindow }) => {
          BrowserWindow.getAllWindows()[0].setSize(900, 900);
        });
        await page.waitForTimeout(200);
        checks.metadataOverflow = await metadata.evaluate((el) => ({
          width: el.clientWidth,
          scrollWidth: el.scrollWidth,
        }));
        assert.ok(
          checks.metadataOverflow.scrollWidth <=
            checks.metadataOverflow.width + 1,
          "usage metadata wraps in a narrow window",
        );
        await metadata.scrollIntoViewIfNeeded();
        await shot(id + "-metadata-narrow");
        await app.evaluate(({ BrowserWindow }) => {
          BrowserWindow.getAllWindows()[0].setSize(1440, 900);
        });
        await page.waitForTimeout(200);
      }
      checks.compositionContrast = await page
        .locator(".token-usage-composition-marker")
        .evaluateAll((markers) => {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 1;
          const context = canvas.getContext("2d");
          const rgba = (color) => {
            context.clearRect(0, 0, 1, 1);
            context.fillStyle = color;
            context.fillRect(0, 0, 1, 1);
            return [...context.getImageData(0, 0, 1, 1).data];
          };
          const luminance = (values) =>
            values
              .slice(0, 3)
              .map((value) => value / 255)
              .map((v) =>
                v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
              )
              .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
          return markers.map((marker) => {
            const foreground = rgba(getComputedStyle(marker).backgroundColor);
            let parent = marker.parentElement;
            let background = [255, 255, 255, 255];
            while (parent) {
              const candidate = rgba(getComputedStyle(parent).backgroundColor);
              if (candidate[3] === 255) {
                background = candidate;
                break;
              }
              parent = parent.parentElement;
            }
            const fg = luminance(foreground),
              bg = luminance(background);
            return {
              category: marker.className,
              foreground,
              background,
              ratio: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05),
            };
          });
        });
      assert.equal(checks.compositionContrast.length, 4);
      assert.ok(
        checks.compositionContrast.every((c) => c.ratio >= 3),
        "all four composition colors meet 3:1 against their card",
      );
    }
    if (view === "nocturne-dock-files") {
      const fixture = join(dir, "fixtures", "environment-repository");
      await writeFile(
        join(fixture, "review.csv"),
        "File,Status,Lines\nREADME.md,Reviewed,3\nsettings.tsx,Updated,42\n",
      );
      await page.locator(".workspace-header .right-sidebar-toggle").click();
      const launch = async (kind) => {
        await page
          .locator('[data-artemis-component="workspace-launcher"] button')
          .filter({
            has: page.locator(`.workspace-launcher-icon[data-kind="${kind}"]`),
          })
          .click();
      };
      await launch("files");
      const file = (name) =>
        page
          .locator('[data-artemis-component="workspace-file-tree-row"]:visible')
          .filter({ hasText: name });
      await file("README.md").click();
      await page
        .locator('[data-artemis-component="workspace-preview"]')
        .waitFor();
      await shot(id + "-markdown");
      await file("review.csv").click();
      await page.waitForTimeout(800);
      checks.csv = (await page.locator(".office-preview-upgrade").count())
        ? "Office capability required; table not verified"
        : "rendered";
      await shot(id + "-csv");
      await page
        .locator(
          '[data-artemis-component="workspace-tab"] > [data-part="close"]',
        )
        .last()
        .click();
      await page.locator(".workspace-header .right-sidebar-toggle").click();
      await launch("browser");
      await page.locator(".browser-preview-tools").waitFor();
      server = createServer((_request, response) => {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(
          '<!doctype html><html lang="zh-CN"><title>Artemis browser fixture</title><body style="font:16px system-ui;padding:30px;color:#27272a;background:#fafafa"><h1>本地预览</h1><p>浏览器工具栏、响应式尺寸与截图入口。</p></body></html>',
        );
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = page.locator(
        ".browser-address-input input, input.browser-address-input",
      );
      await address.fill(`http://127.0.0.1:${server.address().port}`);
      await address.press("Enter");
      await page.waitForFunction(
        () => !document.querySelector(".browser-preview-error"),
      );
      await page.waitForTimeout(1200);
      const browserEvidence = await app.evaluate(
        async ({ webContents }, prefix) => {
          const target = webContents
            .getAllWebContents()
            .find((contents) => contents.getURL().startsWith(prefix));
          if (!target) throw new Error("Local browser page did not load");
          return {
            title: target.getTitle(),
            png: (await target.capturePage()).toPNG().toString("base64"),
          };
        },
        `http://127.0.0.1:${server.address().port}`,
      );
      assert.equal(browserEvidence.title, "Artemis browser fixture");
      checks.browserPage = browserEvidence.title;
      await writeFile(
        join(output, id + "-browser-content.png"),
        Buffer.from(browserEvidence.png, "base64"),
      );
      await shot(id + "-browser");
      checks.filesAndBrowser = true;
    }
    if (view.startsWith("nocturne-settings")) {
      for (const tab of tabs) {
        await page.locator(`#settings-tab-${tab}-button`).click();
        if (tab === "im") await page.locator(".im-settings").waitFor();
        await page.waitForTimeout(400);
        const importSize = await page
          .locator(".settings-import-shortcut")
          .evaluate((el) => ({
            width: el.clientWidth,
            scroll: el.scrollWidth,
          }));
        assert.ok(
          importSize.scroll <= importSize.width + 1,
          "import button does not overflow",
        );
        await shot(`settings-${tab}-${theme}-${locale}`);
      }
    } else await shot();
    results.push({ id, passed: true, checks });
    console.log("PASS", id);
  } catch (e) {
    results.push({ id, passed: false, checks, error: String(e.stack ?? e) });
    console.error("FAIL", id, String(e));
  } finally {
    if (app) {
      await app
        .evaluate(({ app }) => {
          app.quit = app.__reviewQuit;
          app.exit = app.__reviewExit;
        })
        .catch(() => {});
      await app.close().catch(() => {
        app.process().kill("SIGKILL");
      });
    }
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
}
assert.ok(
  results.every((r) => r.passed),
  `${results.filter((r) => !r.passed).length} cases failed; see report.json`,
);
