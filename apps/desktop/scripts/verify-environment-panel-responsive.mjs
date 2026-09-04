import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(scriptDirectory, "..");
const require = createRequire(import.meta.url);
const electronPath = require("electron");
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "artemis-environment-panel-"),
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runCase(
  name,
  width,
  view = "environment",
  { direction = "ltr", scale = 1, theme = "light" } = {},
) {
  const screenshotPath = join(temporaryDirectory, `${name}.png`);
  const accessibilityPath = join(temporaryDirectory, `${name}.a11y.json`);
  const environment = {
    ...process.env,
    ARTEMIS_SMOKE_SCREENSHOT: screenshotPath,
    ARTEMIS_SMOKE_ACCESSIBILITY: accessibilityPath,
    ARTEMIS_SMOKE_LOCALE: "zh-CN",
    ARTEMIS_SMOKE_DIRECTION: direction,
    ARTEMIS_SMOKE_SCALE: String(scale),
    ARTEMIS_SMOKE_THEME: theme,
    ARTEMIS_SMOKE_VIEW: view,
    ARTEMIS_SMOKE_WINDOW_WIDTH: String(width),
  };
  delete environment.ELECTRON_RUN_AS_NODE;
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
  const wide = await runCase("wide", 1_420, "environment-open");
  assert(wide.windowInnerWidth >= 1_400, "Wide window width was not applied.");
  assert(
    wide.environmentPanelOpen,
    "Wide window did not default the panel open.",
  );
  assert(
    wide.environmentPanel?.visible,
    "Wide window environment panel is not visible.",
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
  assert(wide.turnStatus, "Wide window completed status bounds are missing.");
  assert(wide.workspaceContent, "Wide window workspace bounds are missing.");
  assert(
    Math.abs(wide.timelineScroll.right - wide.workspaceContent.right) <= 1,
    "Environment popover moved the timeline scrollbar away from the workspace edge.",
  );
  assert(
    wide.timelineContent.right <= wide.environmentPanel.left,
    "Environment popover overlaps the timeline content safe area.",
  );
  assert(
    Math.abs(wide.turnStatus.left - wide.timelineContent.left) <= 1 &&
      Math.abs(wide.turnStatus.right - wide.timelineContent.right) <= 1,
    "Completed status row is not aligned with the environment-safe timeline content.",
  );

  const dock = await runCase("dock", 1_420, "environment-dock");
  assert(dock.workspaceDockVisible, "Workspace Tab Dock did not open.");
  assert(dock.timelineScroll, "Dock case timeline scroll bounds are missing.");
  assert(
    dock.workspaceDockResizer,
    "Dock case workspace resizer bounds are missing.",
  );
  assert(
    Math.abs(dock.timelineScroll.right - dock.workspaceDockResizer.left) <= 1,
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
    Math.abs(
      dock.dockTransition.before.status.left -
        dock.dockTransition.after.status.left,
    ) <= 1 &&
      Math.abs(
        dock.dockTransition.before.environment.left -
          dock.dockTransition.after.environment.left,
      ) <= 1,
    "Opening the Workspace Tab Dock moved the status or environment controls.",
  );

  const messageActions = await runCase(
    "message-actions",
    1_420,
    "message-actions-edit",
  );
  assert(
    JSON.stringify(messageActions.messageActionLabels) ===
      JSON.stringify(["复制消息", "编辑后重新发送", "复制消息"]),
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

  const review = await runCase(
    "review-rtl",
    1_420,
    "turn-changes-form-controls",
    { direction: "rtl", scale: 2, theme: "dark" },
  );
  assert(
    review.documentDirection === "rtl" &&
      review.workflowComponents.includes("review-surface") &&
      review.workflowComponents.includes("review-diff"),
    "RTL Review case is not using the public Review and Diff surfaces.",
  );
  assert(
    review.workspaceDock?.width >= 320 &&
      review.reviewGeometry?.root.width >= 320 &&
      review.reviewGeometry.toolbar?.width >= 320 &&
      review.reviewGeometry.reader?.width >= 320 &&
      review.reviewGeometry.files?.width >= 320 &&
      review.reviewGeometry.diffState === "selected" &&
      review.reviewGeometry.lineCount > 0,
    "RTL Review geometry is incomplete or too narrow to use.",
  );
  assert(
    review.reviewGeometry.lineMarkers.includes("+") &&
      review.reviewGeometry.lineMarkers.includes("−"),
    "RTL Review diff lines are missing visible addition or deletion markers.",
  );
  const reviewReader = review.reviewGeometry.reader;
  const reviewFiles = review.reviewGeometry.files;
  assert(
    reviewReader.right <= reviewFiles.left + 1 ||
      reviewFiles.right <= reviewReader.left + 1 ||
      reviewReader.bottom <= reviewFiles.top + 1 ||
      reviewFiles.bottom <= reviewReader.top + 1,
    "RTL Review diff reader overlaps the changed-file sidebar.",
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
  assert(
    !narrow.environmentPanelOpen,
    "Narrow window did not auto-hide the environment panel.",
  );
  assert(
    !narrow.environmentPanel?.visible,
    "Narrow window environment panel remains visible.",
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
          turnStatusLeft: wide.turnStatus.left,
          turnStatusRight: wide.turnStatus.right,
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
