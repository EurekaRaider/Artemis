import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(scriptDirectory, "../../..");
const require = createRequire(import.meta.url);
const electronPath = require("electron");
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "artemis-environment-panel-"),
);
// Retain case evidence in the CI artifact directory, including on failure.
const outputDirectory = process.argv[2]
  ? resolve(process.argv[2])
  : temporaryDirectory;
await mkdir(outputDirectory, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertOpaqueMenu(menu, name) {
  const colors = [menu?.backgroundColor, menu?.color].map((color) =>
    /^rgb\((\d+), (\d+), (\d+)\)$/u
      .exec(color ?? "")
      ?.slice(1)
      .map(Number),
  );
  assert(
    colors.every(Boolean),
    `${name}: menu must have opaque surface and text colors: ${JSON.stringify(menu)}`,
  );
  const luminance = (rgb) =>
    rgb
      .map((value) => {
        const channel = value / 255;
        return channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4;
      })
      .reduce(
        (sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index],
        0,
      );
  const values = colors.map(luminance).sort((left, right) => left - right);
  assert(
    (values[1] + 0.05) / (values[0] + 0.05) >= 4.5,
    `${name}: menu text contrast is below 4.5:1.`,
  );
  assert(
    menu.boxShadow !== "none",
    `${name}: menu surface has no separation from the page.`,
  );
}

async function runCase(
  name,
  width,
  view = "environment",
  {
    direction = "ltr",
    scale = 1,
    theme = "light",
    locale = "zh-CN",
    material,
  } = {},
) {
  const screenshotPath = join(outputDirectory, `${name}.png`);
  const accessibilityPath = join(outputDirectory, `${name}.a11y.json`);
  const environment = {
    ...process.env,
    ARTEMIS_SMOKE_SCREENSHOT: screenshotPath,
    ARTEMIS_SMOKE_ACCESSIBILITY: accessibilityPath,
    ARTEMIS_SMOKE_LOCALE: locale,
    ARTEMIS_SMOKE_DIRECTION: direction,
    ARTEMIS_SMOKE_SCALE: String(scale),
    ARTEMIS_SMOKE_THEME: theme,
    ARTEMIS_SMOKE_VIEW: view,
    ARTEMIS_SMOKE_WINDOW_WIDTH: String(width),
    ...(material ? { ARTEMIS_SMOKE_MATERIAL: material } : {}),
  };
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.ARTEMIS_DEV_SERVER_URL;
  const result = spawnSync(
    electronPath,
    [
      appDirectory,
      `--user-data-dir=${join(temporaryDirectory, `${name}-user-data`)}`,
      "--disable-gpu",
      "--disable-gpu-compositing",
      "--disable-gpu-sandbox",
      "--force-prefers-no-reduced-motion",
      "--use-angle=swiftshader",
    ],
    {
      cwd: appDirectory,
      env: environment,
      encoding: "utf8",
      timeout: 45_000,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  await writeFile(
    join(outputDirectory, `${name}.log`),
    `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      [
        `Electron environment-panel case ${name} failed.`,
        `status=${result.status ?? "null"} signal=${result.signal ?? "none"}`,
        result.error?.message,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  const snapshot = JSON.parse(await readFile(accessibilityPath, "utf8"));
  assert(
    Array.isArray(snapshot.issues) && snapshot.issues.length === 0,
    `Electron environment-panel case ${name} has accessibility issues: ${JSON.stringify(snapshot.issues)}`,
  );
  return snapshot;
}

try {
  for (const [name, width, options] of [
    ["shell-branch-light", 1420, { theme: "light", material: "glass" }],
    ["shell-branch-dark-narrow", 980, { theme: "dark", material: "glass" }],
    [
      "shell-branch-rtl-solid",
      980,
      { theme: "dark", direction: "rtl", locale: "ar", material: "solid" },
    ],
  ]) {
    const snapshot = await runCase(
      name,
      width,
      "nocturne-branch-menu",
      options,
    );
    const menu = snapshot.composerBranchMenu;
    assertOpaqueMenu(menu, name);
    assert(
      menu?.expanded && menu.visible && menu.outsideComposer,
      `${name}: the external Composer branch trigger did not open its menu.`,
    );
    assert(
      menu.withinViewport && menu.firstItemUnobscured,
      `${name}: the branch menu is clipped or its first row is covered.`,
    );
    assert(
      menu.menu.bottom <= menu.trigger.top &&
        menu.menu.left <= menu.trigger.left &&
        menu.menu.right >= menu.trigger.right,
      `${name}: the menu is not anchored above the Composer branch trigger: ${JSON.stringify(menu)}`,
    );
    assert(
      menu.borderRadius === "11px" &&
        menu.items.every((item) => item.height >= 32),
      `${name}: branch menu radius or row density differs from the menu contract.`,
    );
    const selected = menu.items.filter((item) => item.checked);
    assert(
      menu.searchPresent &&
        menu.items.length >= 6 &&
        selected.length === 1 &&
        selected[0].label === "main" &&
        selected[0].checkVisible,
      `${name}: search, real fixture branches or the current-branch check is missing.`,
    );
  }
  for (const theme of ["light", "dark"]) {
    const name = `environment-branch-${theme}`;
    const snapshot = await runCase(name, 1420, "environment-branch-menu", {
      theme,
      material: "glass",
    });
    const menu = snapshot.environmentBranchMenu;
    assertOpaqueMenu(menu, name);
    assert(
      menu.visible &&
        menu.portalInBody &&
        menu.withinViewport &&
        menu.firstItemUnobscured &&
        menu.borderRadius === "11px",
      `${name}: portaled branch menu is clipped, obscured or missing its surface.`,
    );
  }
  for (const view of [
    "environment-new-conversation",
    "environment-unstarted",
    "environment-non-git-empty",
  ]) {
    const snapshot = await runCase(view, 1420, view);
    assert(
      !snapshot.environmentPanelOpen,
      `${view} unexpectedly opened the environment panel.`,
    );
  }
  const nonGit = await runCase("non-git-content", 1420, "environment-non-git");
  assert(
    nonGit.environmentPanelOpen,
    "Non-Git task content did not open the panel.",
  );
  assert(
    !nonGit.environmentSectionHeadings.includes("Git"),
    "Non-Git task still displays the Git section.",
  );
  assert(
    nonGit.environmentSectionHeadings.length >= 2,
    "Non-Git task lost its agent activity or sources section.",
  );
  const started = await runCase("started-git", 1420, "environment");
  assert(
    started.environmentPanelOpen,
    "Started Git conversation did not automatically open the environment panel.",
  );
  for (const theme of ["light", "dark"]) {
    const snapshot = await runCase(
      `context-usage-${theme}`,
      1420,
      "environment-context-usage",
      { theme },
    );
    const palette = snapshot.contextUsagePalette;
    assert(palette.length === 8, "Context usage categories are missing.");
    assert(
      new Set(palette.map((item) => item.color)).size === 8,
      "Context categories must have distinct colors.",
    );
    assert(
      palette.every((item) => item.color === item.segmentColor),
      "Context legend and bar colors differ.",
    );
  }
  const wide = await runCase("wide", 1_420, "environment-open");
  assert(wide.windowInnerWidth >= 1_400, "Wide window width was not applied.");
  assert(
    wide.environmentPanelOpen,
    "Wide window did not open the environment panel.",
  );
  assert(
    wide.environmentPanel?.visible,
    "Wide window environment panel is not visible.",
  );
  assert(
    Math.abs(wide.environmentPanel.width - 304) <= 1,
    "Environment panel must keep its docked 304px width.",
  );
  assert(
    wide.workflowComponents.includes("environment-control") &&
      wide.workflowComponents.includes("environment-panel"),
    "Wide window is not using the public Environment surfaces.",
  );
  assert(
    wide.environmentControl?.controls === wide.environmentControl?.panelId &&
      wide.environmentControl?.panelRole === "dialog" &&
      wide.environmentControl?.panelName,
    "Environment trigger does not control its named dialog.",
  );
  assert(
    wide.timelineScroll,
    "Wide window timeline scroll bounds are missing.",
  );
  assert(
    wide.timelineContent,
    "Wide window timeline content bounds are missing.",
  );
  assert(
    !wide.turnStatus &&
      wide.headerStatus?.state?.includes("completed") &&
      !wide.headerStatus.hasTimer,
    "Completed state must appear once in the header, without a live timer.",
  );
  assert(wide.workspaceContent, "Wide window workspace bounds are missing.");
  assert(
    Math.abs(wide.timelineScroll.right - wide.workspaceContent.right) <= 1,
    "Environment popover moved the timeline scrollbar away from the workspace edge.",
  );
  function assertContentSpace(snapshot, direction = "ltr") {
    const panel = snapshot.environmentPanel;
    assert(
      panel?.visible,
      "Environment panel did not remain visible in the usable workspace.",
    );
    for (const [name, content] of Object.entries({
      timeline: snapshot.timelineContent,
      composer: snapshot.goalComposer,
    })) {
      assert(content, `${name} bounds are missing.`);
      assert(
        direction === "rtl"
          ? content.left >= panel.right + 23
          : content.right <= panel.left - 23,
        `${name} does not leave a 24px gap beside the environment panel: ${JSON.stringify({ content, panel })}`,
      );
    }
    assert(
      snapshot.timelineContent.width >= 480 &&
        snapshot.goalComposer.width >= 440,
      "Environment panel leaves too little usable conversation width.",
    );
  }
  assertContentSpace(wide);

  for (const [name, width, view, options] of [
    ["notice-open", 1420, "environment-notice", { theme: "dark" }],
    ["notice-closed", 1420, "environment-notice-closed", {}],
    ["notice-narrow", 980, "environment-notice", {}],
    ["notice-rtl", 1420, "environment-notice", { direction: "rtl" }],
    ["notice-zoomed", 1420, "environment-notice", { scale: 2 }],
  ]) {
    const snapshot = await runCase(name, width, view, options);
    const notice = snapshot.feedbackLayout?.components.find(
      (component) =>
        component.component === "toast" && component.context === "app-notice",
    );
    const composer = snapshot.goalComposer;
    assert(
      notice?.role === "alert" && notice.tone === "danger",
      `${name}: error notice missing`,
    );
    assert(
      composer &&
        Math.abs(notice.geometry.left - composer.left) <= 1 &&
        Math.abs(notice.geometry.right - composer.right) <= 1,
      `${name}: error notice is not aligned with the composer: ${JSON.stringify({ notice: notice.geometry, composer })}`,
    );
    assert(
      notice.geometry.bottom <= composer.top,
      `${name}: error notice overlaps the composer`,
    );
    assert(
      notice.withinViewport && notice.contentFitsInline,
      `${name}: error notice is clipped`,
    );
  }

  const closed = await runCase("closed", 1_420, "environment-closed");
  assert(
    !closed.environmentPanelOpen,
    "Closed fixture unexpectedly opened the panel.",
  );
  assert(
    Math.abs(
      closed.timelineContent.width -
        Math.min(736, closed.timelineScroll.width - 28),
    ) <= 1,
    "Closing the panel did not restore the original reading width.",
  );
  assert(
    Math.abs(closed.goalComposer.width - (closed.timelineContent.width - 36)) <=
      1,
    "Closed composer does not retain its 18px reading-column insets.",
  );
  assert(
    wide.timelineContent.left < closed.timelineContent.left &&
      wide.goalComposer.left < closed.goalComposer.left,
    "Opening the panel did not move both timeline and composer left.",
  );
  const medium = await runCase("medium", 1_200, "environment-open");
  assertContentSpace(medium);
  const rtl = await runCase("rtl-open", 1_420, "environment-open", {
    direction: "rtl",
    theme: "dark",
    scale: 1,
  });
  assertContentSpace(rtl, "rtl");
  assert(
    !rtl.turnStatus &&
      rtl.headerStatus?.state?.includes("completed") &&
      !rtl.headerStatus.hasTimer,
    "RTL completed state must appear once in the header without a live timer.",
  );

  const dock = await runCase("dock", 1_420, "environment-dock");
  assert(dock.workspaceDockVisible, "Workspace Tab Dock did not open.");
  assert(dock.timelineScroll, "Dock case timeline scroll bounds are missing.");
  assert(
    dock.workspaceDockResizer,
    "Dock case workspace resizer bounds are missing.",
  );
  assert(
    Math.abs(dock.timelineScroll.right - dock.workspaceDock.left) <= 1 &&
      Math.abs(
        (dock.workspaceDockResizer.left + dock.workspaceDockResizer.right) / 2 -
          dock.workspaceDock.left,
      ) <= 1,
    "Timeline scrollbar is not on the timeline/Tab Dock boundary.",
  );
  assert(
    dock.dockTransition,
    "Workspace Tab Dock transition evidence is missing.",
  );
  assert(
    dock.feedbackLayout?.reducedMotion === false,
    "Workspace Tab Dock animation case did not force no-preference motion.",
  );
  assert(
    dock.dockTransition.animations?.some((animation) => animation.duration > 0),
    `Workspace Tab Dock did not expose an active runtime transition: ${JSON.stringify(dock.dockTransition)}.`,
  );
  assert(
    dock.dockTransition.middle.dock.width >
      dock.dockTransition.before.dock.width &&
      dock.dockTransition.middle.dock.width <
        dock.dockTransition.after.dock.width,
    `Workspace Tab Dock did not pass through an animated intermediate width: ${JSON.stringify(dock.dockTransition)}.`,
  );
  assert(
    dock.dockTransition.after.status.width ===
      dock.dockTransition.before.status.width &&
      dock.dockTransition.after.environment.width ===
        dock.dockTransition.before.environment.width &&
      Math.abs(
        dock.dockTransition.after.environment.left -
          dock.dockTransition.after.status.right -
          (dock.dockTransition.before.environment.left -
            dock.dockTransition.before.status.right),
      ) <= 1 &&
      dock.dockTransition.after.environment.right <=
        dock.conversation.right + 1 &&
      dock.dockTransition.after.status.left >= dock.conversation.left,
    "Dock opening must keep the status and environment controls aligned within the conversation header.",
  );

  const messageActions = await runCase(
    "message-actions",
    1_420,
    "message-actions-edit",
  );
  assert(
    JSON.stringify(messageActions.messageActionLabels) ===
      JSON.stringify([
        "复制消息",
        "编辑后重新发送",
        "复制消息",
        "分叉",
        "分享任务",
      ]),
    "Completed message actions are missing or out of order.",
  );
  assert(
    messageActions.composerValue === "把这条被中断的指令恢复到输入框。",
    "Editing an interrupted message did not restore its text to the composer.",
  );

  const sourceImage = await runCase(
    "source-image",
    1_420,
    "environment-sources-image",
  );
  assert(sourceImage.sourceImageEntry, "Source image entry is missing.");
  assert(
    sourceImage.workflowComponents.includes("sources-surface") &&
      sourceImage.sourcesGeometry?.width > 0 &&
      sourceImage.sourcesGeometry.state === "open",
    "Source image case is not using the public Sources surface.",
  );
  assert(
    sourceImage.sourceImageEntry.label === "打开图片: Codex 环境信息参考.png",
    "Source image entry does not have a distinct accessible name.",
  );
  assert(
    sourceImage.sourceImageEntry.thumbnail &&
      sourceImage.sourceImageEntry.title &&
      sourceImage.sourceImageEntry.thumbnail.right <=
        sourceImage.sourceImageEntry.title.left,
    "Source image thumbnail overlaps its file name.",
  );
  assert(
    sourceImage.sourceImagePreview?.visible &&
      sourceImage.sourceImagePreview.imageAlt === "Codex 环境信息参考.png",
    "Clicking a source image did not open its preview.",
  );

  const checks = await runCase("pr-checks", 1_420, "environment-pr-checks", {
    theme: "dark",
  });
  assert(
    checks.environmentChecksGeometry?.width > 0 &&
      checks.environmentChecksGeometry.left >= 0 &&
      checks.environmentChecksGeometry.right <= checks.windowInnerWidth,
    "Environment PR checks overlay is missing or outside the viewport.",
  );
  for (const status of [
    "passed",
    "pending",
    "failed",
    "skipped",
    "cancelled",
  ]) {
    assert(
      checks.environmentCheckStatuses.includes(status),
      `Environment PR checks are missing the ${status} state.`,
    );
  }

  const emptyChecks = await runCase(
    "pr-checks-empty",
    1_420,
    "environment-pr-checks-empty",
    { theme: "dark" },
  );
  assert(
    emptyChecks.environmentChecksGeometry?.width > 0 &&
      emptyChecks.environmentCheckStatuses.includes("none"),
    "Environment PR checks do not expose the empty state.",
  );

  const rtlReviewOptions = { direction: "rtl", scale: 2, theme: "dark" };
  const review = await runCase(
    "review-rtl",
    1_420,
    "turn-changes-form-controls",
    rtlReviewOptions,
  );
  const narrowReview = await runCase(
    "review-rtl-narrow",
    1_004,
    "turn-changes-form-controls",
    rtlReviewOptions,
  );
  for (const snapshot of [review, narrowReview]) {
    assert(
      snapshot.documentDirection === "rtl" &&
        snapshot.workflowComponents.includes("review-surface") &&
        snapshot.workflowComponents.includes("review-diff"),
      "RTL Review case is not using the public Review and Diff surfaces.",
    );
    assert(
      snapshot.workspaceDock?.width >= 320 &&
        snapshot.reviewGeometry?.root.width >= 320 &&
        snapshot.reviewGeometry.toolbar?.width >= 320 &&
        snapshot.reviewGeometry.reader?.width >= 320 &&
        snapshot.reviewGeometry.files?.width >= 160 &&
        snapshot.reviewGeometry.diffState === "selected" &&
        snapshot.reviewGeometry.lineCount > 0,
      `RTL Review geometry is incomplete or too narrow to use: ${JSON.stringify(snapshot.reviewGeometry)}`,
    );
    assert(
      snapshot.reviewGeometry.lineMarkers.includes("+") &&
        snapshot.reviewGeometry.lineMarkers.includes("−"),
      "RTL Review diff lines are missing visible addition or deletion markers.",
    );
    const reviewReader = snapshot.reviewGeometry.reader;
    const reviewFiles = snapshot.reviewGeometry.files;
    assert(
      reviewReader.right <= reviewFiles.left + 1 ||
        reviewFiles.right <= reviewReader.left + 1 ||
        reviewReader.bottom <= reviewFiles.top + 1 ||
        reviewFiles.bottom <= reviewReader.top + 1,
      "RTL Review diff reader overlaps the changed-file sidebar.",
    );
  }
  assert(
    narrowReview.reviewGeometry.root.width < 480 &&
      narrowReview.reviewGeometry.files.bottom <=
        narrowReview.reviewGeometry.reader.top + 1,
    "Narrow Review must stack the files above the diff reader.",
  );

  const goal = await runCase("goal-dirty", 1_420, "goal-editor-dirty");
  assert(
    goal.workflowComponents.includes("goal-editor") &&
      goal.goalEditorGeometry?.state === "dirty" &&
      goal.goalEditorGeometry.width > 0,
    "Dirty Goal case is not using the public Goal editor surface.",
  );

  const narrow = await runCase("narrow", 980);
  assert(
    narrow.windowInnerWidth <= 1_000,
    "Narrow window width was not applied.",
  );
  // The sidebar automatically collapses at this width. The panel may stay
  // open because the conversation still has at least 480px of usable space.
  assertContentSpace(narrow);
  const narrowOpen = await runCase("narrow-open", 980, "environment-open");
  assertContentSpace(narrowOpen);
  const zoomed = await runCase("zoomed", 1_420, "environment-open", {
    scale: 2,
  });
  assert(
    !zoomed.environmentPanelOpen && !zoomed.environmentPanel?.visible,
    "An explicitly opened panel must close when less than 480px would remain for content.",
  );

  const stages = wide.startupTimings.map((timing) => timing.stage);
  for (const stage of [
    "app-ready",
    "diagnostics-ready",
    "core-state-ready",
    "window-created",
    "renderer-ready",
  ]) {
    assert(stages.includes(stage), `Startup timing is missing ${stage}.`);
  }

  console.log(
    JSON.stringify(
      {
        wide: {
          windowInnerWidth: wide.windowInnerWidth,
          workspaceWidth: wide.workspaceWidth,
          environmentPanelOpen: wide.environmentPanelOpen,
          environmentPanelLeft: wide.environmentPanel.left,
          timelineContentRight: wide.timelineContent.right,
          headerStatus: wide.headerStatus,
          duplicateTurnStatus: wide.turnStatus,
          timelineRight: wide.timelineScroll.right,
          workspaceRight: wide.workspaceContent.right,
        },
        dock: {
          workspaceDockVisible: dock.workspaceDockVisible,
          timelineRight: dock.timelineScroll.right,
          resizerLeft: dock.workspaceDockResizer.left,
          transition: dock.dockTransition,
        },
        messageActions: {
          labels: messageActions.messageActionLabels,
          composerValue: messageActions.composerValue,
        },
        sourceImage: {
          entry: sourceImage.sourceImageEntry,
          preview: sourceImage.sourceImagePreview,
        },
        checks: {
          geometry: checks.environmentChecksGeometry,
          statuses: checks.environmentCheckStatuses,
          emptyStatuses: emptyChecks.environmentCheckStatuses,
        },
        review: {
          workspaceDock: review.workspaceDock,
          ...review.reviewGeometry,
        },
        reviewNarrow: narrowReview.reviewGeometry,
        goal: goal.goalEditorGeometry,
        narrow: {
          windowInnerWidth: narrow.windowInnerWidth,
          workspaceWidth: narrow.workspaceWidth,
          environmentPanelOpen: narrow.environmentPanelOpen,
        },
        startupTimings: wide.startupTimings,
      },
      undefined,
      2,
    ),
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
