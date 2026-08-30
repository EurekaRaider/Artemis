import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(appDirectory, "..", "..");
const outputDirectory = resolve(
  process.argv[2] ?? join(repositoryRoot, "artifacts", "queued-steer"),
);
const electronPath = createRequire(import.meta.url)("electron");
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "artemis-queued-steer-"),
);
const windowWidth = 1_440;
const locale = "en";
const originalFirstMessage = "排队消息一：运行格式检查并修复告警";
const originalSecondMessage = "排队消息二：运行类型检查并确认通过";
const editedFirstMessage = "排队消息一（已编辑）：格式检查通过，继续类型检查";
const composingFirstMessage = "排队消息一（输入法组合中）：正在输入中文";
const saveErrorLabel = "Couldn't save the queued message";

// The actions-layout gate compares the production renderer's computed styles
// against the frozen stylesheet, so the smoke proves production equivalence
// instead of hard-coding geometry expectations here.
const stylesPath = join(appDirectory, "src", "renderer", "styles.css");
const stylesCss = await readFile(stylesPath, "utf8");
const actionsStyleBlock =
  stylesCss.match(/\.queued-message-editor-actions\s*\{([^}]*)\}/)?.[1] ?? null;
if (actionsStyleBlock === null) {
  throw new Error(
    "styles.css no longer declares .queued-message-editor-actions.",
  );
}
const readDeclaration = (property) =>
  actionsStyleBlock
    .match(new RegExp(`${property}\\s*:\\s*([^;]+);`))?.[1]
    ?.trim() ?? null;
const actionsStyle = {
  display: readDeclaration("display"),
  flexDirection: readDeclaration("flex-direction") ?? "row",
  justifyContent: readDeclaration("justify-content"),
  gap: readDeclaration("gap"),
};
if (actionsStyle.display !== "flex") {
  throw new Error(
    `.queued-message-editor-actions must keep display: flex in styles.css (found: ${actionsStyle.display}).`,
  );
}
if (actionsStyle.justifyContent === null || actionsStyle.gap === null) {
  throw new Error(
    ".queued-message-editor-actions must keep declaring justify-content and gap in styles.css.",
  );
}

// Each step drives one §8 interaction to its end state, then the harness
// captures one screenshot and one accessibility audit for that state.
const steps = [
  {
    id: "a-edit",
    view: "queued-steer-edit",
    scenario: "Click Edit to open the inline queued message editor.",
  },
  {
    id: "b-esc-cancel",
    view: "queued-steer-cancel",
    scenario: "Press Escape to cancel editing and restore the original text.",
  },
  {
    id: "c-save-shortcut",
    view: "queued-steer-save",
    scenario:
      "Edit the text and submit with Meta/Ctrl+Enter; focus returns to the row steer button.",
  },
  {
    id: "d-save-error",
    view: "queued-steer-save-error",
    scenario:
      "Inject a replaceTurnQueue rejection; the alert region, retained text, and Retry affordance appear.",
  },
  {
    id: "e-ime-composing",
    view: "queued-steer-ime",
    scenario:
      "During IME composition (compositionstart + isComposing Enter), Meta+Enter must not submit.",
  },
];
const themes = ["light", "dark"];
const cases = steps.flatMap((step) =>
  themes.map((theme) => ({ ...step, theme, caseId: `${step.id}-${theme}` })),
);
const results = [];

