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
  process.argv[2] ?? "artifacts/verification/ui-redesign/review-03/local",
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
const pendingViews = [
  "environment-feedback-approval",
  "conversation-timeline-rich",
  "conversation-timeline-plan",
];

async function verifyKeycaps(page, checks, context, selector) {
  const keycaps = await page
    .locator(`${selector}:visible`)
    .evaluateAll((items) =>
      items.map((item) => {
        const style = getComputedStyle(item);
        const reference = document.createElement("span");
        reference.style.cssText =
          "color:var(--muted-2);background:var(--panel);font-family:var(--mono-font);box-shadow:inset 0 0 0 1px var(--border)";
        item.parentElement.append(reference);
        const expected = getComputedStyle(reference);
        const range = document.createRange();
        range.selectNodeContents(item);
        const result = {
          text: item.textContent.trim(),
          tag: item.tagName,
          shared: item.getAttribute("data-artemis-keycap"),
          height: item.getBoundingClientRect().height,
          textWidth: range.getBoundingClientRect().width,
          fontSize: style.fontSize,
          fontFamily: style.fontFamily,
          color: style.color,
          background: style.backgroundColor,
          shadow: style.boxShadow,
          expected: {
            fontFamily: expected.fontFamily,
            color: expected.color,
            background: expected.backgroundColor,
            shadow: expected.boxShadow,
          },
        };
        reference.remove();
        return result;
      }),
    );
  (checks.keycaps ??= {})[context] = keycaps;
  assert.ok(keycaps.length > 0, `${context} contains visible keycaps`);
  for (const cap of keycaps) {
    assert.equal(cap.tag, "KBD", `${context}: semantic keycap`);
    assert.equal(cap.shared, "true", `${context}: shared Keycap component`);
    assert.ok(
      cap.text.length > 0 && cap.textWidth > 0,
      `${context}: key text exists`,
    );
    assert.ok(
      Math.abs(cap.height - 18) <= 0.5,
      `${context}: keycap height is 18px`,
    );
    assert.equal(cap.fontSize, "10.5px", `${context}: keycap text is 10.5px`);
    for (const property of ["fontFamily", "color", "background", "shadow"])
      assert.equal(
        cap[property],
        cap.expected[property],
        `${context}: ${property}`,
      );
  }
}

async function verifyResourceAvatars(
  page,
  checks,
  context,
  selector,
  tileSize,
  glyphSize,
) {
  const icons = await page.locator(`${selector}:visible`).evaluateAll((items) =>
    items.map((item) => {
      const glyph = item.querySelector(
        ":scope > svg, :scope > img, :scope > .resource-brand-mark",
      );
      if (!glyph)
        throw new Error(
          `ResourceAvatar ${item.dataset.kind}/${item.dataset.icon} has no graphic`,
        );
      const tile = item.getBoundingClientRect();
      const graphic = glyph.getBoundingClientRect();
      return {
        kind: item.dataset.kind,
        icon: item.dataset.icon,
        plugin: item.dataset.plugin === "true",
        tile: tile.toJSON(),
        graphic: graphic.toJSON(),
        graphicType: glyph.tagName,
        imageLoaded:
          !(glyph instanceof HTMLImageElement) ||
          (glyph.complete && glyph.naturalWidth > 0),
        mask: glyph.classList.contains("resource-brand-mark")
          ? getComputedStyle(glyph).maskImage
          : undefined,
        offsetX: graphic.x + graphic.width / 2 - (tile.x + tile.width / 2),
        offsetY: graphic.y + graphic.height / 2 - (tile.y + tile.height / 2),
      };
    }),
  );
  (checks.resourceAvatars ??= {})[context] = icons;
  assert.ok(icons.length > 0, `${context} contains rendered resource avatars`);
  for (const icon of icons) {
    const name = `${context}: ${icon.kind}/${icon.icon}`;
    assert.ok(icon.imageLoaded, `${name} image has loaded`);
    assert.notEqual(icon.mask, "none", `${name} brand mask exists`);
    for (const axis of ["width", "height"]) {
      assert.ok(
        Math.abs(icon.tile[axis] - tileSize) <= 0.5,
        `${name} tile ${axis} is ${tileSize}px`,
      );
      assert.ok(
        Math.abs(icon.graphic[axis] - glyphSize) <= 0.5,
        `${name} graphic ${axis} is ${glyphSize}px`,
      );
    }
    assert.ok(
      Math.abs(icon.offsetX) <= 0.5 && Math.abs(icon.offsetY) <= 0.5,
      `${name} graphic center offset is (${icon.offsetX}, ${icon.offsetY}), expected <= 0.5px`,
    );
  }
}

