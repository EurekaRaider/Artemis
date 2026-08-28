import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(scriptDirectory, "..");
const outputDirectory = resolve(
  process.argv[2] ?? join(tmpdir(), "artemis-goal-parity"),
);
const electronPath = createRequire(import.meta.url)("electron");
const temporaryDirectory = await mkdtemp(join(tmpdir(), "artemis-goal-smoke-"));
const actionLabels = {
  en: {
    clear: "Clear goal",
    pause: "Pause goal",
    resume: "Resume goal",
    edit: "Edit goal",
  },
  "zh-CN": {
    clear: "清除目标",
    pause: "暂停目标",
    resume: "继续目标",
    edit: "编辑目标",
  },
};
const stateDefinitions = [
  { view: "goal-active", actions: ["clear", "pause", "edit"] },
  { view: "goal-paused", actions: ["clear", "resume", "edit"] },
  { view: "goal-blocked", actions: ["clear", "resume", "edit"] },
  { view: "goal-usage-limited", actions: ["clear", "resume", "edit"] },
  { view: "goal-budget-limited", actions: ["clear", "edit"] },
  { view: "goal-complete", actions: ["clear", "edit"] },
];
const dimensions = [];
for (const locale of ["zh-CN", "en"]) {
  for (const theme of ["dark", "light"]) {
    for (const width of [980, 1_512]) {
      for (const scale of [1, 1.5]) {
        dimensions.push({ locale, theme, width, scale });
      }
    }
  }
}
const cases = stateDefinitions.flatMap((state) =>
  dimensions.map((dimension) => ({
    ...state,
    ...dimension,
    id: `${state.view}-${dimension.locale}-${dimension.theme}-${dimension.width}-${String(dimension.scale).replace(".", "_")}`,
  })),
);
const originalObjective =
  "完成 Artemis /goal 控制条与编辑器的 Codex 像素级和生命周期对齐";
const editedObjective = "编辑后的 Goal 内容已通过独立编辑器保存";
for (const mode of [
  "clean",
  "dirty",
  "empty",
  "revert",
  "shortcut",
  "saving",
  "load-error",
  "save-error",
]) {
  cases.push({
    id: `goal-editor-${mode}`,
    view: `goal-editor-${mode}`,
    actions: ["clear", "resume", "edit"],
    locale: "zh-CN",
    theme: "dark",
    width: 1_512,
    scale: 1,
    editorMode: mode,
  });
}
const results = [];