// Geometry gates for the Save/Cancel actions row: the container must exist,
// sit directly under the editor root, compute the stylesheet's row layout,
// and lay the two buttons out inline rather than full-width stacked.
const assertActionsGeometry = (assert, geometry, label) => {
  if (!geometry) {
    return [assert(`${label}-present`, false, null, "geometry snapshot")];
  }
  const sameRow =
    Array.isArray(geometry.buttonTops) &&
    geometry.buttonTops.length === 2 &&
    Math.abs(geometry.buttonTops[0] - geometry.buttonTops[1]) < 1;
  const notFullWidth =
    Array.isArray(geometry.buttonWidths) &&
    geometry.buttonWidths.length === 2 &&
    typeof geometry.containerWidth === "number" &&
    geometry.buttonWidths.every((width) => width < geometry.containerWidth);
  return [
    assert(
      `${label}-present`,
      geometry.present === true,
      geometry.present,
      true,
    ),
    assert(
      `${label}-direct-child-of-editor-root`,
      geometry.directChildOfEditorRoot === true,
      geometry.directChildOfEditorRoot,
      true,
    ),
    assert(
      `${label}-row-layout`,
      geometry.display === actionsStyle.display &&
        geometry.flexDirection === actionsStyle.flexDirection,
      { display: geometry.display, flexDirection: geometry.flexDirection },
      {
        display: actionsStyle.display,
        flexDirection: actionsStyle.flexDirection,
      },
    ),
    assert(
      `${label}-justify-content`,
      geometry.justifyContent === actionsStyle.justifyContent,
      geometry.justifyContent,
      actionsStyle.justifyContent,
    ),
    assert(
      `${label}-gap`,
      geometry.gap === actionsStyle.gap,
      geometry.gap,
      actionsStyle.gap,
    ),
    assert(
      `${label}-save-cancel-pair`,
      geometry.buttonCount === 2,
      geometry.buttonCount,
      2,
    ),
    assert(
      `${label}-buttons-not-stacked`,
      sameRow === true && notFullWidth === true,
      { sameRow, notFullWidth },
      { sameRow: true, notFullWidth: true },
    ),
  ];
};

const assertLiveActionsPresent = (assert, actions) =>
  assert(
    "actions-live-present",
    actions?.present === true,
    actions?.present ?? null,
    true,
  );

