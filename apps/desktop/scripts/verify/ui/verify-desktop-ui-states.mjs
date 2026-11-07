import { createServer } from "node:http";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { scan } from "./scan-rendered-ui.mjs";
import { probeControlStates } from "./probe-control-states.mjs";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  desktopUiScenarios,
  desktopUiVariants,
} from "../../../test/fixtures/desktop-ui-scenarios.mjs";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const root = resolve(desktop, "../..");
const sourceIdentity = async () => {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8" },
  )
    .split("\0")
    .filter(
      (file) =>
        /\.(tsx?|css|json|mjs|svg|png|ico|icns|woff2?)$/.test(file) &&
        existsSync(join(root, file)),
    )
    .sort();
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file);
    hash.update(await readFile(join(root, file)));
  }
  return {
    head: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
    fingerprint: hash.digest("hex"),
  };
};
const started = {
  at: new Date().toISOString(),
  source: await sourceIdentity(),
};
const require = createRequire(import.meta.url);
const { _electron } = require("playwright-core");
const output = resolve(
  process.argv[2] ?? "artifacts/verification/ui-redesign/review-06/local",
);
await mkdir(output, { recursive: true });
const filter = process.env.ARTEMIS_REVIEW_FILTER;
const records = filter
  ? await readFile(join(output, "report.json"), "utf8")
      .then(JSON.parse)
      .catch(() => [])
  : [];
const controlFamilies = new Set();

// This runs after every fixture and every interaction screenshot, including
// surfaces unrelated to the numbered fixes. Unmapped design comparisons remain
// visible in the board ledger; absence of a failed assertion is not visual signoff.

