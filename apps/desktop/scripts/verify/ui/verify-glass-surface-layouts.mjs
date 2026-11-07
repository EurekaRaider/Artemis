import assert from "node:assert/strict";
import { PROTOCOL_VERSION } from "@artemis/protocol";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const require = createRequire(import.meta.url);
const { _electron } = require("playwright-core");
const output = resolve(
  process.argv[2] ?? "artifacts/verification/ui-redesign/review-05/local",
);
await mkdir(output, { recursive: true });
const views = [
  "conversation-timeline-empty",
  "conversation-timeline-failed",
  "nocturne-project-menu",
  "conversation-timeline-plan",
  "conversation-timeline-rich",
  "environment-feedback-approval",
  "goal-paused",
  "nocturne-branch-menu",
  "nocturne-thread-menu",
  "nocturne-workspace-menu",
  "nocturne-group",
  "nocturne-review-comment-wide",
  "nocturne-update-error",
  "environment-open",
  "environment-pr-checks",
  "icon-sizing-environment-commit",
  "nocturne-resources-plugins",
  "nocturne-resources-mcp",
  "nocturne-resources-skills",
  "secondary-pages-token-usage",
  "secondary-pages-automations",
  "secondary-pages-archive",
  "nocturne-settings-providers",
  "nocturne-computer-acting",
  "nocturne-computer-paused",
];
const cases = [
  ...["dark", "light"].flatMap((theme) =>
    views.map((view) => ({ view, theme, locale: "zh-CN", material: "glass" })),
  ),
  ...views
    .filter(
      (view) =>
        !["nocturne-update-error", "nocturne-settings-providers"].includes(
          view,
        ),
    )
    .map((view) => ({ view, theme: "dark", locale: "ar", material: "glass" })),
  ...["dark", "light"].flatMap((theme) =>
    ["conversation-timeline-empty", "conversation-timeline-rich"].flatMap(
      (view) =>
        ["zh-CN", "ar"].map((locale) => ({
          view,
          theme,
          locale,
          material: "solid",
        })),
    ),
  ),
];
cases.push(
  ...["dark", "light"].map((theme) => ({
    view: "conversation-timeline-empty",
    theme,
    material: "glass",
    locale: "zh-CN",
    usageEmpty: true,
  })),
);
const filter = process.env.ARTEMIS_REVIEW_FILTER;
const records = filter
  ? await readFile(join(output, "report.json"), "utf8")
      .then(JSON.parse)
      .catch(() => [])
  : [];