async function verifyPendingGap(page, checks) {
  const card = page.locator(".timeline-decision .decision-card:visible");
  assert.equal(await card.count(), 1, "one pending decision card is rendered");
  await page.locator(".timeline-scroll").evaluate((scroll) => {
    scroll.scrollTop = scroll.scrollHeight;
  });
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  checks.pendingGap = await card.evaluate((element) => {
    const visible = (candidate) =>
      candidate && candidate.getBoundingClientRect().height > 0;
    const target = element.closest(".timeline-decision");
    let previous = target.previousElementSibling;
    while (previous && !visible(previous))
      previous = previous.previousElementSibling;
    if (!previous)
      throw new Error("Pending decision has no preceding timeline content");
    const status = document.querySelector(".composer-status-row");
    const following = visible(status)
      ? status
      : document.querySelector(".composer");
    if (!visible(following))
      throw new Error("Pending decision has no following composer/status row");
    const bounds = element.getBoundingClientRect();
    const before = previous.getBoundingClientRect();
    const after = following.getBoundingClientRect();
    return {
      card: bounds.toJSON(),
      preceding: { className: previous.className, rect: before.toJSON() },
      following: { className: following.className, rect: after.toJSON() },
      above: bounds.top - before.bottom,
      below: after.top - bounds.bottom,
    };
  });
  for (const side of ["above", "below"])
    assert.ok(
      checks.pendingGap[side] >= 11.5 && checks.pendingGap[side] <= 16.5,
      `pending decision ${side} gap is ${checks.pendingGap[side]}px, expected 12–16px`,
    );
}