for (const variant of desktopUiVariants)
  for (const fixture of desktopUiScenarios) {
    const id = `${fixture.state}-${variant.theme}-${variant.locale}`;
    if (filter && !new RegExp(filter).test(id)) continue;
    const record = {
      ...fixture,
      ...variant,
      id,
      source: started.source,
      verifiedAt: started.at,
      browser:
        "Browser plugin not available; authorized repository Playwright Electron workflow",
      checks: [],
      scans: [],
      screenshots: [],
      errors: [],
    };
    const check = (name, actual, expected, pass) =>
      record.checks.push({ name, actual, expected, pass: Boolean(pass) });
    const userData = await mkdtemp(join(tmpdir(), "artemis-review06-"));
    let app;
    let server;
    try {
      console.log(`START ${id}`);
      const env = {
        ...process.env,
        ARTEMIS_SMOKE_VIEW: fixture.view,
        ARTEMIS_SMOKE_REVIEW06: "1",
        ARTEMIS_SMOKE_REVIEW06_STATE: fixture.state,
        ARTEMIS_SMOKE_REVIEW06_PR: fixture.pr ?? "open",
        ARTEMIS_SMOKE_REVIEW06_USAGE: fixture.usage ?? "unreported",
        ARTEMIS_SMOKE_THEME: variant.theme,
        ARTEMIS_SMOKE_MATERIAL: "solid",
        ARTEMIS_SMOKE_LOCALE: variant.locale,
        ARTEMIS_SMOKE_DIRECTION: variant.locale === "ar" ? "rtl" : "ltr",
        ARTEMIS_SMOKE_MULTI_UI: "1",
        ARTEMIS_SMOKE_WINDOW_WIDTH: "1440",
        ARTEMIS_SMOKE_WINDOW_HEIGHT: "900",
        ARTEMIS_SMOKE_SCREENSHOT: join(userData, "seed.png"),
        ARTEMIS_SMOKE_ACCESSIBILITY: join(userData, "seed.json"),
      };
      delete env.ELECTRON_RUN_AS_NODE;
      delete env.ARTEMIS_DEV_SERVER_URL;
      app = await _electron.launch({
        executablePath: require("electron"),
        args: [desktop, `--user-data-dir=${userData}`],
        cwd: desktop,
        env,
        timeout: 60000,
      });
      await app.evaluate(({ app }) => {
        app.__review06Quit = app.quit;
        app.__review06Exit = app.exit;
        app.quit = () => {};
        app.exit = () => {};
      });
      const page = await app.firstWindow();
      page.setDefaultTimeout(10000);
      page.on("pageerror", (error) => record.errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") record.errors.push(message.text());
      });
      await page.waitForSelector('[data-renderer-ready="true"]', {
        timeout: 60000,
      });
      const deadline = Date.now() + 45000;
      while (
        Date.now() < deadline &&
        !(await readFile(join(userData, "seed.json")).then(
          () => true,
          () => false,
        ))
      )
        await page.waitForTimeout(100);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(180);
      record.surface = await page
        .locator(".conversation")
        .evaluateAll((elements) =>
          elements.map((el) => ({
            class: el.className,
            state: el.dataset.state,
            rect: el.getBoundingClientRect().toJSON(),
          })),
        );
      check(
        "identity",
        { url: page.url(), title: await page.title() },
        "Artemis renderer",
        page.url().includes("dist-renderer") &&
          /Artemis/.test(await page.title()),
      );
      check(
        "meaningful content",
        (await page.locator("body").innerText()).length,
        ">20",
        (await page.locator("body").innerText()).length > 20,
      );
      check(
        "framework overlays",
        await page.locator("vite-error-overlay, nextjs-portal").count(),
        0,
        !(await page.locator("vite-error-overlay, nextjs-portal").count()),
      );
      const capture = async (suffix = "") => {
        await page.evaluate(async () => {
          // Finite transitions must finish before measuring the painted control.
          // Running spinners remain live; this does not disable animations.
          const transitions = document
            .getAnimations()
            .filter(
              (animation) =>
                animation.playState === "running" &&
                Number.isFinite(
                  animation.effect?.getComputedTiming().iterations,
                ),
            );
          if (transitions.length)
            await Promise.race([
              Promise.allSettled(
                transitions.map((animation) => animation.finished),
              ),
              new Promise((_, reject) =>
                setTimeout(
                  () => reject(new Error("Layout transitions did not settle")),
                  2500,
                ),
              ),
            ]);
        });
        const filename = `${id}${suffix}.png`;
        await page.screenshot({ path: join(output, filename), scale: "css" });
        record.screenshots.push(filename);
        record.scans.push({ screenshot: filename, ...(await scan(page)) });
        record.controlStates ??= [];
        record.controlStates.push(
          ...(await probeControlStates(
            page,
            output,
            { ...record, id: `${id}${suffix}` },
            controlFamilies,
          )),
        );
        await writeFile(
          join(output, `${id}.metrics.json`),
          JSON.stringify(record, null, 2),
        );
      };
      const click = async (selector) => {
        const button = page.locator(selector).filter({ visible: true }).first();
        if (
          selector.includes(".project-action") ||
          selector.includes(".thread-action")
        )
          await button.locator("..").locator("..").hover();
        await button.click();
        await page.waitForTimeout(180);
      };
      const missingTaskNotice = async (suffix) => {
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].webContents.send(
            "artemis:thread-link-open",
            null,
          ),
        );
        await page.locator(".transient-notice.error").waitFor();
        await capture(suffix);
      };
      if (fixture.context) {
        const events = await page.evaluate(() =>
          window.artemis.getThreadEvents("artemis-smoke-conversation-thread"),
        );
        await app.evaluate(
          ({ BrowserWindow }, event) =>
            BrowserWindow.getAllWindows()[0].webContents.send(
              "artemis:agent-event",
              event,
            ),
          {
            protocolVersion: 4,
            eventId: `${id}-context`,
            threadId: "artemis-smoke-conversation-thread",
            turnId: "artemis-smoke-conversation-active-turn",
            seq: (events.at(-1)?.seq ?? 0) + 100,
            timestamp: new Date().toISOString(),
            payload: {
              type: "context.usage",
              tokens: fixture.context * 2000,
              contextWindow: 200000,
              compacting: false,
              estimated: true,
              source: "local-estimate",
            },
          },
        );
        await page.locator(".composer-queue > summary").click();
        await page.waitForTimeout(120);
        check(
          "running capsule",
          await page.locator(".composer-running-status").count(),
          1,
          (await page.locator(".composer-running-status").count()) === 1,
        );
        check(
          "queued message cards",
          await page
            .locator('[data-artemis-component="queued-message-item"]')
            .count(),
          ">0",
          (await page
            .locator('[data-artemis-component="queued-message-item"]')
            .count()) > 0,
        );
        const usage = await page
          .locator(".context-usage-indicator")
          .evaluate((element) => ({
            text: element.textContent,
            level: element.dataset.usageLevel,
          }));
        check(
          "context ring state",
          usage,
          fixture.context,
          usage.text.includes(String(fixture.context)) &&
            usage.level === (fixture.context > 80 ? "high" : "normal"),
        );
        const input = page.locator(".composer textarea");
        const originalDraft = await input.inputValue();
        for (const draft of ["", "Follow-up"]) {
          await input.fill(draft);
          const failures = await page
            .locator(".composer-toolbar")
            .evaluate((toolbar) => {
              const wrap = toolbar.closest(".composer-wrap");
              const previous = wrap.style.cssText;
              const failures = [];
              try {
                wrap.style.boxSizing = "content-box";
                for (const width of [736, 681, 550, 431, 321, 240]) {
                  wrap.style.inlineSize = `${width}px`;
                  const row = toolbar.getBoundingClientRect();
                  const boxes = [
                    ...toolbar.querySelectorAll(
                      "button, .composer-running-status, .context-usage-indicator",
                    ),
                  ]
                    .map((el) => el.getBoundingClientRect())
                    .filter((box) => box.width > 1)
                    .sort((a, b) => a.left - b.left);
                  const center = row.top + row.height / 2;
                  const chevron = toolbar
                    .querySelector(".model-button > svg")
                    .getBoundingClientRect();
                  const model = toolbar
                    .querySelector(".model-button")
                    .getBoundingClientRect();
                  if (
                    chevron.left < model.left ||
                    chevron.right > model.right ||
                    Math.abs(chevron.top + chevron.height / 2 - center) > 1 ||
                    boxes.some(
                      (box, i) =>
                        Math.abs(box.top + box.height / 2 - center) > 1 ||
                        box.left < row.left ||
                        box.right > row.right ||
                        (i > 0 && box.left < boxes[i - 1].right - 1),
                    )
                  )
                    failures.push(width);
                }
              } finally {
                wrap.style.cssText = previous;
              }
              return failures;
            });
          check(
            `single-row composer with ${draft ? "follow-up and stop" : "stop"}`,
            failures,
            [],
            failures.length === 0,
          );
        }
        await input.fill(originalDraft);
      }
      if (fixture.state === "multiple-questions") {
        await click(
          '[data-tree-row-id="thread:artemis-smoke-multi-ui-thread"] .thread-select',
        );
        await page.locator(".multi-question").waitFor();
        await page.locator(".user-question-dot").nth(1).click();
      }
      if (fixture.state === "slash" || fixture.state === "agents") {
        const input = page.locator(".composer textarea");
        await input.fill(fixture.state === "slash" ? "/" : "@");
        await page
          .locator(
            fixture.state === "slash"
              ? "#skill-command-menu"
              : "#custom-agent-mention-menu",
          )
          .waitFor();
        await capture();
        const rows = await page
          .locator(".slash-command-suggestion:visible")
          .evaluateAll((rows) =>
            rows.map((row) => ({
              title: row
                .querySelector("strong")
                ?.getBoundingClientRect()
                .toJSON(),
              detail: row
                .querySelector("small")
                ?.getBoundingClientRect()
                .toJSON(),
              gradient: !!row.querySelector("linearGradient"),
            })),
          );
        check(
          "two-line menu rows",
          rows,
          "description below title; no gradients",
          rows.every(
            (row) =>
              !row.gradient &&
              (!row.detail || row.detail.top >= row.title.bottom),
          ),
        );
        check(
          "keyboard hint",
          await page.locator(".composer-suggestion-hint").count(),
          1,
          (await page.locator(".composer-suggestion-hint").count()) === 1,
        );
        if (fixture.state === "slash") {
          const order = await page
            .locator("#skill-command-menu .slash-command-heading")
            .allTextContents();
          check(
            "skills precede commands",
            order,
            "skills then commands",
            order.length >= 2,
          );
          await page
            .locator("#skill-command-menu .slash-command-suggestion")
            .last()
            .scrollIntoViewIfNeeded();
          await capture("-commands");
        }
        if (fixture.state === "agents") {
          check(
            "two agent definitions and team entry",
            await page
              .locator("#custom-agent-mention-menu [role=option]")
              .count(),
            ">=3",
            (await page
              .locator("#custom-agent-mention-menu [role=option]")
              .count()) >= 3,
          );
          await page
            .locator("#custom-agent-mention-menu button")
            .filter({ has: page.locator('[data-artemis-icon="agents"]') })
            .click();
          await page.locator(".custom-agent-team-dialog").waitFor();
          await page
            .locator('.custom-agent-team-dialog input[type="checkbox"]')
            .nth(0)
            .check();
          await page
            .locator('.custom-agent-team-dialog input[type="checkbox"]')
            .nth(1)
            .check();
          await capture("-team");
          await page
            .locator(".custom-agent-team-dialog footer button")
            .first()
            .click();
          check(
            "cancelled team leaves no task draft blocks",
            await page.locator(".custom-agent-task-block").count(),
            0,
            !(await page.locator(".custom-agent-task-block").count()),
          );
        }
      } else if (fixture.state === "policy" || fixture.state === "model") {
        if (fixture.state === "model") {
          const previous = await page.evaluate(() =>
            window.artemis.getThreadEvents("artemis-smoke-conversation-thread"),
          );
          await app.evaluate(
            ({ BrowserWindow }, sequence) => {
              const target = BrowserWindow.getAllWindows()[0].webContents;
              for (const [index, payload] of [
                {
                  type: "assistant.usage",
                  providerId: "fixture",
                  modelId: "fixture",
                  inputTokens: 5300,
                  outputTokens: 0,
                  cacheReadTokens: 12900,
                  cacheWriteTokens: 0,
                  cacheReadReported: true,
                  totalTokens: 18200,
                },
                {
                  type: "context.usage",
                  tokens: 76000,
                  contextWindow: 200000,
                  compacting: false,
                },
              ].entries())
                target.send("artemis:agent-event", {
                  protocolVersion: 4,
                  eventId: `model-details-${index}`,
                  threadId: "artemis-smoke-conversation-thread",
                  turnId: "artemis-smoke-conversation-active-turn",
                  seq: sequence + index,
                  timestamp: new Date().toISOString(),
                  payload,
                });
            },
            (previous.at(-1)?.seq ?? 0) + 100,
          );
          await page.locator(".model-button").hover();
          await page.locator(".model-hover").waitFor();
          const details = await page
            .locator(".model-hover")
            .evaluate((element) => {
              const style = getComputedStyle(element);
              const heading = getComputedStyle(element.querySelector("strong"));
              return {
                width: element.getBoundingClientRect().width,
                padding: style.padding,
                size: heading.fontSize,
                weight: heading.fontWeight,
                lineHeight: heading.lineHeight,
                fields: element.querySelectorAll(".model-hover-grid > span")
                  .length,
              };
            });
          check(
            "model details use real data and exact design typography",
            details,
            "280px; 14px 16px; 14/600/20; three fields",
            details.width === 280 &&
              details.padding === "14px 16px" &&
              details.size === "14px" &&
              details.weight === "600" &&
              details.lineHeight === "20px" &&
              details.fields === 6,
          );
          const detailsAnchor = await page
            .locator(".model-hover")
            .evaluate((element) => {
              const tip = element.getBoundingClientRect(),
                trigger = document
                  .querySelector(".model-button")
                  .getBoundingClientRect(),
                container = document
                  .querySelector(".model-button")
                  .closest(".composer-wrap")
                  .getBoundingClientRect();
              return {
                clearance: container.top - tip.bottom,
                edgeDelta:
                  document.documentElement.dir === "rtl"
                    ? tip.left - trigger.left
                    : tip.right - trigger.right,
              };
            });
          check(
            "model details clear the whole Composer container",
            detailsAnchor,
            "8px clearance; trigger edge within 1px",
            Math.abs(detailsAnchor.clearance - 8) <= 1 &&
              Math.abs(detailsAnchor.edgeDelta) <= 1,
          );
          await capture("-details");
        }
        await click(
          fixture.state === "policy"
            ? ".approval-policy-trigger"
            : ".model-button",
        );
        await capture();
        if (fixture.state === "policy") {
          check(
            "no visible menu heading",
            await page.locator(".approval-policy-heading").count(),
            0,
            !(await page.locator(".approval-policy-heading").count()),
          );
          const clearance = await page.evaluate(
            () =>
              document.querySelector(".composer").getBoundingClientRect().top -
              document
                .querySelector(".approval-policy-menu")
                .getBoundingClientRect().bottom,
          );
          check(
            "approval menu clears composer",
            clearance,
            "8–12px",
            clearance >= 8 && clearance <= 12,
          );
          await page.keyboard.press("Escape");
          await click(".project-context-trigger");
          await page.locator(".project-context-menu").waitFor();
          const projectMenu = await page.evaluate(() => {
            const popup = document
              .querySelector(".project-context-menu")
              .getBoundingClientRect();
            const trigger = document
              .querySelector(".project-context-trigger")
              .getBoundingClientRect();
            return {
              clearance: popup.top - trigger.bottom,
              paths: document.querySelectorAll(".composer-project-path").length,
            };
          });
          check(
            "project picker opens below its trigger",
            projectMenu,
            "8px and visible project paths",
            Math.abs(projectMenu.clearance - 8) <= 1 && projectMenu.paths > 0,
          );
          await capture("-projects");
        } else {
          check(
            "single model popup",
            await page.locator(".model-picker-menu").count(),
            1,
            (await page.locator(".model-picker-menu").count()) === 1,
          );
          check(
            "thinking segmented control",
            await page
              .locator(".model-picker-menu .thinking-level-control")
              .count(),
            1,
            (await page
              .locator(".model-picker-menu .thinking-level-control")
              .count()) === 1,
          );
          await page
            .locator(".model-picker-options > button")
            .filter({ hasText: "Text fixture" })
            .click();
          await page.waitForFunction(
            () => !document.querySelector(".model-picker-menu"),
          );
          await click(".model-button");
          check(
            "non-reasoning model has no fabricated thinking levels",
            await page.locator(".model-picker-thinking").count(),
            0,
            !(await page.locator(".model-picker-thinking").count()),
          );
          await capture("-no-reasoning");
          await page.keyboard.press("Escape");
          await page.locator(".model-button").hover();
          await page.locator(".model-hover").waitFor();
          check(
            "non-reasoning details omit the thinking field",
            await page.locator(".model-hover-grid > span").count(),
            4,
            (await page.locator(".model-hover-grid > span").count()) === 4,
          );
          await capture("-no-reasoning-details");
        }
      } else if (["project", "thread"].includes(fixture.state)) {
        await page.keyboard.press("Escape");
        await click(
          fixture.state === "project"
            ? ".project-action"
            : '[data-tree-row-id="thread:e59ea82c-775a-4a3f-87ab-62c11ac31f3b"] .thread-action',
        );
        await capture();
        check(
          "menu populated",
          await page.locator(`.${fixture.state}-menu [role=menuitem]`).count(),
          fixture.state === "project" ? 7 : 6,
          (await page
            .locator(`.${fixture.state}-menu [role=menuitem]`)
            .count()) === (fixture.state === "project" ? 7 : 6),
        );
        if (fixture.state === "project") {
          for (const projectId of [
            "artemis-smoke-environment-project",
            "artemis-smoke-review06-empty-project",
          ]) {
            if (!(await page.locator(".project-menu").count()))
              await click(
                `[data-tree-row-id="project:${projectId}"] .project-action`,
              );
            else {
              await page.keyboard.press("Escape");
              await click(
                `[data-tree-row-id="project:${projectId}"] .project-action`,
              );
            }
            await page.locator(".project-menu [role=menuitem]").nth(1).click();
            await page.locator(".automation-dialog-actions").waitFor();
            const expected = await page.evaluate(
              async (projectId) =>
                (await window.artemis.getSnapshot()).projects.find(
                  (project) => project.id === projectId,
                )?.name,
              projectId,
            );
            const selected = await page
              .locator(
                ".automation-editor-body [data-artemis-component=select] button",
              )
              .first()
              .innerText();
            check(
              `automation preselect ${projectId}`,
              selected,
              expected,
              selected.includes(expected),
            );
            await capture(
              `-automation-${projectId.endsWith("empty-project") ? "empty" : "existing"}`,
            );
            await page
              .locator(".automation-dialog-actions button")
              .first()
              .click();
            await page.waitForFunction(
              () => !document.querySelector(".automation-dialog-actions"),
            );
            await click(
              `[data-tree-row-id="project:${projectId}"] .project-action`,
            );
            await page.locator(".project-menu [role=menuitem]").nth(2).click();
            await page
              .locator(".project-instructions-dialog textarea")
              .waitFor();
            const content = `# Local ${projectId} instructions\nSynthetic manual edit.\n`;
            await page
              .locator(".project-instructions-dialog textarea")
              .fill(content);
            await page
              .locator(
                ".project-instructions-dialog [data-part=save], .project-instructions-dialog button[type=submit]",
              )
              .count()
              .then(async (count) => {
                if (count)
                  await page
                    .locator(
                      ".project-instructions-dialog [data-part=save], .project-instructions-dialog button[type=submit]",
                    )
                    .first()
                    .click();
                else
                  await page
                    .locator(".project-instructions-dialog textarea")
                    .press(
                      process.platform === "darwin" ? "Meta+s" : "Control+s",
                    );
              });
            await page.waitForTimeout(150);
            const saved = await page.evaluate(
              (id) => window.artemis.readProjectInstructions(id),
              projectId,
            );
            check(
              `manual AGENTS save ${projectId}`,
              saved,
              content,
              saved === content,
            );
            await capture(
              `-instructions-${projectId.endsWith("empty-project") ? "empty" : "existing"}`,
            );
            await page
              .locator(".project-instructions-dialog footer button")
              .click();
          }
          check(
            "cancelled drafts not persisted",
            await page.evaluate(() => window.artemis.listAutomations()),
            [],
            !(await page.evaluate(() => window.artemis.listAutomations()))
              .length,
          );
        } else {
          const previousClipboard = await app.evaluate(({ clipboard }) =>
            clipboard.readText(),
          );
          await page.locator(".thread-menu [role=menuitem]").nth(3).click();
          const expected =
            "artemis://thread/e59ea82c-775a-4a3f-87ab-62c11ac31f3b";
          let copied = "";
          for (let attempt = 0; attempt < 50; attempt++) {
            copied = await app.evaluate(({ clipboard }) =>
              clipboard.readText(),
            );
            if (copied === expected) break;
            await page.waitForTimeout(50);
          }
          check(
            "local task link copied without publishing",
            copied,
            expected,
            copied === expected,
          );
          await app.evaluate(
            ({ clipboard }, text) => clipboard.writeText(text),
            previousClipboard,
          );
          await capture("-copied");
          await missingTaskNotice("-error");
        }
      } else if (fixture.state === "workspace") {
        await capture("-panel");
        await click(".environment-workspace-trigger");
        await capture();
      } else if (fixture.state === "goal-editor") {
        await page
          .locator('.goal-editor-panel[data-state="ready"]')
          .waitFor({ timeout: 15000 });
        const value = await page.locator(".goal-editor-input").inputValue();
        check(
          "real goal objective loaded",
          value,
          "nonempty",
          value.trim().length > 0,
        );
        await capture();
      } else if (fixture.state === "sources") {
        await page.locator(".sources-panel").waitFor({ timeout: 15000 });
        const count = await page.locator(".sources-panel-entry").count();
        check("real source entries", count, ">0", count > 0);
        await capture();
      } else if (fixture.state === "team") {
        await click(
          ".environment-section:has(.environment-agent-team-children) .environment-text-action",
        );
        await page
          .locator(".agent-team-panel:not(.unavailable)")
          .waitFor({ timeout: 15000 });
        const count = await page.locator(".agent-team-member").count();
        check("team members shown", count, ">=2", count >= 2);
        await capture();
      } else if (fixture.state === "search") {
        await page.keyboard.press("Meta+k");
        const search = page.locator(".sidebar-search input");
        await search.waitFor();
        await page.waitForFunction(
          () =>
            document.querySelector(".sidebar-search input") ===
            document.activeElement,
          null,
          { timeout: 1000 },
        );
        check(
          "task search focus",
          await search.evaluate(
            (element) => element === document.activeElement,
          ),
          true,
          await search.evaluate(
            (element) => element === document.activeElement,
          ),
        );
        await search.fill("synthetic");
        await capture();
      } else if (fixture.state === "terminal") {
        await click(".workspace-header .right-sidebar-toggle");
        await page
          .locator('[data-artemis-component="workspace-launcher"] button')
          .filter({
            has: page.locator('.workspace-launcher-icon[data-kind="terminal"]'),
          })
          .click();
        await page
          .locator('.terminal-panel[data-state="ready"] .xterm-screen')
          .waitFor({ timeout: 30000 });
        check(
          "production terminal mounted",
          await page.locator('.terminal-panel[data-state="ready"]').count(),
          1,
          (await page
            .locator('.terminal-panel[data-state="ready"]')
            .count()) === 1,
        );
        await capture();
      } else if (fixture.state === "automations") {
        const rows = page.locator(".automation-master-row");
        await rows
          .filter({ hasText: "每周研究简报" })
          .locator('button[data-artemis-component="button"]')
          .first()
          .click();
        check(
          "three local automation states",
          await rows.count(),
          3,
          (await rows.count()) === 3,
        );
        const enabled = await rows
          .locator('[data-artemis-component="switch"][data-state="checked"]')
          .count();
        check("enabled and paused schedules", enabled, 2, enabled === 2);
        const history = await page.locator(".automation-history-row").count();
        check("local automation history", history, 3, history === 3);
        const completed = await page
          .locator(".automation-history-row .automation-run-dot.completed")
          .count();
        const failed = await page
          .locator(".automation-history-row .automation-run-dot.failed")
          .count();
        check(
          "completed and failed history states",
          { completed, failed },
          { completed: 2, failed: 1 },
          completed === 2 && failed === 1,
        );
        await capture();
        await rows
          .filter({ hasText: "评审项目变更" })
          .locator('button[data-artemis-component="button"]')
          .first()
          .click();
        await capture("-paused");
      } else if (fixture.state === "archive") {
        check(
          "archive fixture",
          await page.locator(".archive-card").count(),
          ">=6",
          (await page.locator(".archive-card").count()) >= 6,
        );
        await page.locator(".archive-select input").nth(0).check();
        await page.locator(".archive-select input").nth(1).check();
        await capture();
        const selected = await page.locator(".archive-batch-bar").innerText();
        check(
          "two selected",
          selected,
          "2",
          selected.includes("2") && !selected.includes("{count}"),
        );
        await page.locator(".archive-batch-bar button").first().click();
        await page.waitForFunction(
          () => !document.querySelector(".archive-batch-bar"),
        );
        check(
          "batch restore",
          await page.locator(".archive-card").count(),
          5,
          (await page.locator(".archive-card").count()) === 5,
        );
        await page.locator(".archive-select input").nth(0).check();
        await page.locator(".archive-select input").nth(1).check();
        await page.locator(".archive-batch-bar button").nth(1).click();
        check(
          "one confirmation",
          await page.locator(".confirmation-dialog").count(),
          1,
          (await page.locator(".confirmation-dialog").count()) === 1,
        );
        await capture("-confirm");
        await page
          .locator(
            ".confirmation-dialog .danger, .confirmation-dialog [data-variant=danger]",
          )
          .last()
          .click();
        await page.waitForFunction(
          () => document.querySelectorAll(".archive-card").length === 3,
        );
        check(
          "batch delete",
          await page.locator(".archive-card").count(),
          3,
          (await page.locator(".archive-card").count()) === 3,
        );
        check(
          "no repeated confirmation",
          await page.locator(".confirmation-dialog").count(),
          0,
          !(await page.locator(".confirmation-dialog").count()),
        );
        await capture("-after");
        await page
          .locator(".archive-card-actions")
          .first()
          .locator("button")
          .nth(1)
          .click();
        await page.locator(".archived-readonly").waitFor();
        await missingTaskNotice("-readonly-error");
      } else if (fixture.state === "notice-retired") {
        await page.locator(".im-retired-notice").waitFor();
        check(
          "retired group has no editable Composer",
          await page.locator(".composer textarea").count(),
          0,
          !(await page.locator(".composer textarea").count()),
        );
        await missingTaskNotice("");
      } else if (fixture.state === "dock") {
        await writeFile(
          join(userData, "fixtures/environment-repository/review.csv"),
          "Name,Status,Count\nalpha,Reviewed,3\nbeta,Updated,42\n",
        );
        await click(".workspace-header .right-sidebar-toggle");
        const launch = async (kind) => {
          await page
            .locator('[data-artemis-component="workspace-launcher"] button')
            .filter({
              has: page.locator(
                `.workspace-launcher-icon[data-kind="${kind}"]`,
              ),
            })
            .click();
        };
        await launch("files");
        await page
          .locator('[data-artemis-component="workspace-file-tree-row"]')
          .filter({ hasText: "README.md" })
          .click();
        await page
          .locator('[data-artemis-component="workspace-preview"]')
          .waitFor();
        check(
          "actual file preview",
          await page
            .locator('[data-artemis-component="workspace-preview"]')
            .count(),
          1,
          (await page
            .locator('[data-artemis-component="workspace-preview"]')
            .count()) === 1,
        );
        await capture("-files");
        await page
          .locator('[data-artemis-component="workspace-file-tree-row"]')
          .filter({ hasText: "review.csv" })
          .click();
        await page.waitForTimeout(200);
        await capture("-csv-route");
        record.csvRoute = (await page.locator(".workspace-csv-preview").count())
          ? "native CSV view"
          : "Office capability gate; CSV UI also exercised with isolated production component";
        await page
          .locator(
            '[data-artemis-component="workspace-tab"] > [data-part="close"]',
          )
          .last()
          .click();
        await click(".workspace-header .right-sidebar-toggle");
        await launch("browser");
        await page.locator(".browser-preview-tools").waitFor();
        server = createServer((_request, response) => {
          response.writeHead(200, {
            "Content-Type": "text/html;charset=utf-8",
          });
          response.end(
            '<!doctype html><title>Artemis local browser fixture</title><body style="font:16px system-ui;padding:24px"><h1>Local preview</h1><p>No external website or model request.</p></body>',
          );
        });
        await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
        const url = `http://127.0.0.1:${server.address().port}`;
        const address = page.locator(
          ".browser-address-input input, input.browser-address-input",
        );
        await address.fill(url);
        await address.press("Enter");
        await page.waitForFunction(
          () => !document.querySelector(".browser-preview-error"),
          undefined,
          { timeout: 7000 },
        );
        check(
          "browser preview UI recovered",
          await page.locator(".browser-preview-error:visible").count(),
          0,
          !(await page.locator(".browser-preview-error:visible").count()),
        );
        await capture("-browser");
        const browser = await app.evaluate(async ({ webContents }, url) => {
          const target = webContents
            .getAllWebContents()
            .find((contents) => contents.getURL().startsWith(url));
          return target
            ? {
                url: target.getURL(),
                title: target.getTitle(),
                screenshot: (await target.capturePage())
                  .toPNG()
                  .toString("base64"),
              }
            : null;
        }, url);
        check(
          "real local browser content",
          browser && { url: browser.url, title: browser.title },
          url,
          browser?.url.startsWith(url),
        );
        if (browser)
          await writeFile(
            join(output, `${id}-browser-content.png`),
            Buffer.from(browser.screenshot, "base64"),
          );
      } else if (fixture.state === "settings-general") {
        await capture();
        const trigger = page
          .locator(
            '.settings-panel [data-artemis-component="select"] [data-part="trigger"]',
          )
          .first();
        await trigger.click();
        await capture("-language");
        const options = await page
          .locator('[role="listbox"] [role="option"]')
          .evaluateAll((rows) =>
            rows.map((row) => {
              const s = getComputedStyle(row);
              return {
                height: row.getBoundingClientRect().height,
                size: s.fontSize,
                weight: s.fontWeight,
                line: s.lineHeight,
              };
            }),
          );
        check(
          "language menu option recipe",
          options,
          "32px / 13px / 400 / 19.5px",
          options.length >= 14 &&
            options.every(
              (row) =>
                row.height === 32 &&
                row.size === "13px" &&
                row.weight === "400" &&
                row.line === "19.5px",
            ),
        );
        await page.keyboard.press("Escape");
      } else if (fixture.state.startsWith("usage-")) {
        await capture();
        const cards = await page
          .locator(".token-usage-summary > *")
          .evaluateAll((cards) =>
            cards.map((card) => ({
              text: card.textContent,
              rect: card.getBoundingClientRect().toJSON(),
            })),
          );
        check(
          "five KPI cards on one row",
          cards,
          "5, same top",
          cards.length === 5 &&
            cards.every(
              (card) => Math.abs(card.rect.top - cards[0].rect.top) <= 1,
            ),
        );
        check(
          "honest cache reporting",
          cards.at(-1)?.text,
          fixture.usage === "reported" ? "%" : "—",
          fixture.usage === "reported"
            ? cards.at(-1)?.text.includes("%")
            : cards.at(-1)?.text.includes("—") &&
                !cards.at(-1)?.text.includes("0%"),
        );
        if (fixture.usage === "empty") await missingTaskNotice("-notice");
      } else {
        await capture();
        if (["question-queue-running", "failed"].includes(fixture.state)) {
          const message = page
            .locator(".assistant-message")
            .filter({ has: page.locator(".message-action") })
            .first();
          await message.locator("p").first().hover();
          await capture("-message-actions");
          if (fixture.state === "question-queue-running") {
            const gaps = record.scans.at(-1).messageActionGaps;
            check(
              "message actions have their own space",
              gaps,
              ">=4px before following activity",
              gaps.length > 0 && gaps.every((entry) => entry.gap >= 4),
            );
          }
        }
        if (
          [
            "plan",
            "approval",
            "question-queue-running",
            "multiple-questions",
          ].includes(fixture.state)
        ) {
          const geometry = await page
            .locator(".decision-card:visible")
            .evaluateAll((cards) =>
              cards.map((card) => {
                const area = card.querySelector(".decision-option-area"),
                  title = card.querySelector(".decision-title"),
                  body = card.querySelector(".decision-body");
                return {
                  question: card.matches(".question-decision, .multi-question"),
                  border: area && getComputedStyle(area).borderTopWidth,
                  gap:
                    area && title
                      ? area.getBoundingClientRect().top -
                        title.getBoundingClientRect().bottom
                      : null,
                  bodyPadding: body && getComputedStyle(body).paddingBottom,
                  radios: card.querySelectorAll(".decision-option-indicator")
                    .length,
                };
              }),
            );
          check(
            "decision body and question structure",
            geometry,
            "14px body padding / question border0 gap<=10 radio",
            geometry.length > 0 &&
              geometry.every((card) =>
                card.question
                  ? card.border === "0px" && card.gap <= 10 && card.radios > 0
                  : card.bodyPadding === "14px",
              ),
          );
        }
        if (fixture.state.startsWith("pr-")) {
          const pr = await page
            .locator(".environment-pr-icon")
            .evaluate((element) => ({
              state: element.dataset.prState,
              color: getComputedStyle(element).color,
              icon: getComputedStyle(element.querySelector("svg")).color,
              expected: (() => {
                const probe = document.createElement("span");
                probe.style.color = `var(${element.dataset.prState === "open" ? "--success" : element.dataset.prState === "merged" ? "--artemis-color-status-info" : "--muted-2"})`;
                element.append(probe);
                const color = getComputedStyle(probe).color;
                probe.remove();
                return color;
              })(),
            }));
          check(
            "PR state color inherited by glyph",
            pr,
            fixture.pr,
            pr.state === fixture.pr &&
              pr.color === pr.icon &&
              pr.color === pr.expected,
          );
        }
      }
      if (fixture.state === "welcome-resume") {
        check(
          "visible welcome heading",
          await page.locator(".conversation-empty-state h1:visible").count(),
          1,
          (await page
            .locator(".conversation-empty-state h1:visible")
            .count()) === 1,
        );
        check(
          "three resume cards",
          await page.locator(".welcome-resume-card").count(),
          3,
          (await page.locator(".welcome-resume-card").count()) === 3,
        );
      }
      if (fixture.state === "failed") {
        const action = await page
          .locator(".turn-error-actions button")
          .first()
          .evaluate((element) => ({
            icon: element.querySelector("svg")?.dataset.artemisIcon,
            width: element.querySelector("svg")?.getBoundingClientRect().width,
            gap: getComputedStyle(element).columnGap,
          }));
        check(
          "edit retry icon",
          action,
          "edit / 14px / 6px",
          action.icon === "edit" && action.width === 14 && action.gap === "6px",
        );
      }
      if (fixture.state === "goal")
        check(
          "goal objective font",
          await page
            .locator(".goal-bar-objective")
            .evaluate((element) => getComputedStyle(element).fontSize),
          "13px",
          (await page
            .locator(".goal-bar-objective")
            .evaluate((element) => getComputedStyle(element).fontSize)) ===
            "13px",
        );
      if (fixture.state === "commit") {
        const commit = await page
          .locator(".environment-git-dialog")
          .evaluate((element) => {
            const textarea = element.querySelector("textarea");
            const probe = document.createElement("span");
            probe.style.color = "var(--muted-2)";
            element.append(probe);
            const expectedPlaceholder = getComputedStyle(probe).color;
            probe.remove();
            return {
              textarea: textarea.getBoundingClientRect().height,
              lineHeight: getComputedStyle(textarea).lineHeight,
              placeholder: getComputedStyle(textarea, "::placeholder").color,
              expectedPlaceholder,
              branchFont: getComputedStyle(
                element.querySelector(".environment-commit-destination button"),
              ).fontFamily,
              submitIcons: element
                .querySelector("button[type=submit]")
                .querySelectorAll("svg").length,
              headerClose: document.querySelectorAll(
                ".environment-panel-header button[title]",
              ).length,
              push: getComputedStyle(
                element.querySelector(".environment-push-only"),
              ).borderTopWidth,
            };
          });
        check(
          "commit subview geometry",
          commit,
          "design height 82.445px (minimum 80px), line-height 20.15px, tertiary placeholder / mono / no commit icon or close / ghost push",
          Math.abs(commit.textarea - 82.4453125) <= 1 &&
            commit.lineHeight === "20.15px" &&
            commit.placeholder === commit.expectedPlaceholder &&
            commit.branchFont.includes("Geist Mono") &&
            commit.submitIcons === 0 &&
            commit.headerClose === 0 &&
            commit.push === "0px",
        );
      }
      if (fixture.state === "review") {
        const diff = await page.locator(".review-line").evaluateAll((lines) =>
          lines.map((line) => ({
            state: line.dataset.state,
            body: getComputedStyle(line.querySelector("code")).color,
            token: getComputedStyle(
              line.querySelector(".syntax-token") ?? line.querySelector("code"),
            ).color,
            marker: getComputedStyle(line.querySelector("[data-part=marker]"))
              .color,
            numbers: [...line.querySelectorAll(".review-line-number")].map(
              (number) => getComputedStyle(number).color,
            ),
          })),
        );
        check(
          "plain diff preserves body color",
          diff,
          "all body and token colors equal",
          new Set(diff.flatMap((line) => [line.body, line.token])).size === 1,
        );
        check(
          "diff marker status colors",
          diff,
          "add green / delete red / neutral line numbers",
          new Set(
            diff
              .filter((line) => line.state !== "context")
              .map((line) => line.marker),
          ).size >= 2 &&
            new Set(diff.flatMap((line) => line.numbers)).size === 1,
        );
        await page.locator(".review-footer").scrollIntoViewIfNeeded();
        await capture("-footer");
        await page.locator(".review-hunk .review-action").first().click();
        let stagedPaths = "";
        for (let attempt = 0; attempt < 50; attempt++) {
          stagedPaths = execFileSync(
            "git",
            ["diff", "--cached", "--name-only"],
            {
              cwd: join(userData, "fixtures/environment-repository"),
              encoding: "utf8",
            },
          ).trim();
          if (stagedPaths.split("\n").includes("README.md")) break;
          await page.waitForTimeout(100);
        }
        check(
          "real isolated hunk stage",
          stagedPaths,
          "README.md",
          stagedPaths.split("\n").includes("README.md"),
        );
        await page
          .locator('.review-scope-select [data-part="segment"]')
          .nth(2)
          .click();
        await page.locator(".review-line").first().waitFor();
        await capture("-staged");
      }
      if (["plan", "approval"].includes(fixture.state)) {
        const gaps = await page
          .locator(".decision-body")
          .evaluateAll((bodies) =>
            bodies.map((body) => {
              const last = body.lastElementChild,
                area = body.nextElementSibling;
              return (
                area.getBoundingClientRect().top -
                last.getBoundingClientRect().bottom
              );
            }),
          );
        if (fixture.state === "plan") {
          const ordinal = await page
            .locator(".plan-decision-content li")
            .first()
            .evaluate((element) => {
              const style = getComputedStyle(element, "::before");
              return {
                size: style.fontSize,
                lineHeight: style.lineHeight,
                font: style.fontFamily,
              };
            });
          check(
            "plan ordinal typography",
            ordinal,
            "Geist Mono 12px / 18px",
            ordinal.size === "12px" &&
              ordinal.lineHeight === "18px" &&
              ordinal.font.includes("Geist Mono"),
          );
        }
        check(
          "last body element to separator",
          gaps,
          "14 ±1px",
          gaps.length > 0 && gaps.every((gap) => Math.abs(gap - 14) <= 1),
        );
      }
      if (
        [
          "plan",
          "approval",
          "question-queue-running",
          "failed",
          "review",
        ].includes(fixture.state)
      ) {
        check(
          "no context bar after messages",
          await page.locator(".composer-context-row:visible").count(),
          0,
          !(await page.locator(".composer-context-row:visible").count()),
        );
        const composer = await page.locator(".composer").boundingBox();
        check(
          "composer bottom margin",
          900 - composer.y - composer.height,
          "16 ±1px",
          Math.abs(900 - composer.y - composer.height - 16) <= 1,
        );
      }
      const probe = page
        .locator(
          ".model-picker-options > button, .approval-policy-menu button, .slash-command-suggestion, .decision-option, .archive-card button, .welcome-resume-card, .environment-workspace-menu button, .project-menu button, .thread-menu button, [data-artemis-component=button]",
        )
        .filter({ visible: true })
        .first();
      if (await probe.count()) {
        const readState = () =>
          probe.evaluate((element) => ({
            text: element.textContent,
            color: getComputedStyle(element).color,
            background: getComputedStyle(element).backgroundColor,
            disabled: element.matches(":disabled"),
            selected:
              element.getAttribute("aria-selected") ??
              element.getAttribute("aria-pressed"),
            rect: element.getBoundingClientRect().toJSON(),
          }));
        const before = await readState();
        await probe.hover();
        await page.waitForTimeout(120);
        record.hoverProbe = { before, hover: await readState() };
        await capture("-hover");
      }
      const allViolations = record.scans.flatMap((scan) => scan.violations);
      check("generic scan", allViolations, [], allViolations.length === 0);
      const stateErrors = (record.controlStates ?? []).filter(
        (entry) => entry.error,
      );
      check(
        "control state captures",
        stateErrors,
        [],
        stateErrors.length === 0,
      );
      check("console health", record.errors, [], record.errors.length === 0);
      await writeFile(
        join(output, `${id}.metrics.json`),
        JSON.stringify(record, null, 2),
      );
    } catch (error) {
      record.error = error.stack ?? String(error);
      record.checks.push({
        name: "fixture completed",
        pass: false,
        actual: String(error),
      });
      if (app)
        try {
          const page = await app.firstWindow();
          await page.screenshot({ path: join(output, `${id}-failure.png`) });
        } catch {}
    } finally {
      server?.closeAllConnections();
      if (server) await new Promise((done) => server.close(done));
      if (app) {
        await app
          .evaluate(({ app }) => {
            app.quit = app.__review06Quit;
            app.exit = app.__review06Exit;
          })
          .catch(() => {});
        await app.close().catch(() => {});
      }
      await rm(userData, { recursive: true, force: true });
    }
    const index = records.findIndex((item) => item.id === id);
    if (index >= 0) records[index] = record;
    else records.push(record);
    await writeFile(
      join(output, "report.json"),
      JSON.stringify(records, null, 2),
    );
    console.log(
      `${record.checks.every((check) => check.pass) ? "PASS" : "FAIL"} ${id} ${record.checks.filter((check) => check.pass).length}/${record.checks.length}`,
    );
  }