await mkdir(outputDirectory, { recursive: true });
try {
  for (const testCase of cases) {
    const { id, view, theme, caseId, scenario } = testCase;
    const screenshotPath = join(outputDirectory, `${id}-${theme}.png`);
    const accessibilityPath = join(outputDirectory, `${id}-${theme}.a11y.json`);
    await rm(screenshotPath, { force: true });
    await rm(accessibilityPath, { force: true });
    const environment = {
      ...process.env,
      ARTEMIS_SMOKE_SCREENSHOT: screenshotPath,
      ARTEMIS_SMOKE_ACCESSIBILITY: accessibilityPath,
      ARTEMIS_SMOKE_LOCALE: locale,
      ARTEMIS_SMOKE_SETTLE_DELAY: "250",
      ARTEMIS_SMOKE_THEME: theme,
      ARTEMIS_SMOKE_VIEW: view,
      ARTEMIS_SMOKE_WINDOW_WIDTH: String(windowWidth),
    };
    // Never inherit a live dev server: the smoke must exercise the built
    // production renderer from this checkout, not whatever serves 127.0.0.1.
    delete environment.ELECTRON_RUN_AS_NODE;
    delete environment.ARTEMIS_DEV_SERVER_URL;
    const launch = (disableRendererSandbox, attempt) =>
      spawnSync(
        electronPath,
        [
          appDirectory,
          `--user-data-dir=${join(temporaryDirectory, `${caseId}${attempt ? `-retry${attempt}` : ""}`)}`,
          "--disable-gpu",
          "--disable-gpu-compositing",
          "--disable-gpu-sandbox",
          "--use-angle=swiftshader",
          ...(disableRendererSandbox ? ["--no-sandbox"] : []),
        ],
        {
          cwd: appDirectory,
          encoding: "utf8",
          env: environment,
          maxBuffer: 2 * 1024 * 1024,
          timeout: 45_000,
        },
      );
    let launchResult = launch(false, 0);
    if ((launchResult.error || launchResult.status !== 0) && !process.env.CI) {
      launchResult = launch(true, 1);
    }
    if ((launchResult.error || launchResult.status !== 0) && !process.env.CI) {
      launchResult = launch(false, 2);
    }
    if (launchResult.error || launchResult.status !== 0) {
      throw new Error(
        [
          `Queued steer smoke case ${caseId} failed.`,
          launchResult.error?.message,
          launchResult.stdout,
          launchResult.stderr,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }

    const screenshotBytes = (await stat(screenshotPath)).size;
    const audit = JSON.parse(await readFile(accessibilityPath, "utf8"));
    const queued = audit.queuedSteer ?? {};
    if (screenshotBytes < 10_000) {
      throw new Error(`${caseId} screenshot is unexpectedly small.`);
    }
    if (audit.issues?.length) {
      throw new Error(
        `${caseId} accessibility audit failed: ${JSON.stringify(audit.issues)}`,
      );
    }
    const assertions = [];
    const assert = (name, pass, actual, expected) => {
      const record = { name, pass, actual, expected };
      assertions.push(record);
      return record;
    };
    const commonPass =
      assert(
        "queued-bar-visible",
        queued.barVisible === true,
        queued.barVisible,
        true,
      ).pass &&
      assert("queued-item-count", queued.itemCount === 2, queued.itemCount, 2)
        .pass;
    if (!commonPass) {
      throw new Error(
        `${caseId} did not render the queued message bar: ${JSON.stringify(queued)}`,
      );
    }
    const expectations = {
      "a-edit": () => [
        assert(
          "editor-open",
          queued.editorVisible === true,
          queued.editorVisible,
          true,
        ),
        assert(
          "editor-seeded-original",
          queued.editorValue === originalFirstMessage,
          queued.editorValue,
          originalFirstMessage,
        ),
        ...assertActionsGeometry(
          assert,
          queued.editTimeActions,
          "actions-edit-time",
        ),
        assertLiveActionsPresent(assert, queued.actions),
      ],
      "b-esc-cancel": () => [
        assert(
          "editor-closed",
          queued.editorVisible === false,
          queued.editorVisible,
          false,
        ),
        assert(
          "original-text-restored",
          queued.firstItemText === originalFirstMessage,
          queued.firstItemText,
          originalFirstMessage,
        ),
        assert(
          "focus-tag-button",
          queued.focusTag === "BUTTON",
          queued.focusTag,
          "BUTTON",
        ),
        assert(
          "focus-queued-index",
          queued.focusQueuedIndex === "0",
          queued.focusQueuedIndex,
          "0",
        ),
        assert(
          "focus-on-first-steer",
          queued.focusOnFirstSteer === true,
          queued.focusOnFirstSteer,
          true,
        ),
      ],
      "c-save-shortcut": () => [
        assert(
          "editor-closed",
          queued.editorVisible === false,
          queued.editorVisible,
          false,
        ),
        assert(
          "saved-text-shown",
          queued.firstItemText === editedFirstMessage,
          queued.firstItemText,
          editedFirstMessage,
        ),
        assert(
          "focus-on-steer-button",
          queued.focusOnFirstSteer === true,
          queued.focusOnFirstSteer,
          true,
        ),
        assert(
          "focus-tag-button",
          queued.focusTag === "BUTTON",
          queued.focusTag,
          "BUTTON",
        ),
        assert(
          "no-error",
          queued.errorVisible === false,
          queued.errorVisible,
          false,
        ),
        ...assertActionsGeometry(
          assert,
          queued.editTimeActions,
          "actions-edit-time",
        ),
      ],
      "d-save-error": () => [
        assert(
          "editor-retained",
          queued.editorVisible === true,
          queued.editorVisible,
          true,
        ),
        assert(
          "edited-text-preserved",
          queued.editorValue === editedFirstMessage,
          queued.editorValue,
          editedFirstMessage,
        ),
        assert(
          "alert-visible",
          queued.errorVisible === true,
          queued.errorVisible,
          true,
        ),
        assert(
          "alert-text",
          typeof queued.errorText === "string" &&
            queued.errorText.includes(saveErrorLabel),
          queued.errorText,
          `contains "${saveErrorLabel}"`,
        ),
        assert(
          "retry-enabled",
          queued.retryDisabled === false,
          queued.retryDisabled,
          false,
        ),
        assert(
          "generic-notice-hidden",
          queued.genericNoticeVisible === false,
          queued.genericNoticeVisible,
          false,
        ),
        assert(
          "generic-notice-no-save-error",
          queued.genericNoticeText === null ||
            !queued.genericNoticeText.includes(saveErrorLabel),
          queued.genericNoticeText,
          `absent or without "${saveErrorLabel}"`,
        ),
        ...assertActionsGeometry(
          assert,
          queued.editTimeActions,
          "actions-edit-time",
        ),
        assertLiveActionsPresent(assert, queued.actions),
      ],
      "e-ime-composing": () => [
        assert(
          "editor-retained",
          queued.editorVisible === true,
          queued.editorVisible,
          true,
        ),
        assert(
          "composing-text-preserved",
          queued.editorValue === composingFirstMessage,
          queued.editorValue,
          composingFirstMessage,
        ),
        assert(
          "is-composing-dispatched",
          queued.probe?.dispatchedIsComposing === true,
          queued.probe?.dispatchedIsComposing,
          true,
        ),
        assert(
          "submit-blocked-during-composition",
          queued.probe?.submitBlocked === true,
          queued.probe?.submitBlocked,
          true,
        ),
        assert(
          "no-error",
          queued.errorVisible === false,
          queued.errorVisible,
          false,
        ),
        ...assertActionsGeometry(
          assert,
          queued.editTimeActions,
          "actions-edit-time",
        ),
        assertLiveActionsPresent(assert, queued.actions),
      ],
    };
    const stepAssertions = expectations[id]();
    const failed = stepAssertions.filter((assertion) => !assertion.pass);
    if (failed.length) {
      throw new Error(`${caseId} assertions failed: ${JSON.stringify(failed)}`);
    }
    results.push({
      id,
      view,
      theme,
      scenario,
      screenshot: `${id}-${theme}.png`,
      screenshotBytes,
      assertions: stepAssertions,
      focus: {
        tag: queued.focusTag,
        queuedIndex: queued.focusQueuedIndex,
        onFirstSteer: queued.focusOnFirstSteer,
      },
      aria: {
        barRole: "status",
        alertRole: queued.errorVisible ? "alert" : null,
        errorText: queued.errorText,
        retryDisabled: queued.retryDisabled,
      },
      genericNotice: {
        visible: queued.genericNoticeVisible ?? null,
        count: queued.genericNoticeCount ?? null,
        text: queued.genericNoticeText ?? null,
      },
      actions: {
        editTime: queued.editTimeActions ?? null,
        live: queued.actions ?? null,
      },
      imeProbe: queued.probe ?? null,
      viewport: {
        requestedWidth: windowWidth,
        windowInnerWidth: audit.windowInnerWidth,
        windowOuterHeight: 920,
      },
    });
    console.log(
      `PASS ${caseId} (${stepAssertions.length} assertions, screenshot ${screenshotBytes} bytes)`,
    );
  }
  const totalAssertions = results.reduce(
    (sum, result) => sum + result.assertions.length + 2,
    0,
  );
  const auditReport = {
    format: "artemis-queued-steer-smoke",
    version: 1,
    generatedAt: new Date().toISOString(),
    locale,
    windowWidth,
    actionsStyleSource: {
      file: "apps/desktop/src/renderer/styles.css",
      selector: ".queued-message-editor-actions",
      ...actionsStyle,
    },
    note: "Window height is fixed at 920 by the shared smoke harness; screenshots capture the resulting viewport.",
    summary: {
      cases: results.length,
      passed: results.length,
      failed: 0,
      assertions: totalAssertions,
    },
    steps: results.map((result) => ({
      id: result.id,
      view: result.view,
      scenario: result.scenario,
      themes: [result.theme],
    })),
    results,
  };
  const auditPath = join(outputDirectory, "audit.json");
  await writeFile(
    auditPath,
    `${JSON.stringify(auditReport, null, 2)}\n`,
    "utf8",
  );
  console.log(
    `Queued steer smoke passed: ${results.length} cases, ${totalAssertions} assertions.`,
  );
  console.log(auditPath);
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true });
}