for (const testCase of cases.filter(
  (c) =>
    !filter ||
    `${c.view}-${c.theme}-${c.material}-${c.locale}`.includes(filter),
)) {
  const { view, theme, material, locale } = testCase;
  const id = `${view}${testCase.usageEmpty ? "-usage-empty" : ""}-${theme}-${material}-${locale}`;
  const userData = await mkdtemp(join(tmpdir(), "artemis-review05-"));
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
    ARTEMIS_SMOKE_SCREENSHOT: join(userData, "smoke.png"),
    ARTEMIS_SMOKE_ACCESSIBILITY: join(userData, "audit.json"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ARTEMIS_DEV_SERVER_URL;
  const record = {
    ...testCase,
    id,
    browser:
      "Browser plugin not available; repository Playwright Electron workflow",
    assertions: [],
    metrics: {},
    errors: [],
  };
  let app;
  const check = (name, actual, pass) =>
    record.assertions.push({ name, actual, pass: Boolean(pass) });
  try {
    console.log(`START ${id}`);
    app = await _electron.launch({
      timeout: 60000,
      executablePath: require("electron"),
      args: [desktop, `--user-data-dir=${userData}`],
      cwd: desktop,
      env,
    });
    await app.evaluate(({ app }) => {
      app.__review05Quit = app.quit;
      app.__review05Exit = app.exit;
      app.quit = () => {};
      app.exit = () => {};
    });
    const page = await app.firstWindow({ timeout: 60000 });
    page.setDefaultTimeout(12000);
    page.on("pageerror", (error) => record.errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") record.errors.push(message.text());
    });
    await page.waitForSelector('[data-renderer-ready="true"]', {
      timeout: 60000,
    });
    await page.waitForFunction(() => document.querySelector(".app-shell"));
    const until = Date.now() + 60000;
    while (Date.now() < until) {
      if (
        await readFile(join(userData, "audit.json"), "utf8")
          .then(() => true)
          .catch(() => false)
      )
        break;
      await page.waitForTimeout(100);
    }
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(160);
    record.metrics.identity = { url: page.url(), title: await page.title() };
    check(
      "page identity",
      record.metrics.identity,
      page.url().includes("dist-renderer") &&
        /Artemis/u.test(await page.title()),
    );
    check(
      "meaningful content",
      (await page.locator("body").innerText()).length,
      (await page.locator("body").innerText()).length > 20,
    );
    check(
      "no framework overlay",
      await page.locator("vite-error-overlay, nextjs-portal").count(),
      (await page.locator("vite-error-overlay, nextjs-portal").count()) === 0,
    );
    const metrics = async (selector) =>
      page.locator(selector).evaluateAll((elements) =>
        elements.map((element) => {
          const style = getComputedStyle(element),
            before = getComputedStyle(element, "::before");
          return {
            text: element.textContent.trim(),
            status: element.getAttribute("data-status"),
            title: element.getAttribute("title"),
            className: element.className,
            tag: element.tagName,
            rect: element.getBoundingClientRect().toJSON(),
            display: style.display,
            opacity: style.opacity,
            background: style.backgroundColor,
            color: style.color,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            fontFamily: style.fontFamily,
            lineHeight: style.lineHeight,
            borderWidth: style.borderTopWidth,
            borderColor: style.borderTopColor,
            radius: style.borderRadius,
            paddingTop: style.paddingTop,
            paddingBottom: style.paddingBottom,
            paddingInlineEnd: style.paddingInlineEnd,
            marginBlockStart: style.marginBlockStart,
            gap: style.gap,
            rowGap: style.rowGap,
            columnGap: style.columnGap,
            mask: style.maskImage,
            backdropFilter: style.backdropFilter,
            boxShadow: style.boxShadow,
            outline: style.outlineWidth,
            outlineStyle: style.outlineStyle,
            resize: style.resize,
            direction: style.direction,
            bidi: style.unicodeBidi,
            scrollLeft: element.scrollLeft,
            before: {
              content: before.content,
              color: before.color,
              background: before.backgroundColor,
              width: before.width,
              height: before.height,
            },
            svgCount: element.querySelectorAll("svg").length,
            icons: [...element.querySelectorAll("svg[data-artemis-icon]")].map(
              (icon) => icon.dataset.artemisIcon,
            ),
          };
        }),
      );
    const reference = async (token) =>
      page.evaluate((token) => {
        const span = document.createElement("span");
        span.style.color = `var(${token})`;
        document.body.append(span);
        const color = getComputedStyle(span).color;
        span.remove();
        return color;
      }, token);
    const auditMaterial = async (stage) => {
      const audit = await page.evaluate(() => {
        const visible = (el) => {
          const r = el.getBoundingClientRect(),
            c = getComputedStyle(el);
          return (
            r.width > 0 &&
            r.height > 0 &&
            c.display !== "none" &&
            c.visibility === "visible"
          );
        };
        const effects = [];
        for (const el of document.querySelectorAll("body *")) {
          if (
            !(el instanceof HTMLElement) ||
            !visible(el) ||
            el.matches(
              '.sidebar-rail, .sidebar > [data-part="main"], .computer-control, .computer-preview-card',
            )
          )
            continue;
          for (const pseudo of [
            null,
            "::before",
            "::after",
            ...(el instanceof HTMLDialogElement ? ["::backdrop"] : []),
          ]) {
            const value = getComputedStyle(el, pseudo).backdropFilter;
            if (value && value !== "none")
              effects.push({
                tag: el.tagName,
                className: el.className,
                pseudo,
                value,
              });
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext("2d");
        const surfaces = [
          ...document.querySelectorAll(
            '.workspace, .workspace-header, .composer, [role="menu"]:not(.model-picker-menu), .model-picker-navigation, .model-picker-options, .environment-popover, .environment-checks-popover, .settings-panel, .settings-panel [data-artemis-component="settings-surface"], .update-failure',
          ),
        ]
          .filter(visible)
          .map((el) => {
            const css = getComputedStyle(el);
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = css.backgroundColor;
            ctx.fillRect(0, 0, 1, 1);
            return {
              className: el.className,
              background: css.backgroundColor,
              alpha: ctx.getImageData(0, 0, 1, 1).data[3] / 255,
              shadow: css.boxShadow,
              radius: css.borderRadius,
            };
          });
        const sidebar = document.querySelector('.sidebar > [data-part="main"]');
        return {
          effective: document.documentElement.dataset.material,
          native: document.querySelector(".app-shell")?.dataset.windowMaterial,
          sidebar: sidebar
            ? {
                background: getComputedStyle(sidebar).backgroundColor,
                filter: getComputedStyle(sidebar).backdropFilter,
              }
            : null,
          effects,
          surfaces,
        };
      });
      record.metrics["material-" + stage] = audit;
      check(
        stage +
          ": backdrop effects limited to sidebar and computer operation overlays",
        audit.effects,
        audit.effects.length === 0,
      );
      check(
        stage + ": painted chrome surfaces are opaque",
        audit.surfaces.filter((x) => x.alpha > 0 && x.alpha < 1),
        audit.surfaces.length > 0 &&
          audit.surfaces.every((x) => x.alpha === 0 || x.alpha === 1),
      );
    };
    // Every color is composited over its actual ancestor surface before comparison.
    record.metrics.controls = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const rgba = (color) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data].map((v, i) =>
          i === 3 ? v / 255 : v,
        );
      };
      const composite = (fg, bg) =>
        fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]));
      const background = (element) => {
        const layers = [];
        for (let p = element; p; p = p.parentElement)
          layers.unshift(rgba(getComputedStyle(p).backgroundColor));
        return layers.reduce((bg, fg) => composite(fg, bg), [255, 255, 255]);
      };
      const luminance = (rgb) =>
        rgb
          .map((v) => {
            v /= 255;
            return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
          })
          .reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i], 0);
      const contrast = (a, b) => {
        const x = luminance(a),
          y = luminance(b);
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
      };
      const visible = (el) => {
        const r = el.getBoundingClientRect(),
          s = getComputedStyle(el);
        return (
          r.width > 0 &&
          r.height > 0 &&
          s.visibility === "visible" &&
          s.opacity !== "0"
        );
      };
      return {
        buttons: [...document.querySelectorAll("button")]
          .filter(
            (el) =>
              visible(el) &&
              !el.matches(".send-button:not(.stop)") &&
              !(
                el.closest('[data-artemis-component="data-heatmap"]') &&
                el.getAttribute("data-part") === "cell"
              ),
          )
          .map((el) => ({
            text: el.textContent.trim().slice(0, 60),
            className: el.className,
            colorScheme: getComputedStyle(el).colorScheme,
            background: background(el),
            luminance: luminance(background(el)),
          })),
        switches: [
          ...document.querySelectorAll('[data-artemis-component="switch"]'),
        ]
          .filter(visible)
          .map((el) => {
            const track = el.querySelector('[data-part="track"]'),
              thumb = el.querySelector('[data-part="thumb"]');
            return {
              checked: el.querySelector("input").checked,
              track: background(track),
              surface: background(el),
              thumb: background(thumb),
              surfaceContrast: contrast(background(track), background(el)),
              thumbContrast: contrast(background(thumb), background(track)),
              rect: track.getBoundingClientRect().toJSON(),
            };
          }),
      };
    });
    const c = record.metrics.controls;
    check(
      "text button background luminance",
      c.buttons.filter((x) =>
        x.colorScheme === "dark" ? x.luminance > 0.6 : x.luminance < 0.2,
      ),
      c.buttons.length > 0 &&
        c.buttons.every((x) =>
          x.colorScheme === "dark" ? x.luminance <= 0.6 : x.luminance >= 0.2,
        ),
    );
    if (c.switches.some((x) => x.checked))
      check(
        "on switches contrast with surface and white thumb >= 3:1",
        c.switches.filter((x) => x.checked),
        c.switches
          .filter((x) => x.checked)
          .every((x) => x.surfaceContrast >= 3 && x.thumbContrast >= 3),
      );
    if (await page.locator(".decision-card:visible").count()) {
      record.metrics.decisions = {
        area: await metrics(".decision-option-area:visible"),
        options: await metrics(".decision-option:visible"),
        card: await metrics(".decision-card:visible"),
        reply: await metrics(".decision-reply input:visible"),
      };
      const d = record.metrics.decisions;
      check(
        "decision option separator is visible",
        d.area,
        d.area.length > 0 && d.area.every((x) => x.borderWidth === "1px"),
      );
      check(
        "decision options at least 40px, 9px radius, 8px by 12px padding",
        d.options,
        d.options.length > 0 &&
          d.options.every(
            (x) =>
              x.rect.height >= 40 &&
              x.radius === "9px" &&
              x.paddingTop === "8px" &&
              x.paddingInlineEnd === "12px",
          ),
      );
      check(
        "options inset 6px from card",
        d,
        d.options.every(
          (x) =>
            Math.abs(
              (locale === "ar"
                ? d.card[0].rect.right - x.rect.right
                : x.rect.left - d.card[0].rect.left) - 6,
            ) <= 1,
        ),
      );
    }
    if (await page.locator(".decision-card:visible").count()) {
      const alignment = await page
        .locator(".decision-card:visible")
        .evaluateAll((cards) =>
          cards
            .map((card) => {
              const label = card.querySelector(".decision-option-copy strong"),
                hint = card.querySelector(".decision-keyboard-hint");
              if (!label || !hint) return null;
              const range = document.createRange();
              range.selectNodeContents(hint);
              const a = label.getBoundingClientRect(),
                b = range.getBoundingClientRect(),
                rtl = getComputedStyle(card).direction === "rtl";
              return { delta: rtl ? b.right - a.right : b.left - a.left };
            })
            .filter(Boolean),
        );
      record.metrics.decisionTextAlignment = alignment;
      check(
        "decision hint text aligns with actual option text",
        alignment,
        alignment.every((x) => Math.abs(x.delta) <= 1),
      );
    }
    if (await page.locator(".send-button.stop:visible").count()) {
      const stop = page.locator(".send-button.stop:visible");
      record.metrics.stop = await stop.evaluate((el) => ({
        title: el.title,
        rect: el.getBoundingClientRect().toJSON(),
        track: el.querySelector("circle")?.outerHTML,
        square: el.querySelector("rect")?.getBoundingClientRect().toJSON(),
        arc: el.querySelector("path")?.outerHTML,
      }));
      const s = record.metrics.stop;
      check(
        "stop has same-circle track and rounded arc; square 8px",
        s,
        !!s.track &&
          s.arc?.includes('stroke-linecap="round"') &&
          s.square.width === 8 &&
          s.square.height === 8,
      );
      await page.emulateMedia({ reducedMotion: "reduce" });
      const animation = await stop
        .locator(".stop-progress-arc")
        .evaluate((el) => getComputedStyle(el).animationName);
      check(
        "stop arc static with reduced motion",
        animation,
        animation === "none",
      );
      await page.emulateMedia({ reducedMotion: "no-preference" });
    }
    record.metrics.send = await metrics(".send-button:visible");
    record.metrics.profile = await metrics(".sidebar-profile-avatar");
    record.metrics.agentMeta = await metrics(
      '.work-record-agent [data-part="indicator"]:visible',
    );
    if (record.metrics.agentMeta.length)
      check(
        "timeline status column does not duplicate icons",
        record.metrics.agentMeta,
        record.metrics.agentMeta.every((x) => x.svgCount === 0),
      );
    if (view === "nocturne-branch-menu") {
      const trigger = page.locator(".branch-context-trigger");
      if ((await trigger.getAttribute("aria-expanded")) === "true")
        await trigger.click();
      await trigger.hover();
      await trigger.click();
      await page.locator(".branch-list > button").first().waitFor();
      const [a] = await metrics(".branch-context-trigger"),
        [b] = await metrics(".branch-context-menu");
      record.metrics.branch = {
        trigger: a,
        menu: b,
        rows: await metrics(".branch-list > button"),
        names: await metrics(".branch-list strong"),
        changes: await metrics(".branch-change-count"),
      };
      const delta =
        locale === "ar"
          ? b.rect.right - a.rect.right
          : b.rect.left - a.rect.left;
      check(
        "branch menu aligned to trigger within 1px",
        delta,
        Math.abs(delta) <= 1,
      );
      check(
        "branch rows stay 32px",
        record.metrics.branch.rows,
        record.metrics.branch.rows.every((x) => x.rect.height === 32),
      );
      check(
        "branch names rendered in one span",
        await page.locator(".branch-list strong > *").count(),
        (await page.locator(".branch-list strong > *").count()) === 0,
      );
    }
    if (["nocturne-thread-menu", "nocturne-project-menu"].includes(view)) {
      await page.keyboard.press("Escape");
      const selector =
        view === "nocturne-thread-menu"
          ? ".project-thread-row .thread-action"
          : ".project-action";
      const trigger = page.locator(selector).first();
      await trigger.hover();
      await trigger.click();
      const menu =
        view === "nocturne-thread-menu" ? ".thread-menu" : ".project-menu";
      await page.locator(menu).waitFor();
      const separators = await metrics(menu + ' [role="separator"]');
      record.metrics.menu = {
        root: await metrics(menu),
        separators,
        items: await metrics(menu + ' [role^="menuitem"]'),
      };
      check(
        "exactly one visible menu separator",
        separators,
        separators.length === 1 && separators[0].rect.height === 1,
      );
      check(
        "danger menu items have no automatic border",
        record.metrics.menu.items.filter((x) => x.className.includes("danger")),
        record.metrics.menu.items
          .filter((x) => x.className.includes("danger"))
          .every((x) => x.borderWidth === "0px"),
      );
      check(
        "menu minimum width 200px",
        record.metrics.menu.root,
        record.metrics.menu.root[0].rect.width >= 200,
      );
    }
    if (view === "nocturne-workspace-menu") {
      const trigger = page.locator(".environment-workspace-trigger").first();
      if ((await trigger.getAttribute("aria-expanded")) === "true")
        await trigger.click();
      await trigger.hover();
      await trigger.click();
      record.metrics.workspace = await metrics(
        ".environment-workspace-menu button",
      );
      check(
        "handoff fork and management layers",
        record.metrics.workspace,
        record.metrics.workspace.some((x) => x.icons.includes("fork")) &&
          record.metrics.workspace.some((x) => x.icons.includes("layers")),
      );
    }
    if (view === "conversation-timeline-failed")
      record.metrics.failure = await metrics(".turn-error-actions > button");
    if (view === "conversation-timeline-empty") {
      await page.locator(".approval-policy-trigger").click();
      const selected = await metrics(".approval-policy-menu .selected");
      record.metrics.approval = selected;
      check(
        "selected approval has s2 background",
        selected,
        selected.length === 1 && selected[0].background !== "rgba(0, 0, 0, 0)",
      );
      await page.screenshot({
        path: join(output, id + "-approval.png"),
        scale: "css",
      });
      await page.keyboard.press("Escape");
      record.metrics.welcome = await metrics(".conversation-empty-state h1");
      const prompt = page.locator(".composer textarea");
      await prompt.fill("/");
      const slash = page.locator("#skill-command-menu");
      const slashAvailable = await slash
        .waitFor({ timeout: 3000 })
        .then(() => true)
        .catch(() => false);
      record.metrics.slashAvailable = slashAvailable;
      if (slashAvailable) {
        await auditMaterial("slash-menu");
        record.metrics.slash = await metrics("#skill-command-menu");
        await page.screenshot({
          path: join(output, id + "-slash.png"),
          scale: "css",
        });
      }
      await page.keyboard.press("Escape");
      await prompt.fill("");
    }
    if (view === "nocturne-update-error") {
      record.metrics.update = {
        title: await metrics(".update-failure strong"),
        retry: await metrics(".update-failure-actions button"),
        details: await metrics(".update-failure summary"),
      };
      const u = record.metrics.update;
      check(
        "retry is neutral refresh button",
        u.retry,
        u.retry.length === 1 &&
          u.retry[0].icons.includes("refresh") &&
          !u.retry[0].icons.includes("alert"),
      );
      check(
        "retry and details align with failure title",
        u,
        Math.abs(u.retry[0].rect.left - u.title[0].rect.left) <= 1 &&
          Math.abs(u.details[0].rect.left - u.title[0].rect.left) <= 1,
      );
      await page.locator(".update-failure summary").click();
      check(
        "details opens via mouse",
        await page.locator(".update-failure details").getAttribute("open"),
        (await page.locator(".update-failure details").getAttribute("open")) !==
          null,
      );
    }
    if (view === "goal-paused") {
      record.metrics.goal = await metrics(
        ".goal-bar-objective, .goal-bar-icon, .goal-bar-status",
      );
      const objective = await metrics(".goal-bar-objective");
      check(
        "paused visible objective uses secondary text",
        objective,
        objective[0]?.color === (await reference("--muted")),
      );
    }
    if (view === "nocturne-group")
      record.metrics.group = {
        people: await metrics(".im-member-kind:visible"),
        avatars: await metrics(".group-message-avatar:visible"),
        records: await metrics(".work-record > summary:visible"),
        recordIcons: await metrics(".work-record > summary > svg:first-child"),
      };
    if (view === "environment-open")
      record.metrics.environment = {
        agents: await metrics(".environment-activity-row"),
        fileStatus: await metrics(".environment-file-row .file-status"),
        path: await metrics(".environment-workspace-path"),
      };
    if (view === "environment-pr-checks") {
      record.metrics.pr = {
        title: await metrics(".environment-pr-title"),
        badges: await metrics(".environment-pr-badges > *"),
        warning: await metrics(".environment-pr-warning"),
      };
      const badges = record.metrics.pr.badges;
      check(
        "PR state and checks share second row",
        badges,
        badges.length === 2 &&
          Math.abs(
            badges[0].rect.top +
              badges[0].rect.height / 2 -
              (badges[1].rect.top + badges[1].rect.height / 2),
          ) <= 1,
      );
      await page.screenshot({
        path: join(output, id + "-card.png"),
        scale: "css",
      });
      await page.locator(".environment-pr-check-summary").hover();
      check(
        "PR checks popover opens with mouse hover",
        await page.locator("#environment-pr-checks:visible").count(),
        (await page.locator("#environment-pr-checks:visible").count()) === 1,
      );
    }
    if (view === "icon-sizing-environment-commit") {
      record.metrics.commit = await metrics(".environment-panel-header");
      check(
        "commit subview title has no ellipsis",
        record.metrics.commit,
        record.metrics.commit.length > 0 &&
          record.metrics.commit.every((x) => !x.text.includes("…")),
      );
    }
    if (view.startsWith("nocturne-resources-")) {
      record.metrics.resources = {
        buttons: await metrics(
          ".resource-list-heading-actions > button:last-child",
        ),
        rows: await metrics(
          '.resource-management-list > [data-artemis-component="management-row"], .resource-mcp-list > [data-artemis-component="management-row"]',
        ),
        headers: await metrics(
          '.resource-management-section > [data-part="header"]',
        ),
        titles: await metrics(
          '.resource-management-section > [data-part="header"] [data-part="title"]',
        ),
        segments: await metrics('.resource-category-tabs [data-part="count"]'),
        install: await metrics(
          '.plugin-market-card-actions[data-installed="false"] [data-artemis-component="button"][data-variant="secondary"]',
        ),
        mcp: await metrics(".resource-mcp-chips"),
        versions: await metrics(".plugin-market-card-vn"),
      };
      record.metrics.counts = await page
        .locator('.resource-category-tabs [data-part="count"]')
        .evaluateAll((items) =>
          items.map((count) => {
            const range = document.createRange();
            range.selectNodeContents(count.parentElement.firstChild);
            const label = range.getBoundingClientRect(),
              rect = count.getBoundingClientRect();
            const style = getComputedStyle(count);
            return {
              gap:
                style.direction === "rtl"
                  ? label.left - rect.right
                  : rect.left - label.right,
              weight: style.fontWeight,
              color: style.color,
            };
          }),
        );
      if (record.metrics.counts.length)
        check(
          "segment count text gap 6px and weight 400",
          record.metrics.counts,
          record.metrics.counts.every(
            (c) => Math.abs(c.gap - 6) <= 1 && c.weight === "400",
          ),
        );
      record.metrics.headingAlignment = await page
        .locator('.resource-management-section > [data-part="header"]')
        .evaluateAll((headers) =>
          headers.flatMap((header) => {
            const title = header.querySelector('[data-part="title"]'),
              buttons = header.querySelectorAll("button");
            if (!title || !buttons.length) return [];
            const a = title.getBoundingClientRect(),
              b = buttons[buttons.length - 1].getBoundingClientRect();
            return [
              {
                titleCenter: a.top + a.height / 2,
                buttonCenter: b.top + b.height / 2,
              },
            ];
          }),
        );
      if (record.metrics.headingAlignment.length)
        check(
          "resource heading title and action centered",
          record.metrics.headingAlignment,
          record.metrics.headingAlignment.every(
            (x) => Math.abs(x.titleCenter - x.buttonCenter) <= 1,
          ),
        );
      const r = record.metrics.resources;
      if (view === "nocturne-resources-plugins")
        check(
          "all visible plugin install actions have transparent fill and 1px border",
          r.install,
          r.install.length >= 3 &&
            r.install.every(
              (button) =>
                button.background === "rgba(0, 0, 0, 0)" &&
                button.borderWidth === "1px",
            ),
        );
      if (r.buttons.length && r.rows.length)
        check(
          "last visible heading button edge aligns with list row within 1px",
          { buttons: r.buttons, rows: r.rows },
          r.buttons.every(
            (b) =>
              Math.min(
                ...r.rows.map((row) =>
                  Math.abs(
                    locale === "ar"
                      ? b.rect.left - row.rect.left
                      : b.rect.right - row.rect.right,
                  ),
                ),
              ) <= 1,
          ),
        );
      if (view === "nocturne-resources-mcp")
        check(
          "remote badge and host stay on one line",
          await metrics(".resource-mcp-remote > *"),
          (await metrics(".resource-mcp-remote > *")).length === 2 &&
            (await metrics(".resource-mcp-remote > *")).every(
              (x, _, all) =>
                x.rect.height < 22 &&
                Math.abs(
                  x.rect.top +
                    x.rect.height / 2 -
                    all[0].rect.top -
                    all[0].rect.height / 2,
                ) <= 1,
            ),
        );
    }
    if (testCase.usageEmpty || view === "secondary-pages-token-usage") {
      if (testCase.usageEmpty) {
        await page
          .locator('.nav-row:has([data-artemis-icon="token-usage"])')
          .click();
        await page.locator(".token-usage-models").waitFor();
      }
      record.metrics.usage = {
        models: await metrics(".token-usage-models"),
        composition: await metrics(".token-usage-composition-bar"),
      };
      check(
        "both usage chart cards present",
        record.metrics.usage,
        record.metrics.usage.models.length === 1 &&
          record.metrics.usage.composition.length === 1 &&
          record.metrics.usage.composition[0].rect.height === 10,
      );
      if (testCase.usageEmpty)
        check(
          "real navigation: empty model explanatory copy",
          await page.locator(".token-model-empty").count(),
          (await page.locator(".token-model-empty").count()) === 1,
        );
    }
    if (view === "secondary-pages-automations")
      record.metrics.automation = await metrics(
        '.automation-week [data-scheduled="true"] > *',
      );
    if (view === "nocturne-review-comment-wide") {
      record.metrics.diff = await metrics(".review-line code");
      check(
        "diff content uses Geist Mono",
        record.metrics.diff,
        record.metrics.diff.length > 0 &&
          record.metrics.diff.every((x) =>
            x.fontFamily.startsWith('"Geist Mono"'),
          ),
      );
      record.metrics.userAvatar = await metrics(".review-comment-avatar");
      // Rendering-only language probe: the same review code element, including its syntax-token child.
      record.metrics.diffLanguages = await page.evaluate(() => {
        const line = document.querySelector(".review-file");
        const original = line.dataset.language;
        const values = ["markdown", "text", "typescript"].map((language) => {
          line.dataset.language = language;
          return {
            language,
            font: getComputedStyle(line.querySelector(".review-line code"))
              .fontFamily,
            tokenFont: getComputedStyle(
              line.querySelector(".review-line code span") ??
                line.querySelector(".review-line code"),
            ).fontFamily,
          };
        });
        line.dataset.language = original;
        return values;
      });
      check(
        "Markdown, plain text and TS inherit monospace",
        record.metrics.diffLanguages,
        record.metrics.diffLanguages.every(
          (x) =>
            x.font.startsWith('"Geist Mono"') &&
            x.tokenFont.startsWith('"Geist Mono"'),
        ),
      );
    }
    if (view === "nocturne-settings-providers") {
      record.metrics.settings = {
        key: await metrics(".provider-key-field"),
        keyInput: await metrics(".provider-api-key input"),
        url: await metrics(".provider-base-url input"),
        selectedRow: await metrics(
          '.provider-navigation-item[data-state="selected"]',
        ),
        selectedTile: await metrics(
          '.provider-navigation-item[data-state="selected"] .provider-icon-tile',
        ),
      };
      const s = record.metrics.settings;
      check(
        "visible API-key field and Base URL both 32px",
        s,
        s.key.length > 0 &&
          s.url.length > 0 &&
          [...s.key, ...s.keyInput, ...s.url].every(
            (x) => x.rect.height === 32,
          ),
      );
      await auditMaterial("settings");
      await page.screenshot({
        path: join(output, id + "-settings.png"),
        scale: "css",
      });
      await page.locator(".settings-header button").click();
      const model = page.locator(".model-button");
      await model.click();
      await page.locator(".model-picker-menu").waitFor();
      record.metrics.modelMenu = await metrics(".model-picker-menu");
      await page.locator(".model-picker-navigation > button").nth(1).hover();
      record.metrics.thinkingMenu = await metrics(".model-picker-menu");
      await page.screenshot({
        path: join(output, id + "-thinking.png"),
        scale: "css",
      });
      await page.locator(".model-picker-navigation > button").first().hover();
      await page.screenshot({
        path: join(output, id + "-model.png"),
        scale: "css",
      });
      check(
        "configured model menu opens by real mouse",
        record.metrics.modelMenu,
        record.metrics.modelMenu.length === 1,
      );
    }
    if (view.startsWith("nocturne-computer-")) {
      await page.locator(".computer-control").waitFor();
      record.metrics.computerControl = await metrics(".computer-control");
      check(
        "computer operation control retains glass",
        record.metrics.computerControl,
        record.metrics.computerControl.every((x) =>
          x.backdropFilter.includes("panelGlass"),
        ),
      );
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].webContents.send(
          "artemis:computer-previews",
          [
            {
              version: 1,
              sessionId: "review05-preview",
              threadId: "artemis-smoke-environment-thread",
              target: {
                id: "review05-window",
                kind: "desktop",
                name: "Synthetic preview (visual fixture)",
              },
              state: "starting",
              timestamp: Date.now(),
              sequence: 0,
              actualFps: 0,
            },
          ],
        );
      });
      await page.locator(".computer-preview-card").waitFor();
      await page.locator(".computer-preview-card canvas").evaluate((canvas) => {
        canvas.width = 640;
        canvas.height = 400;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#19222e";
        ctx.fillRect(0, 0, 640, 400);
        ctx.fillStyle = "#eef2f7";
        ctx.font = "18px monospace";
        for (let y = 24; y < 400; y += 24)
          ctx.fillText("Synthetic preview / glass verification", 14, y);
      });
      await page.locator(".computer-preview-card").hover();
      await page.waitForTimeout(180);
      record.metrics.computerPreview = await page
        .locator(".computer-preview-card")
        .evaluate((el) => {
          const css = getComputedStyle(el, "::after");
          return {
            filter: css.backdropFilter,
            mask: css.maskImage,
            opacity: css.opacity,
          };
        });
      check(
        "computer preview retains hover blur",
        record.metrics.computerPreview,
        record.metrics.computerPreview.filter === "blur(10px)" &&
          record.metrics.computerPreview.opacity === "1",
      );
      await page.screenshot({
        path: join(output, id + "-computer.png"),
        scale: "css",
      });
    }
    await auditMaterial("final");
    check("runtime console health", record.errors, record.errors.length === 0);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: join(output, `${id}.png`), scale: "css" });
  } catch (error) {
    record.error = String(error.stack ?? error);
    if (app) {
      const pages = app.windows();
      if (pages[0])
        await pages[0]
          .screenshot({ path: join(output, `${id}-error.png`) })
          .catch(() => {});
    }
  } finally {
    if (app) {
      await app
        .evaluate(({ app }) => {
          app.quit = app.__review05Quit;
          app.exit = app.__review05Exit;
        })
        .catch(() => {});
      await app.close().catch(() => {});
    }
    await rm(userData, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  }
  record.pass = !record.error && record.assertions.every((x) => x.pass);
  const old = records.findIndex((x) => x.id === id);
  if (old >= 0) records[old] = record;
  else records.push(record);
  await writeFile(
    join(output, `${id}.metrics.json`),
    JSON.stringify(record, null, 2),
  );
  await writeFile(
    join(output, "report.json"),
    JSON.stringify(records, null, 2),
  );
  console.log(
    `${record.pass ? "PASS" : "FAIL"} ${id} ${record.assertions.filter((x) => x.pass).length}/${record.assertions.length}${record.error ? ` ${record.error.split("\n")[0]}` : ""}`,
  );
  for (const item of record.assertions.filter((x) => !x.pass))
    console.log(`  ${item.name}: ${JSON.stringify(item.actual).slice(0, 500)}`);
}
const failed = records.filter((x) => !x.pass);
console.log(
  `${records.length - failed.length}/${records.length} cases passed; ${records.reduce((n, x) => n + x.assertions.length, 0)} assertions`,
);
assert.equal(
  failed.length,
  0,
  "Fifth review rendered regression checks failed",
);