const cases = [];
for (const theme of ["dark", "light"]) {
  for (const material of ["solid", "glass"])
    for (const view of ["conversation-timeline-empty", "goal-paused"])
      cases.push({ view, theme, material });
  for (const view of pendingViews)
    cases.push({ view, theme, material: "glass" });
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
cases.push({
  view: "environment-feedback-approval",
  theme: "dark",
  material: "glass",
  locale: "ar",
});
const selectedCases = cases.filter(
  (c) =>
    !filter ||
    new RegExp(filter).test(
      [c.view, c.theme, c.material ?? "solid", c.locale ?? "zh-CN"].join("-"),
    ) ||
    new RegExp(filter).test([c.view, c.theme, c.locale].join("-")),
);
assert.ok(selectedCases.length > 0, `No review cases matched ${filter}`);
for (const testCase of selectedCases) {
  const { view, theme, material = "solid", locale = "zh-CN" } = testCase;
  const id = [view, theme, material, locale].join("-");
  const prior = results.findIndex((r) => r.id === id);
  if (prior >= 0) results.splice(prior, 1);
  const dir = await mkdtemp(join(tmpdir(), "artemis-review03-"));
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
      await verifyResourceAvatars(
        page,
        checks,
        section,
        section === "plugins"
          ? ".plugin-market-card-heading .resource-avatar"
          : section === "skills"
            ? ".resource-skill-row .resource-avatar"
            : ".resource-mcp-row .resource-avatar",
        section === "plugins" ? 36 : 28,
        section === "plugins" ? 20 : 16,
      );
    }
    if (
      await page
        .locator(".environment-context-row .resource-avatar:visible")
        .count()
    )
      await verifyResourceAvatars(
        page,
        checks,
        "environment",
        ".environment-context-row .resource-avatar",
        14,
        14,
      );
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
      const measurements = await page.evaluate(() => {
        const selectors = [
          ".assistant-message",
          ".work-record",
          ".decision-card",
          ".decision-command",
          ".decision-reason",
          ".decision-option",
          ".decision-submit",
          ".timeline-decision",
          ".composer",
          ".composer-status-row",
          ".send-button",
          ".stop-button",
          ".composer-context",
          ".composer-hint",
          ".goal-strip",
          ".goal-bar",
          ".task-plan-progress",
          ".thread-menu",
          ".thread-menu [role=menuitem]",
          ".thread-time",
          ".thread-waiting-badge",
          "[data-artemis-keycap]",
          ".sidebar-search",
          ".sidebar-nav",
          ".nav-row",
          ".local-user-name",
          ".app-version",
          ".update-failure summary",
          ".approval-policy-menu small",
          ".approval-policy-menu svg",
          ".environment-workspace-trigger",
          ".environment-branch-list",
          ".branch-context-menu .branch-list",
          ".branch-context-menu .branch-list strong",
          ".branch-context-menu .branch-list strong > span",
          ".composer-context-hint",
          ".environment-workspace-menu > [data-part=content] > button > small",
          ".environment-panel-header",
          ".environment-panel-header > small",
          ".environment-checks-popover",
          ".environment-push-info",
          ".environment-activity-row",
          ".im-member-kind",
          ".im-member-computer",
          ".im-member-executor",
          ".im-group-manage",
          ".im-delegation-countdown",
          ".resource-avatar",
          ".resource-page",
          ".resource-mcp-row",
          ".resource-refresh",
          ".resource-management-section > [data-part=header]",
          ".resource-skill-row",
          ".resource-skill-source",
          ".resource-remove-button",
          ".plugin-market-card",
          ".plugin-market-card > [data-part=content]",
          ".resource-add-button.subtle",
          ".plugin-market-card-vn",
          ".provider-navigation-item",
          ".provider-sidebar-heading > strong",
          ".provider-navigation",
          ".provider-detail",
          ".provider-detail h3",
          ".provider-detail label",
          ".provider-add-service",
          ".provider-import",
          ".provider-detail-heading",
          ".provider-icon-tile",
          ".provider-base-url",
          ".provider-credentials h3",
          ".provider-models",
          ".added-model-row",
          ".added-model-context",
          ".added-model-table-header",
          ".added-model-table-header > *",
          ".added-model-copy > *",
          ".added-model-row [data-part=leading] svg",
          ".added-model-default",
          ".provider-defaults",
          ".settings-tabs[data-artemis-component=tabs] [data-part=tab]",
          ".settings-import-shortcut",
          ".settings-mode-capabilities",
          ".settings-panel [data-part=description]",
          ".settings-mode-capabilities th",
          ".settings-mode-capabilities td",
          ".settings-mode-capabilities td svg",
          ".settings-form-row",
          ".appearance-settings-controls",
          ".appearance-settings-controls > *",
          ".settings-form-row > [data-artemis-component]",
          ".settings-section [data-part=title]",
          ".settings-release-summary",
          ".settings-content",
          ".settings-panel [data-artemis-component=switch] [data-part=control]",
          '.settings-panel[data-tab="general"] [data-artemis-component="switch"] [data-part="track"]',
          '.settings-panel[data-tab="capabilities"] .settings-section:has(> [data-part="content"] > .settings-mode-capabilities) > [data-part="content"] > .settings-hint',
          ".settings-global-agents textarea",
          ".settings-empty-inline",
          ".im-header-copy p",
          ".im-service-block",
          ".im-channel-row",
          ".token-usage-summary",
          ".token-usage-summary [data-artemis-component=data-stat]",
          ".token-usage-summary [data-part=detail]",
          ".token-usage-activity h2",
          ".token-usage-chart",
          ".token-usage-models",
          ".token-usage-model-bar",
          ".token-usage-model-bar > span",
          ".archive-card time",
          ".archive-item-date",
          ".automation-context",
          ".automation-master-copy small",
          ".automation-master-schedule",
          ".automation-context dd",
          ".automation-schedule-summary",
          ".terminal-host",
          ".xterm-helper-textarea",
          ".xterm-viewport",
          ".xterm-scrollable-element",
          ".xterm-screen",
          ".xterm-scrollable-element .scrollbar",
          ".xterm-scrollable-element .slider",
          ".xterm-decoration",
          ".xterm-decoration-overview-ruler",
        ];
        return Object.fromEntries(
          selectors.map((selector) => [
            selector,
            [...document.querySelectorAll(selector)].slice(0, 16).map((el) => {
              const r = el.getBoundingClientRect(),
                c = getComputedStyle(el);
              return {
                text: el.textContent?.trim().slice(0, 180),
                rect: r.toJSON(),
                clientWidth: el.clientWidth,
                scrollWidth: el.scrollWidth,
                font: c.fontSize,
                fontFamily: c.fontFamily,
                weight: c.fontWeight,
                color: c.color,
                background: c.backgroundColor,
                padding: c.padding,
                margin: c.margin,
                gap: c.gap,
                border: c.border,
                borderRadius: c.borderRadius,
                outline: c.outlineStyle,
                overflow: c.overflow,
                opacity: c.opacity,
                display: c.display,
                gridTemplateColumns: c.gridTemplateColumns,
                textAlign: c.textAlign,
                resize: c.resize,
                scrollbarWidth: c.scrollbarWidth,
                webkitScrollbarWidth: getComputedStyle(
                  el,
                  "::-webkit-scrollbar",
                ).width,
              };
            }),
          ]),
        );
      });
      await writeFile(
        join(output, name + ".metrics.json"),
        JSON.stringify(measurements, null, 2) + "\n",
      );
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
        await verifyKeycaps(
          page,
          checks,
          "sidebar",
          ".sidebar [data-artemis-keycap]",
        );
        await verifyKeycaps(
          page,
          checks,
          "composer",
          ".composer-context-row [data-artemis-keycap]",
        );
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
    // These regressions are checked against rendered geometry, before Dock interactions.
    if (pendingViews.includes(view)) {
      const waiting = await page
        .locator(".workspace-header .status-pill")
        .getAttribute("class");
      assert.match(waiting, /waiting-/);
      const activeRow = page.locator(".project-thread-row.selected");
      assert.equal(await activeRow.count(), 1);
      assert.equal(await activeRow.locator(".thread-waiting-badge").count(), 1);
      checks.pendingHeader = waiting;
      checks.waitingBadges = await page
        .locator(".thread-waiting-badge")
        .count();
      assert.ok(
        checks.waitingBadges > 0,
        "pending decision is shown in sidebar metadata",
      );
      assert.equal(await activeRow.locator(".status-dot.running").count(), 0);
      checks.pendingBadge = await activeRow
        .locator(".thread-waiting-badge")
        .evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            text: element.textContent.trim(),
            rect: element.getBoundingClientRect().toJSON(),
            color: style.color,
            opacity: style.opacity,
            visibility: style.visibility,
          };
        });
      assert.ok(
        checks.pendingBadge.text.length > 0 &&
          checks.pendingBadge.rect.width > 0 &&
          checks.pendingBadge.rect.height > 0,
      );
      assert.equal(checks.pendingBadge.opacity, "1");
      assert.equal(checks.pendingBadge.visibility, "visible");
      if (material === "glass") {
        assert.equal(
          await page.locator("html").getAttribute("data-material"),
          "glass",
        );
        await verifyKeycaps(
          page,
          checks,
          "sidebar",
          ".sidebar [data-artemis-keycap]",
        );
      }
      await verifyPendingGap(page, checks);
    }
    if (view === "environment-feedback-approval") {
      checks.intermediate = await page
        .locator(".work-record .assistant-message")
        .evaluate((el) => {
          const rect = el.getBoundingClientRect();
          const col = el.closest(".work-record").getBoundingClientRect();
          return {
            left: rect.left,
            columnLeft: col.left,
            right: rect.right,
            columnRight: col.right,
            scrollWidth: el.scrollWidth,
            clientWidth: el.clientWidth,
            actions: el.querySelectorAll(".message-actions").length,
          };
        });
      const r = checks.intermediate;
      assert.ok(r.left >= r.columnLeft - 1 && r.right <= r.columnRight + 1);
      assert.ok(r.scrollWidth <= r.clientWidth);
      assert.equal(r.actions, 0);
    }
    if (view === "conversation-timeline-failed") {
      checks.failure = await page
        .locator(".turn-error-banner")
        .evaluate((el) => {
          const r = el.getBoundingClientRect(),
            c = document.querySelector(".composer").getBoundingClientRect();
          return {
            left: r.left,
            right: r.right,
            composerLeft: c.left,
            composerRight: c.right,
          };
        });
      assert.ok(
        Math.abs(checks.failure.left - checks.failure.composerLeft) <= 1 &&
          Math.abs(checks.failure.right - checks.failure.composerRight) <= 1,
      );
    }
    if (view === "secondary-pages-token-usage") {
      await page.locator(".token-usage-profile").scrollIntoViewIfNeeded();
      checks.kpis = await page
        .locator('.token-usage-summary [data-artemis-component="data-stat"]')
        .evaluateAll((items) =>
          items.map((el) => {
            const r = el.getBoundingClientRect(),
              d = el.querySelector('[data-part="detail"]'),
              v = el.querySelector('[data-part="value"]'),
              dr = d.getBoundingClientRect(),
              vr = v.getBoundingClientRect();
            return {
              card: r.toJSON(),
              detail: dr.toJSON(),
              value: vr.toJSON(),
              font: getComputedStyle(d).fontSize,
              text: d.textContent,
            };
          }),
        );
      assert.equal(checks.kpis.length, 4);
      for (const k of checks.kpis) {
        assert.ok(k.detail.bottom <= k.card.bottom);
        assert.ok(k.detail.left >= k.card.left);
        const start = locale === "ar" ? "right" : "left";
        assert.ok(Math.abs(k.detail[start] - k.value[start]) <= 1);
        assert.ok(Math.abs(k.detail.top - k.value.bottom - 4) <= 1);
        assert.equal(k.font, "11.5px");
      }
      assert.equal(await page.locator(".token-usage-models table").count(), 0);
    }
    if (view === "nocturne-thread-menu") {
      await page.keyboard.press("Escape");
      const trigger = page
        .locator(
          ".project-thread-row .thread-action,.thread-row .thread-action",
        )
        .first();
      await trigger.hover();
      await trigger.click();
      await page.locator(".thread-menu").waitFor();
      checks.threadMenu = await page.locator(".thread-menu").evaluate((el) => ({
        width: el.getBoundingClientRect().width,
        items: [...el.querySelectorAll('[role="menuitem"]')].map((i) => ({
          height: i.getBoundingClientRect().height,
          scroll: i.scrollWidth,
          width: i.clientWidth,
        })),
        tooltips: [...document.querySelectorAll('[role="tooltip"]')].filter(
          (t) => t.getBoundingClientRect().width > 0,
        ).length,
      }));
      assert.ok(checks.threadMenu.width >= 200);
      assert.ok(checks.threadMenu.items.length > 0);
      for (const i of checks.threadMenu.items) assert.ok(i.height <= 32.1);
      assert.equal(checks.threadMenu.tooltips, 0);
      await verifyKeycaps(
        page,
        checks,
        "menu",
        ".thread-menu [data-artemis-keycap]",
      );
    }
    if (view === "nocturne-branch-menu") {
      const trigger = page.locator(".branch-context-trigger");
      if ((await trigger.getAttribute("aria-expanded")) === "true")
        await trigger.click();
      await trigger.hover();
      await trigger.click();
      await page.locator(".branch-list > button strong").first().waitFor();
      checks.composerBranches = await page
        .locator(".branch-context-menu")
        .evaluate((menu) => ({
          hint: menu.querySelector(".composer-context-hint")?.textContent,
          scrollbarWidth: getComputedStyle(
            menu.querySelector(".branch-list"),
            "::-webkit-scrollbar",
          ).width,
          names: [...menu.querySelectorAll(".branch-list strong")].map(
            (name) => ({
              title: name.title,
              text: name.textContent,
              width: name.clientWidth,
              scrollWidth: name.scrollWidth,
              overflow: getComputedStyle(name).textOverflow,
              tail: name.lastElementChild?.getBoundingClientRect().toJSON(),
              rect: name.getBoundingClientRect().toJSON(),
            }),
          ),
        }));
      assert.ok(checks.composerBranches.hint?.length > 0);
      assert.equal(checks.composerBranches.scrollbarWidth, "6px");
      for (const name of checks.composerBranches.names) {
        assert.equal(name.text, name.title);
        assert.ok(name.scrollWidth <= name.width);
        assert.equal(name.overflow, "clip");
        if (name.tail)
          assert.ok(
            name.tail.right <= name.rect.right + 0.5 &&
              name.tail.left >= name.rect.left - 0.5,
          );
      }
    }
    if (view === "nocturne-workspace-menu") {
      const count = page.locator(
        '.environment-workspace-menu > [data-part="content"] > button > small',
      );
      checks.worktreeCount = await count.evaluate((element) => ({
        text: element.textContent,
        rect: element.getBoundingClientRect().toJSON(),
        whiteSpace: getComputedStyle(element).whiteSpace,
      }));
      assert.equal(checks.worktreeCount.whiteSpace, "nowrap");
      assert.ok(checks.worktreeCount.rect.height <= 20);
      assert.equal(
        await page
          .locator('.environment-workspace-menu [role="separator"]')
          .count(),
        1,
      );
    }
    if (view === "environment-pr-checks") {
      const trigger = page.locator(".environment-pr-check-summary");
      const popover = page.locator(
        '#environment-pr-checks.environment-checks-popover[data-artemis-component="popover"]',
      );
      await trigger.waitFor({ state: "visible" });
      assert.equal(await trigger.count(), 1);
      // Move focus and pointer away from the fixture-opened popover first.
      await page.locator(".workspace-header .environment-trigger").click();
      await popover.waitFor({ state: "hidden" });
      await page.locator(".workspace-header .environment-trigger").click();
      await trigger.waitFor({ state: "visible" });
      const inspectFocus = async (path) => {
        await popover.waitFor({ state: "visible" });
        const state = await popover.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            outline: style.outlineStyle,
            outlineWidth: style.outlineWidth,
            border: style.border,
            shadow: style.boxShadow,
            focused: document.activeElement === element,
            focusVisible: element.matches(":focus-visible"),
            tabIndex: element.tabIndex,
            rows: element.querySelectorAll(".environment-check-list > *")
              .length,
          };
        });
        (checks.prMouseFocus ??= {})[path] = state;
        assert.ok(state.rows > 0, `${path}: PR checks popover has content`);
        assert.equal(
          state.outline,
          "none",
          `${path}: mouse-opened PR popover has no focus outline`,
        );
        assert.equal(
          state.tabIndex,
          -1,
          `${path}: popover container is focusable`,
        );
      };
      await trigger.hover();
      await inspectFocus("hover");
      await shot(id + "-hover");
      // Hover opens the popover; the first click closes it, the second opens it
      // through the actual click handler and moves focus to the container.
      await trigger.click();
      await popover.waitFor({ state: "hidden" });
      await trigger.click();
      await page.waitForFunction(
        () => document.activeElement?.id === "environment-pr-checks",
      );
      await inspectFocus("click");
      assert.equal(checks.prMouseFocus.click.focused, true);
    }

    if (view === "environment-feedback-approval") {
      // Real mouse paths: launcher -> terminal -> last close, then Dock toggle.
      if (
        !(await page
          .locator('[data-artemis-component="workspace-launcher"]')
          .isVisible())
      ) {
        await page.locator(".workspace-header .right-sidebar-toggle").click();
      }
      await page
        .locator('[data-artemis-component="workspace-launcher"]')
        .waitFor({ state: "visible" });
      await verifyKeycaps(
        page,
        checks,
        "dock",
        '[data-artemis-component="workspace-launcher"] [data-artemis-keycap]',
      );
      const terminal = page
        .locator('[data-artemis-component="workspace-launcher"] button')
        .filter({
          has: page.locator('.workspace-launcher-icon[data-kind="terminal"]'),
        });
      await terminal.click();
      await page.locator(".terminal-panel").waitFor();
      await page.locator(".terminal-host .xterm-screen").waitFor();
      await page.waitForTimeout(300);
      checks.terminalScrollbars = await page
        .locator(
          ".terminal-host .xterm-viewport, .terminal-host .xterm-scrollable-element, .terminal-host .xterm-scrollable-element .scrollbar",
        )
        .evaluateAll((items) =>
          items.map((item) => ({
            className: item.className,
            rect: item.getBoundingClientRect().toJSON(),
            scrollbarWidth: getComputedStyle(item).scrollbarWidth,
            overflow: getComputedStyle(item).overflow,
            background: getComputedStyle(item).backgroundColor,
          })),
        );
      for (const item of checks.terminalScrollbars.filter((item) =>
        item.className.includes("xterm-viewport"),
      ))
        assert.equal(
          item.scrollbarWidth,
          "none",
          "xterm legacy native scrollbar is hidden; xterm's custom scrollbar is retained",
        );
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
      // Moving focus during the opening animation must not scroll the shell
      // to the Dock's temporarily translated controls.
      await page.locator(".right-sidebar-toggle").last().focus();
      checks.dock.openingFocus = await page
        .locator(".workspace-content")
        .evaluate((element) => ({
          scrollLeft: element.scrollLeft,
          headerX: element
            .querySelector(".workspace-header")
            .getBoundingClientRect().x,
        }));
      assert.equal(checks.dock.openingFocus.scrollLeft, 0);
      assert.equal(checks.dock.openingFocus.headerX, closed.x);
      await shot(id + "-launcher");
      await page.locator(".right-sidebar-toggle").last().click();
      await page.waitForTimeout(650);
      checks.dock.toggledBeforeSettling = await geometry();
      await page.waitForFunction(
        ({ x, width }) => {
          const rect = document
            .querySelector(".workspace-header")
            .getBoundingClientRect();
          return (
            Math.abs(rect.x - x) < 0.01 && Math.abs(rect.width - width) < 0.01
          );
        },
        closed,
        { timeout: 5000 },
      );
      const toggled = await geometry();
      assert.equal(toggled.x, closed.x);
      assert.equal(
        toggled.width,
        closed.width,
        "both close paths have exactly the same width",
      );
      checks.dock = { ...checks.dock, closed, toggled };
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
      checks.settingsNavigation = await page
        .locator(
          '.settings-tabs[data-artemis-component="tabs"] [data-part="tab"]:visible',
        )
        .evaluateAll((items) =>
          items.map((item) => ({
            id: item.id,
            rect: item.getBoundingClientRect().toJSON(),
            text: item.textContent.trim(),
          })),
        );
      assert.equal(
        checks.settingsNavigation.length,
        tabs.length,
        "every settings navigation row is rendered",
      );
      for (const [index, row] of checks.settingsNavigation.entries()) {
        assert.ok(row.text.length > 0, `${row.id} has a visible label`);
        assert.ok(
          Math.abs(row.rect.height - 32) <= 0.5,
          `${row.id} is 32px high`,
        );
        if (index > 0) {
          const previous = checks.settingsNavigation[index - 1];
          assert.ok(
            Math.abs(row.rect.top - previous.rect.top - 32) <= 0.5,
            `${row.id} follows the previous row at a 32px interval`,
          );
        }
      }
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
    } else {
      await shot();
      if (view.startsWith("nocturne-resources-"))
        await page
          .locator(".resource-page")
          .screenshot({ path: join(output, id + "-page.png"), scale: "css" });
      if (view === "secondary-pages-token-usage") {
        checks.responsiveKpis = [];
        for (const width of [880, 600]) {
          await app.evaluate(({ BrowserWindow }, width) => {
            const window = BrowserWindow.getAllWindows()[0];
            window.setMinimumSize(500, 400);
            window.setSize(width, 900);
          }, width);
          await page.waitForFunction((width) => innerWidth === width, width);
          await page.locator(".token-usage-profile").scrollIntoViewIfNeeded();
          const kpis = await page
            .locator(
              ".token-usage-summary > [data-artemis-component=data-stat]",
            )
            .evaluateAll((items) =>
              items.map((item) => item.getBoundingClientRect().toJSON()),
            );
          const rows = [...new Set(kpis.map((item) => item.top))];
          assert.equal(kpis.length, 4);
          assert.equal(
            rows.length,
            width === 880 ? 2 : 4,
            "KPI cells fill a 2×2 or 1×4 grid without a gap",
          );
          if (width === 880) {
            assert.equal(kpis[0].top, kpis[1].top);
            assert.equal(kpis[2].top, kpis[3].top);
            assert.ok(Math.abs(kpis[0].width - kpis[3].width) <= 1);
          }
          checks.responsiveKpis.push({ width, kpis });
          await shot(id + `-${width}`);
        }
      }
      if (view === "conversation-timeline-empty" && material === "solid") {
        const input = page.locator(".composer-input textarea");
        await input.fill("/");
        await page
          .locator(".slash-command-suggestion .resource-avatar")
          .first()
          .waitFor({ state: "visible" });
        await verifyResourceAvatars(
          page,
          checks,
          "inline",
          ".slash-command-suggestion .resource-avatar",
          14,
          14,
        );
        await shot(id + "-skills");
        const skill = page
          .locator(".slash-command-suggestion")
          .filter({ has: page.locator('.resource-avatar[data-kind="skill"]') })
          .first();
        const skillName = await skill.locator("strong").innerText();
        await skill.click();
        await page.locator(".composer-selected-skill").first().waitFor();
        await page.keyboard.press("Escape");
        await page
          .locator(".composer-selected-skill .resource-avatar")
          .first()
          .waitFor();
        assert.equal(
          await page
            .locator(".composer-selected-skill")
            .first()
            .getAttribute("title"),
          skillName,
          "the clicked skill remains selected after Escape",
        );
        await verifyResourceAvatars(
          page,
          checks,
          "selected-skill",
          ".composer-selected-skill .resource-avatar",
          12,
          12,
        );
        checks.selectedSkillHeight = (
          await page.locator(".composer-selected-skill").first().boundingBox()
        ).height;
        assert.equal(checks.selectedSkillHeight, 24);
        await shot(id + "-selected-skill");
        await input.fill("");
      }
    }
    results.push({ id, passed: true, checks });
    console.log("PASS", id);
  } catch (e) {
    if (app)
      await (
        await app.firstWindow()
      )
        .screenshot({ path: join(output, id + "-failure.png"), scale: "css" })
        .catch(() => {});
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
if (!filter) {
  const keycapContexts = new Set(
    results.flatMap((result) => Object.keys(result.checks.keycaps ?? {})),
  );
  for (const context of ["sidebar", "menu", "composer", "dock"])
    assert.ok(keycapContexts.has(context), `${context} keycaps were exercised`);
  const avatarContexts = new Set(
    results.flatMap((result) =>
      Object.keys(result.checks.resourceAvatars ?? {}),
    ),
  );
  for (const context of ["plugins", "skills", "mcp", "inline"])
    assert.ok(
      avatarContexts.has(context),
      `${context} ResourceAvatar geometry was exercised`,
    );
}
assert.ok(
  results.every((r) => r.passed),
  `${results.filter((r) => !r.passed).length} cases failed; see report.json`,
);