await mkdir(outputDirectory, { recursive: true });
try {
  for (const testCase of cases) {
    const { id, view, actions, locale, theme, width, scale, editorMode } =
      testCase;
    const expectedActions = actions.map((action) => actionLabels[locale][action]);
    const expectEditor = editorMode !== undefined;
    const screenshotPath = join(outputDirectory, `${id}.png`);
    const accessibilityPath = join(outputDirectory, `${id}.a11y.json`);
    await rm(screenshotPath, { force: true });
    await rm(accessibilityPath, { force: true });
    const environment = {
      ...process.env,
      ARTEMIS_SMOKE_SCREENSHOT: screenshotPath,
      ARTEMIS_SMOKE_ACCESSIBILITY: accessibilityPath,
      ARTEMIS_SMOKE_LOCALE: locale,
      ARTEMIS_SMOKE_SCALE: String(scale),
      ARTEMIS_SMOKE_SETTLE_DELAY: "250",
      ARTEMIS_SMOKE_THEME: theme,
      ARTEMIS_SMOKE_VIEW: view,
      ARTEMIS_SMOKE_WINDOW_WIDTH: String(width),
    };
    delete environment.ELECTRON_RUN_AS_NODE;
    const launch = (disableRendererSandbox) =>
      spawnSync(
        electronPath,
        [
          appDirectory,
          `--user-data-dir=${join(temporaryDirectory, id)}`,
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
    let launchResult = launch(false);
    if ((launchResult.error || launchResult.status !== 0) && !process.env.CI) {
      launchResult = launch(true);
    }
    if (launchResult.error || launchResult.status !== 0) {
      throw new Error(
        [
          `Goal smoke view ${id} failed.`,
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
    if (screenshotBytes < 10_000) {
      throw new Error(`${id} screenshot is unexpectedly small.`);
    }
    if (audit.issues?.length) {
      throw new Error(
        `${id} accessibility audit failed: ${JSON.stringify(audit.issues)}`,
      );
    }
    if (!audit.goalBar?.visible || !audit.goalComposer) {
      throw new Error(`${id} did not render the Goal rail and composer.`);
    }
    const leftInset = audit.goalBar.left - audit.goalComposer.left;
    const rightInset = audit.goalComposer.right - audit.goalBar.right;
    const overlap = audit.goalBar.bottom - audit.goalComposer.top;
    if (
      Math.abs(leftInset - 13) > 1 ||
      Math.abs(rightInset - 13) > 1 ||
      Math.abs(overlap - 4) > 1
    ) {
      throw new Error(
        `${id} rail geometry drifted: ${JSON.stringify({ leftInset, rightInset, overlap })}`,
      );
    }
    if (
      JSON.stringify(audit.goalActionLabels) !== JSON.stringify(expectedActions)
    ) {
      throw new Error(
        `${id} actions drifted: ${JSON.stringify(audit.goalActionLabels)}`,
      );
    }
    if (Boolean(audit.goalEditorVisible) !== expectEditor) {
      throw new Error(`${id} editor visibility drifted.`);
    }
    for (const geometry of audit.goalActionGeometry ?? []) {
      if (
        Math.abs(geometry.width - 28) > 0.1 ||
        Math.abs(geometry.height - 28) > 0.1 ||
        Math.abs(geometry.iconWidth - 14) > 0.1 ||
        Math.abs(geometry.iconHeight - 14) > 0.1
      ) {
        throw new Error(
          `${id} action geometry drifted: ${JSON.stringify(geometry)}`,
        );
      }
    }
    if (editorMode !== undefined) {
      const expected = {
        clean: {
          value: originalObjective,
          saveDisabled: true,
          revertDisabled: true,
          busy: false,
        },
        dirty: {
          value: editedObjective,
          saveDisabled: false,
          revertDisabled: false,
          busy: false,
        },
        empty: {
          value: "   ",
          saveDisabled: true,
          revertDisabled: false,
          busy: false,
        },
        revert: {
          value: originalObjective,
          saveDisabled: true,
          revertDisabled: true,
          busy: false,
        },
        shortcut: {
          value: editedObjective,
          saveDisabled: true,
          revertDisabled: true,
          busy: false,
        },
        saving: {
          value: editedObjective,
          saveDisabled: true,
          revertDisabled: true,
          busy: true,
        },
        "load-error": {
          value: null,
          saveDisabled: true,
          revertDisabled: true,
          busy: false,
          alert: "载入目标内容失败",
        },
        "save-error": {
          value: editedObjective,
          saveDisabled: false,
          revertDisabled: false,
          busy: false,
          alert: "保存目标内容失败",
        },
      }[editorMode];
      const actual = {
        value: audit.goalEditorValue,
        saveDisabled: audit.goalEditorSaveDisabled,
        revertDisabled: audit.goalEditorRevertDisabled,
        busy: audit.goalEditorBusy,
      };
      if (
        JSON.stringify(actual) !==
          JSON.stringify({
            value: expected.value,
            saveDisabled: expected.saveDisabled,
            revertDisabled: expected.revertDisabled,
            busy: expected.busy,
          }) ||
        (expected.alert && !audit.goalEditorAlert?.includes(expected.alert))
      ) {
        throw new Error(
          `${id} editor state drifted: ${JSON.stringify({ actual, alert: audit.goalEditorAlert, expected })}`,
        );
      }
    }
    results.push({
      id,
      view,
      locale,
      theme,
      width,
      scale,
      screenshot: `${id}.png`,
      screenshotBytes,
      actions: audit.goalActionLabels,
      geometry: { leftInset, rightInset, overlap },
      editorVisible: audit.goalEditorVisible,
    });
  }
  const manifestPath = join(outputDirectory, "manifest.json");
  await writeFile(
    manifestPath,
    `${JSON.stringify({ format: "artemis-goal-parity", version: 2, results }, null, 2)}\n`,
    "utf8",
  );
  console.log(manifestPath);
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true });
}
