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
  process.argv[2] ?? "artifacts/verification/ui-redesign/review-04/local",
);
await mkdir(output, { recursive: true });
const views = [
  "conversation-timeline-empty",
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
];
const cases = [
  ...["dark", "light"].flatMap((theme) =>
    views.map((view) => ({ view, theme, locale: "zh-CN", material: "solid" })),
  ),
  ...views
    .filter(
      (view) =>
        !["nocturne-update-error", "nocturne-settings-providers"].includes(
          view,
        ),
    )
    .map((view) => ({ view, theme: "dark", locale: "ar", material: "solid" })),
  ...["dark", "light"].flatMap((theme) =>
    ["conversation-timeline-empty", "conversation-timeline-rich"].flatMap(
      (view) =>
        ["zh-CN", "ar"].map((locale) => ({
          view,
          theme,
          locale,
          material: "glass",
        })),
    ),
  ),
];
cases.push(
  ...["dark", "light"].map((theme) => ({
    view: "secondary-pages-token-usage",
    theme,
    material: "solid",
    locale: "zh-CN",
    cache: true,
  })),
  {
    view: "secondary-pages-token-usage",
    theme: "dark",
    material: "solid",
    locale: "ar",
    cache: true,
  },
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
  const id = `${view}${testCase.cache ? "-cache" : ""}-${theme}-${material}-${locale}`;
  const userData = await mkdtemp(join(tmpdir(), "artemis-review04-"));
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
    app = await _electron.launch({
      executablePath: require("electron"),
      args: [desktop, `--user-data-dir=${userData}`],
      cwd: desktop,
      env,
    });
    await app.evaluate(({ app }) => {
      app.__review04Quit = app.quit;
      app.__review04Exit = app.exit;
      app.quit = () => {};
      app.exit = () => {};
    });
    const page = await app.firstWindow();
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
    if (testCase.cache) {
      // Live usage IPC, isolated smoke window only; no store or network mutation.
      await app.evaluate(
        ({ BrowserWindow }, event) =>
          BrowserWindow.getAllWindows()[0].webContents.send(
            "artemis:agent-event",
            event,
          ),
        {
          protocolVersion: PROTOCOL_VERSION,
          eventId: "artemis-review04-cache",
          threadId: "artemis-review04-cache",
          turnId: "artemis-review04-cache",
          seq: 1,
          timestamp: new Date().toISOString(),
          payload: {
            type: "assistant.usage",
            providerId: "artemis-smoke",
            modelId: "card-heatmap-probe",
            inputTokens: 1000,
            outputTokens: 1000,
            cacheReadTokens: 3000,
            cacheWriteTokens: 1000,
            cacheReadReported: true,
            totalTokens: 6000,
          },
        },
      );
      await page.waitForFunction(
        () =>
          document.querySelectorAll(".token-usage-summary [data-part=value]")
            .length === 5,
      );
    }
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
    record.metrics.ready = await metrics(".workspace-header .status-dot.idle");
    const readyColor = await reference("--success");
    if (record.metrics.ready.length)
      check(
        "ready dot uses success color",
        record.metrics.ready,
        record.metrics.ready.every((x) => x.background === readyColor),
      );
    record.metrics.scrollOwners = await page.evaluate(() =>
      [...document.querySelectorAll(".app-shell *")]
        .filter((element) => {
          const css = getComputedStyle(element);
          return (
            element.clientHeight > 0 &&
            element.scrollHeight > element.clientHeight + 1 &&
            /auto|scroll/u.test(css.overflowY)
          );
        })
        .map((element) => {
          const thumb = getComputedStyle(element, "::-webkit-scrollbar-thumb"),
            bar = getComputedStyle(element, "::-webkit-scrollbar");
          return {
            className: element.className,
            part: element.getAttribute("data-part"),
            component: element.getAttribute("data-artemis-component"),
            barWidth: bar.width,
            thumb: thumb.backgroundColor,
            border: thumb.borderLeftWidth,
          };
        }),
    );
    check(
      "scroll owners share a 6px visible thumb",
      record.metrics.scrollOwners,
      record.metrics.scrollOwners.every(
        (x) => x.barWidth === "10px" && x.border === "2px",
      ),
    );
    record.metrics.agentMeta = await page
      .locator(".work-record-agent:visible")
      .evaluateAll((rows) =>
        rows.map((row) => ({
          row: row.getBoundingClientRect().toJSON(),
          parent: row.parentElement.getBoundingClientRect().toJSON(),
          direction: getComputedStyle(row).direction,
          indicator: row
            .querySelector('[data-part="indicator"]')
            .getBoundingClientRect()
            .toJSON(),
          status: row.querySelector(".work-record-agent-status").textContent,
        })),
      );
    for (const item of record.metrics.agentMeta)
      check(
        "agent status reaches trailing edge",
        item,
        item.direction === "rtl"
          ? Math.abs(item.parent.left - item.row.left) <= 1 &&
              Math.abs(item.row.left - item.indicator.left) <= 1
          : Math.abs(item.parent.right - item.row.right) <= 1 &&
              Math.abs(item.row.right - item.indicator.right) <= 1,
      );
    const sidebar = await metrics(
      ".sidebar-new-task, .sidebar-search, .sidebar-nav .nav-row:first-child, .project-thread-row",
    );
    record.metrics.sidebar = sidebar;
    const alignment = await page.evaluate(() =>
      [
        ".sidebar-new-task",
        ".sidebar-search",
        ".sidebar-nav .nav-row",
        ".project-thread-row",
      ].map((s) => {
        const e = document.querySelector(s),
          r = e?.getBoundingClientRect();
        return {
          selector: s,
          left: r?.left,
          right: r?.right,
          height: r?.height,
        };
      }),
    );
    record.metrics.sidebarAlignment = alignment;
    const rows = alignment.filter((row) => row.height > 0);
    if (rows.length === 4)
      check(
        "sidebar rows align within 1px",
        alignment,
        Math.max(...rows.map((x) => x.left)) -
          Math.min(...rows.map((x) => x.left)) <=
          1 &&
          Math.max(...rows.map((x) => x.right)) -
            Math.min(...rows.map((x) => x.right)) <=
            1,
      );
    const add = await metrics(".project-group-row .project-new-thread");
    record.metrics.addProject = add;
    if (add.length) {
      const task = (await metrics(".sidebar-new-task"))[0];
      const edge =
        locale === "ar"
          ? task.rect.left + parseFloat(task.paddingInlineEnd)
          : task.rect.right - parseFloat(task.paddingInlineEnd);
      check(
        "project plus aligns with navigation trailing content",
        { add: add[0].rect, edge },
        Math.abs(
          (locale === "ar" ? add[0].rect.left : add[0].rect.right) - edge,
        ) <= 1,
      );
    }
    if (add.length)
      check(
        "project plus visible without hover",
        add[0],
        add[0].opacity === "1" && add[0].rect.width === 20,
      );
    if (view === "conversation-timeline-empty" && material === "solid") {
      await app.evaluate(({ dialog }) => {
        globalThis.__review04DialogCalls = [];
        globalThis.__review04OriginalDialog = dialog.showOpenDialog;
        dialog.showOpenDialog = async (...args) => {
          globalThis.__review04DialogCalls.push(args.at(-1));
          return { canceled: true, filePaths: [] };
        };
      });
      try {
        await page
          .locator(".project-group-row .project-new-thread")
          .first()
          .click();
        await page.waitForTimeout(150);
        record.metrics.folderDialog = await app.evaluate(
          () => globalThis.__review04DialogCalls,
        );
        check(
          "project plus opens folder chooser by real click",
          record.metrics.folderDialog,
          record.metrics.folderDialog.some((x) =>
            x.properties?.includes("openDirectory"),
          ),
        );
      } finally {
        await app.evaluate(({ dialog }) => {
          dialog.showOpenDialog = globalThis.__review04OriginalDialog;
        });
      }
    }
    if (material === "glass") {
      record.metrics.flatControls = await metrics(
        ".composer, .composer-run-modes, .sidebar-new-task, .sidebar-nav .nav-row[aria-current=page], .project-thread-row.selected, .workspace-header .status-pill, .workspace-header .environment-trigger, .workspace-header .left-sidebar-toggle, .workspace-header .right-sidebar-toggle",
      );
      for (const item of record.metrics.flatControls)
        check(
          `flat glass control ${item.tag}/${item.text.slice(0, 12)}`,
          item,
          item.backdropFilter === "none" &&
            !/inset (?:0px )?1px 0px/u.test(item.boxShadow) &&
            (item.radius !== "999px" || item.className.includes("status-pill")),
        );
    }
    if (view === "nocturne-branch-menu") {
      const trigger = page.locator(".branch-context-trigger");
      if ((await trigger.getAttribute("aria-expanded")) === "true")
        await trigger.click();
      await trigger.hover();
      await trigger.click();
      await page.locator(".branch-list > button").first().waitFor();
      record.metrics.branch = {
        list: await metrics(".branch-context-menu .branch-list"),
        hint: await metrics(".branch-context-menu .composer-context-hint"),
        create: await metrics(".branch-menu-actions"),
        names: await metrics(".branch-list strong"),
      };
      const b = record.metrics.branch;
      check(
        "branch create action above list",
        b.create[0].rect.bottom - b.list[0].rect.top,
        b.create[0].rect.bottom <= b.list[0].rect.top + 1,
      );
      check(
        "branch footer separator and padding",
        b.hint[0],
        parseFloat(b.hint[0].borderWidth) === 1 &&
          b.hint[0].paddingTop === "8px" &&
          b.hint[0].fontSize === "11.5px",
      );
      check(
        "branch list fades partial last row",
        b.list[0].mask,
        b.list[0].mask !== "none",
      );
      check(
        "long branch has no extra gap",
        b.names.map((x) => x.gap),
        b.names.every((x) => ["0px", "normal"].includes(x.columnGap)),
      );
    }
    if (view === "nocturne-thread-menu") {
      await page.keyboard.press("Escape");
      const trigger = page
        .locator(".project-thread-row .thread-action")
        .first();
      await trigger.hover();
      await trigger.click();
      await page.locator(".thread-menu").waitFor();
      record.metrics.threadMenu = await metrics(".thread-menu:visible");
      check(
        "real mouse click opens task menu",
        record.metrics.threadMenu,
        record.metrics.threadMenu.length === 1,
      );
    }
    if (view === "nocturne-workspace-menu") {
      const trigger = page.locator(".environment-workspace-trigger").first();
      if ((await trigger.getAttribute("aria-expanded")) === "true")
        await trigger.click();
      await trigger.hover();
      await trigger.click();
      record.metrics.workspaceMenu = await metrics(
        ".environment-workspace-menu button",
      );
      check(
        "workspace menu uses branch and layers",
        record.metrics.workspaceMenu.flatMap((x) => x.icons),
        record.metrics.workspaceMenu.some((x) => x.icons.includes("layers")),
      );
    }
    if (view === "environment-feedback-approval") {
      record.metrics.intermediate = await page
        .locator(".turn-execution-entries > .assistant-message")
        .evaluateAll((elements) =>
          elements.map((el) => ({
            top: el.getBoundingClientRect().top,
            precedingBottom:
              el.previousElementSibling?.getBoundingClientRect().bottom,
            left: el.getBoundingClientRect().left,
            scrollWidth: el.scrollWidth,
            clientWidth: el.clientWidth,
          })),
        );
      for (const item of record.metrics.intermediate)
        check(
          "intermediate reply has 12–16px separation",
          item,
          item.top - item.precedingBottom >= 12 &&
            item.top - item.precedingBottom <= 16 &&
            item.scrollWidth <= item.clientWidth,
        );
    }
    if (view === "goal-paused") {
      await page.mouse.move(0, 0);
      record.metrics.goal = {
        bar: await metrics(".goal-bar"),
        secondary: await metrics(".goal-bar-secondary"),
        actions: await metrics(".goal-bar-actions > button"),
      };
      check(
        "hidden goal actions occupy zero width",
        record.metrics.goal.secondary,
        record.metrics.goal.secondary.every(
          (x) => x.display === "none" && x.rect.width === 0,
        ),
      );
      const action = record.metrics.goal.actions.find((x) => x.rect.width > 0);
      if (action)
        check(
          "primary goal action reaches trailing padding",
          { bar: record.metrics.goal.bar[0].rect, action: action.rect },
          locale === "ar"
            ? Math.abs(
                action.rect.left - record.metrics.goal.bar[0].rect.left - 12,
              ) <= 1
            : Math.abs(
                record.metrics.goal.bar[0].rect.right - action.rect.right - 12,
              ) <= 1,
        );
      await page.locator(".goal-bar").hover();
      record.metrics.goal.hoverSecondary = await metrics(".goal-bar-secondary");
      check(
        "goal secondary actions reveal on hover",
        record.metrics.goal.hoverSecondary,
        record.metrics.goal.hoverSecondary.every((x) => x.rect.width > 0),
      );
      await page.mouse.move(0, 0);
    }
    if (view === "conversation-timeline-plan") {
      record.metrics.plan = {
        options: await metrics(".plan-execution-options"),
        steps: await metrics(".plan-decision-content ol > li"),
        summaries: await metrics(".work-record-summary"),
      };
      check(
        "plan mode has no orphan bullet",
        record.metrics.plan.options,
        record.metrics.plan.options.every((x) => !/[•·▾]/u.test(x.text)),
      );
      check(
        "plan step typography",
        record.metrics.plan.steps,
        record.metrics.plan.steps.every(
          (x) => x.fontSize === "13px" && x.lineHeight === "26px",
        ),
      );
      check(
        "instant empty work record hidden",
        record.metrics.plan.summaries.length,
        record.metrics.plan.summaries.length === 0,
      );
    }
    if (await page.locator(".approval-decision").count()) {
      record.metrics.approval = {
        reason: await metrics(".decision-reason"),
        metadata: await metrics(".decision-metadata"),
        titles: await metrics(".decision-option-copy > strong"),
      };
      const { reason, metadata, titles } = record.metrics.approval;
      if (reason.length && metadata.length)
        check(
          "reason before risk metadata",
          { reason: reason[0].rect, metadata: metadata[0].rect },
          reason[0].rect.bottom <= metadata[0].rect.top,
        );
      check(
        "decision option weight and size",
        titles,
        titles.every((x) => x.fontSize === "13.5px" && x.fontWeight === "400"),
      );
    }
    if (view === "nocturne-group") {
      record.metrics.group = {
        heading: await metrics(".assistant-message .group-message-heading"),
        record: await metrics(".assistant-message .work-record > summary"),
        actions: await metrics(".assistant-message .message-action"),
        wait: await metrics(".im-delegation-wait summary"),
        close: await metrics(".im-delegation-cancel"),
        members: await metrics(".im-group-members .im-member-action"),
        channel: await metrics(
          '.im-group-channel small[data-state="connected"]',
        ),
      };
      const g = record.metrics.group;
      check(
        "connected channel uses muted text and a success dot",
        g.channel,
        g.channel.length === 1 &&
          g.channel[0].color === (await reference("--muted-2")) &&
          g.channel[0].before.background === readyColor &&
          g.channel[0].before.width === "5px",
      );
      if (g.heading.length && g.actions.length)
        check(
          "group message actions align to body",
          { body: g.heading[0].rect, action: g.actions[0].rect },
          locale === "ar"
            ? Math.abs(g.heading[0].rect.right - g.actions[0].rect.right) <= 1
            : Math.abs(g.heading[0].rect.left - g.actions[0].rect.left) <= 1,
        );

      if (g.heading.length && g.record.length)
        check(
          "group record below identity at body edge",
          { heading: g.heading[0].rect, record: g.record[0].rect },
          g.record[0].rect.top >= g.heading[0].rect.bottom &&
            Math.abs(g.record[0].rect.left - g.heading[0].rect.left) <= 1,
        );
      if (g.wait.length && g.close.length)
        check(
          "group waiting close vertically centered",
          { summary: g.wait[0].rect, close: g.close[0].rect },
          Math.abs(
            g.wait[0].rect.top +
              g.wait[0].rect.height / 2 -
              (g.close[0].rect.top + g.close[0].rect.height / 2),
          ) <= 1,
        );
      check(
        "member actions hidden by default",
        g.members,
        g.members.every((x) => x.opacity === "0" || x.rect.width === 0),
      );
    }
    if (view === "nocturne-review-comment-wide") {
      await page.locator(".review-comment-editor textarea").click();
      record.metrics.comment = {
        input: await metrics(".review-comment-editor textarea"),
        card: await metrics(".review-comment-editor"),
        heading: await metrics(".review-comment-heading"),
        segments: await metrics(".review-scope-select button"),
      };
      check(
        "comment input uses card focus border",
        record.metrics.comment,
        record.metrics.comment.input.every(
          (x) =>
            x.resize === "none" &&
            x.outlineStyle === "none" &&
            x.borderWidth === "0px",
        ) && record.metrics.comment.card.every((x) => x.borderWidth === "1px"),
      );
      check(
        "comment identity and line shown",
        record.metrics.comment.heading,
        record.metrics.comment.heading.length === 1,
      );
      check(
        "zero review counts hidden",
        record.metrics.comment.segments,
        record.metrics.comment.segments.every(
          (x) => !/(?:^|\s)0$/u.test(x.text),
        ),
      );
    }
    if (view === "nocturne-update-error") {
      await page.locator(".update-failure").waitFor();
      record.metrics.update = {
        card: await metrics(".update-failure"),
        cardActions: await metrics(".update-failure button"),
        footerActions: await metrics(".sidebar-update > button"),
      };
      check(
        "retry appears only inside failure card",
        record.metrics.update,
        record.metrics.update.cardActions.length === 1 &&
          record.metrics.update.footerActions.length === 0,
      );
    }
    if (view === "environment-open") {
      record.metrics.environment = {
        labels: await metrics(
          ".environment-section > [data-part=section-header] h2",
        ),
        sync: await metrics(".environment-sync-status"),
        syncIcon: await metrics(".environment-sync-status > svg"),
        viewAll: await metrics(".environment-view-all"),
      };
      check(
        "branch sync uses a green 14px check",
        record.metrics.environment.syncIcon,
        record.metrics.environment.syncIcon.length === 1 &&
          record.metrics.environment.syncIcon[0].rect.width === 14 &&
          record.metrics.environment.syncIcon[0].color === readyColor,
      );
      check(
        "context heading has no leading icon",
        record.metrics.environment.labels,
        record.metrics.environment.labels.every((x) => x.svgCount === 0),
      );
      check(
        "environment section labels",
        record.metrics.environment.labels,
        record.metrics.environment.labels.every(
          (x) => x.fontSize === "11.5px" && x.fontWeight === "600",
        ),
      );
      if (await page.locator(".environment-popover:visible").count())
        await page.locator(".workspace-header .environment-trigger").click();
      const shell = await metrics(".workspace-content");
      await page.locator(".workspace-header .right-sidebar-toggle").click();
      await page.locator(".right-sidebar-toggle").last().focus();
      record.metrics.dockOpening = await metrics(".workspace-content");
      check(
        "Dock opening focus keeps scrollLeft zero",
        record.metrics.dockOpening,
        record.metrics.dockOpening.every((x) => x.scrollLeft === 0),
      );
      await page.locator(".right-sidebar-toggle").last().click();
      await page.waitForTimeout(650);
      record.metrics.dockClosed = await metrics(".workspace-content");
      check(
        "Dock closing keeps scrollLeft zero and shell fixed",
        record.metrics.dockClosed,
        record.metrics.dockClosed.every(
          (x, i) => x.scrollLeft === 0 && x.rect.left === shell[i].rect.left,
        ),
      );
    }
    if (view === "environment-pr-checks") {
      const trigger = page.locator(".environment-pr-check-summary");
      if ((await trigger.getAttribute("aria-expanded")) === "true")
        await trigger.click();
      await trigger.hover();
      await trigger.click();
      record.metrics.checks = await metrics(".environment-check-indicator");
      check(
        "PR checks use semantic icons",
        record.metrics.checks,
        record.metrics.checks.length > 0 &&
          record.metrics.checks.every(
            (x) => x.icons.length > 0 || (x.text === "" && x.rect.width === 14),
          ),
      );
    }
    if (view === "icon-sizing-environment-commit") {
      record.metrics.commit = {
        header: await metrics(".environment-panel-header"),
        count: await metrics(".environment-panel-header > small"),
        close: await metrics(".environment-panel-header > button:last-child"),
        destination: await metrics(".environment-commit-destination"),
        form: await metrics(".environment-git-dialog"),
        push: await metrics(".environment-push-info"),
        pushCopy: await metrics(".environment-push-info > span > span"),
      };
      const c = record.metrics.commit;
      check(
        "commit count sits 8px from the close control",
        c,
        Math.abs(
          (locale === "ar"
            ? c.count[0].rect.left - c.close[0].rect.right
            : c.close[0].rect.left - c.count[0].rect.right) - 8,
        ) <= 1,
      );
      check(
        "commit destination fits its content",
        record.metrics.commit,
        record.metrics.commit.destination[0].rect.width <
          record.metrics.commit.form[0].rect.width - 10,
      );
    }
    if (view.startsWith("nocturne-resources-")) {
      record.metrics.resources = {
        headers: await metrics(
          ".resource-management-section > [data-part=header]",
        ),
        lists: await metrics(".resource-management-list"),
        sources: await metrics(".resource-skill-source"),
        switches: await metrics(".resource-skill-row .resource-switch"),
        mcp: await metrics(".resource-mcp-chips"),
        actions: await metrics(".resource-mcp-row .resource-icon-button"),
        tabs: await metrics('[id^="resource-management-tab-"]'),
        footer: await metrics(".resource-installed-overview"),
        footerTitle: await metrics(
          '.resource-installed-overview [data-part="title"]',
        ),
      };
      const r = record.metrics.resources;
      if (r.headers.length && r.lists.length)
        check(
          "resource heading aligns with list edge",
          { header: r.headers[0].rect, list: r.lists[0].rect },
          Math.abs(r.headers[0].rect.right - r.lists[0].rect.right) <= 1,
        );
      for (const [i, source] of r.sources.entries())
        if (r.switches[i])
          check(
            "skill source vertically centered",
            { source: source.rect, switch: r.switches[i].rect },
            Math.abs(
              source.rect.top +
                source.rect.height / 2 -
                r.switches[i].rect.top -
                r.switches[i].rect.height / 2,
            ) <= 1,
          );
      check(
        "MCP row actions hidden",
        r.actions,
        r.actions.every((x) => x.opacity === "0"),
      );
      check(
        "MCP transport not exposed",
        r.mcp,
        r.mcp.every((x) => !x.text.includes("streamable-http")),
      );
    }
    if (view === "secondary-pages-token-usage") {
      await page
        .locator(".token-usage-page.is-loading")
        .waitFor({ state: "hidden" });
      record.metrics.usage = {
        header: await metrics(".token-usage-profile"),
        controls: await metrics(".token-usage-activity-controls"),
        subtitle: await metrics(".token-usage-profile p"),
        tabs: await metrics(".token-usage-tabs"),
        cards: await metrics(
          ".token-usage-summary, .token-usage-activity, .token-usage-models, .token-usage-detail-block",
        ),
        kpis: await metrics(".token-usage-summary [data-part=value]"),
        labels: await metrics(".token-usage-summary [data-part=label]"),
        months: await metrics(".token-usage-chart [data-part=column-labels]"),
        cells: await metrics(".token-usage-chart [data-part=cell]"),
        composition: await metrics(".token-usage-composition-bar > span"),
        compositionHeading: await metrics(".token-composition-heading"),
        compositionTotal: await metrics(".token-composition-heading > bdi"),
        legendRows: await metrics(
          ".token-usage-detail-block .token-usage-detail-row",
        ),
        legendMarkers: await metrics(".token-usage-composition-marker"),
        legendShares: await metrics(".token-usage-composition-share"),
        legendValues: await metrics(".token-usage-detail-block dd > bdi"),
        model: await metrics(".token-usage-model-bar > span"),
        modelGroup: await metrics(".token-usage-model-bars"),
        modelRows: await metrics(".token-usage-model-bars > div"),
        modelNames: await metrics(".token-usage-model-bars button"),
        more: await metrics(".token-usage-observations"),
      };
      const u = record.metrics.usage,
        surface = await reference("--surface");
      check(
        "all usage cards use s1",
        { cards: u.cards.map((x) => x.background), surface },
        u.cards.every((x) => x.background === surface),
      );
      check(
        "usage controls align to subtitle bottom",
        { controls: u.controls[0].rect, subtitle: u.subtitle[0].rect },
        Math.abs(u.controls[0].rect.bottom - u.subtitle[0].rect.bottom) <= 1,
      );
      check(
        "usage segmented control gap is 2px",
        u.tabs[0].gap,
        u.tabs[0].gap === "2px",
      );
      check(
        "cache KPI only when cache data is present",
        u.kpis.map((x) => x.text),
        u.kpis.length === (testCase.cache ? 5 : 4),
      );
      check(
        "token numbers use Latin K/M",
        u.kpis.slice(0, 3).map((x) => x.text),
        u.kpis.slice(0, 3).every((x) => /^[0-9.]+[KM]?$/u.test(x.text)),
      );
      check(
        "KPI labels use tx3",
        u.labels,
        u.labels.every(
          (x) => x.color === u.labels[0].color && x.fontSize === "11.5px",
        ),
      );
      check(
        "activity card matches 205px",
        u.cards[1].rect.height,
        Math.abs(u.cards[1].rect.height - 205) <= 1,
      );
      check(
        "composition and model cards match 220px",
        u.cards.slice(2),
        u.cards.slice(2).every((x) => Math.abs(x.rect.height - 220) <= 1),
      );
      check(
        "months use 13px row and 10.5px type",
        u.months[0],
        u.months[0].rect.height === 13 && u.months[0].fontSize === "10.5px",
      );
      check(
        "extra statistics initially collapsed",
        await page.locator(".token-usage-observations").getAttribute("open"),
        (await page
          .locator(".token-usage-observations")
          .getAttribute("open")) === null,
      );
      const expectedComposition = await Promise.all(
        ["input", "output", "cache", "write"].map((k) =>
          reference(`--nocturne-chart-${k}`),
        ),
      );
      check(
        "composition uses chart palette",
        {
          actual: u.composition.map((x) => x.background),
          expected: expectedComposition,
        },
        u.composition.every((x, i) => x.background === expectedComposition[i]),
      );
      const semanticColors = await Promise.all(
        ["--success", "--artemis-color-status-info"].map(reference),
      );
      check(
        "chart bars avoid semantic status colors",
        semanticColors,
        [...u.composition, ...u.model].every(
          (x) => !semanticColors.includes(x.background),
        ),
      );
      await page.locator(".token-usage-observations > summary").click();
      check(
        "more statistics expands by real click",
        await page.locator(".token-usage-observations").getAttribute("open"),
        (await page
          .locator(".token-usage-observations")
          .getAttribute("open")) !== null,
      );
      await page.locator(".token-usage-observations > summary").click();
    }
    if (view === "secondary-pages-automations")
      record.metrics.automation = {
        note: await metrics(".automation-local-note"),
        dots: await metrics(".automation-unscheduled-dot"),
      };
    if (view === "secondary-pages-archive")
      record.metrics.archive = await metrics(".archive-time-group > span");
    if (view === "nocturne-settings-providers") {
      record.metrics.providers = {
        tiles: await metrics(".provider-navigation-item .provider-icon-tile"),
        keys: await metrics(".provider-api-key input"),
      };
      record.metrics.providers.placeholders = await page
        .locator(".provider-api-key input")
        .evaluateAll((inputs) => inputs.map((x) => x.placeholder));
    }
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
          app.quit = app.__review04Quit;
          app.exit = app.__review04Exit;
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
  "Fourth review rendered regression checks failed",
);