if (!filter) {
  await new Promise((resolveRun, reject) => {
    const child = spawn(
      process.execPath,
      [
        join(desktop, "scripts/verify/ui/verify-desktop-component-states.mjs"),
        output,
      ],
      { cwd: root, stdio: "inherit", env: process.env },
    );
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolveRun()
        : reject(new Error(`Supplemental fixtures exited ${code}`)),
    );
  });
}
const supplemental = !filter
  ? JSON.parse(await readFile(join(output, "supplemental-report.json"), "utf8"))
  : [];
const completed = {
  at: new Date().toISOString(),
  source: await sourceIdentity(),
};
const executedRecords = records.filter(
  (record) => record.verifiedAt === started.at,
);
const currentRecords = records.filter(
  (record) => record.source?.fingerprint === started.source.fingerprint,
);
const summary = {
  started,
  completed,
  stableSource: started.source.fingerprint === completed.source.fingerprint,
  expectedMainFixtures: desktopUiScenarios.length * desktopUiVariants.length,
  filter: filter ?? null,
  cachedFixtures: records.length,
  currentMatrixFixtures: currentRecords.length,
  staleFixtures: records.length - currentRecords.length,
  fixtures: executedRecords.length,
  passed: executedRecords.filter((record) =>
    record.checks.every((check) => check.pass),
  ).length,
  assertions: executedRecords.reduce(
    (sum, record) => sum + record.checks.length,
    0,
  ),
  failed: executedRecords.flatMap((record) =>
    record.checks
      .filter((check) => !check.pass)
      .map((check) => ({ id: record.id, ...check })),
  ),
};
summary.supplemental = {
  fixtures: supplemental.length,
  passed: supplemental.filter((record) =>
    record.checks.every((check) => check.pass),
  ).length,
  assertions: supplemental.reduce(
    (sum, record) => sum + record.checks.length,
    0,
  ),
};
summary.failed.push(
  ...supplemental.flatMap((record) =>
    record.checks
      .filter((check) => !check.pass)
      .map((check) => ({ id: record.id, ...check })),
  ),
);
summary.prColors = desktopUiVariants.map((variant) => ({
  ...variant,
  colors: currentRecords
    .filter(
      (record) =>
        record.theme === variant.theme &&
        record.locale === variant.locale &&
        record.pr,
    )
    .map((record) => ({
      state: record.pr,
      color: record.checks.find(
        (check) => check.name === "PR state color inherited by glyph",
      )?.actual.color,
    })),
}));
if (
  !summary.stableSource ||
  (!filter && currentRecords.length !== summary.expectedMainFixtures)
)
  summary.failed.push({
    name: "complete fixture matrix bound to stable source",
    actual: {
      fixtures: records.length,
      expected: summary.expectedMainFixtures,
      stableSource: summary.stableSource,
    },
    pass: false,
  });
await writeFile(join(output, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
if (summary.failed.length) process.exitCode = 1;
