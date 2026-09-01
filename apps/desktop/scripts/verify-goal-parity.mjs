import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
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
  {
    view: "goal-active",
    actions: ["clear", "pause", "edit"],
    tone: "info",
  },
  {
    view: "goal-paused",
    actions: ["clear", "resume", "edit"],
    tone: "neutral",
  },
  {
    view: "goal-blocked",
    actions: ["clear", "resume", "edit"],
    tone: "danger",
  },
  {
    view: "goal-usage-limited",
    actions: ["clear", "resume", "edit"],
    tone: "warning",
  },
  {
    view: "goal-budget-limited",
    actions: ["clear", "edit"],
    tone: "warning",
  },
  {
    view: "goal-complete",
    actions: ["clear", "edit"],
    tone: "success",
  },
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
    tone: "neutral",
  });
}
const results = [];

await mkdir(outputDirectory, { recursive: true });
try {
  for (const testCase of cases) {
    const { id, view, actions, locale, theme, width, scale, editorMode, tone } =
      testCase;
    const expectedActions = actions.map(
      (action) => actionLabels[locale][action],
    );
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
    // Never inherit a live dev server: the smoke must exercise the built
    // production renderer from this checkout, not whatever serves 127.0.0.1.
    delete environment.ELECTRON_RUN_AS_NODE;
    delete environment.ARTEMIS_DEV_SERVER_URL;
    // Electron user data (Cache, Local Storage, artemis.sqlite, ...) lives
    // in a dedicated user-data subtree with one fresh directory per case x
    // attempt, never directly at the throwaway run root's case level.
    const caseUserDataDirectory = (attempt) =>
      join(temporaryDirectory, "user-data", `${id}-attempt-${attempt}`);
    const launch = (disableRendererSandbox, attempt) => {
      const userDataPreexisting = existsSync(caseUserDataDirectory(attempt));
      const result = spawnSync(
        electronPath,
        [
          appDirectory,
          `--user-data-dir=${caseUserDataDirectory(attempt)}`,
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
      return { result, userDataPreexisting };
    };
    let launchOutcome = launch(false, 0);
    if (
      (launchOutcome.result.error || launchOutcome.result.status !== 0) &&
      !process.env.CI
    ) {
      launchOutcome = launch(true, 1);
    }
    const launchResult = launchOutcome.result;
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
    // Goal parity has no disk workspace: the state under test is the seeded
    // goal state living inside the isolated user-data directory itself, so
    // the isolation gate mirrors the queued-steer verifier -- the winning
    // launch must start from a directory that did not exist yet, and the
    // throwaway run root may only ever hold the dedicated user-data subtree.
    const unexpectedRunRootEntries = (await readdir(temporaryDirectory))
      .sort()
      .filter((entry) => entry !== "user-data");
    if (launchOutcome.userDataPreexisting || unexpectedRunRootEntries.length) {
      throw new Error(
        `${id} user-data isolation drifted: ${JSON.stringify({
          preexistingUserDataDirectory: launchOutcome.userDataPreexisting,
          unexpectedRunRootEntries,
        })}`,
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
    const shared = audit.goalSharedComponents;
    if (
      shared?.main?.component !== "button" ||
      shared.main.state !== "ready" ||
      shared.main.size !== "compact" ||
      shared.main.variant !== "quiet" ||
      shared.main.display !== "flex" ||
      shared.main.minBlockSize !== "28px" ||
      shared.main.justifyContent !== "flex-start" ||
      shared?.badge?.component !== "badge" ||
      shared.badge.tone !== tone ||
      shared.badge.display !== "flex" ||
      shared.badge.minBlockSize !== "26px" ||
      shared?.status?.component !== "status" ||
      shared.status.tone !== tone ||
      shared.status.display !== "flex" ||
      shared.status.minBlockSize !== "26px" ||
      shared.actions?.length !== expectedActions.length ||
      shared.actions.some(
        (action) =>
          action?.component !== "icon-button" ||
          action.state !== "ready" ||
          action.size !== "compact" ||
          action.variant !== "quiet" ||
          action.display !== "flex" ||
          action.inlineSize !== "28px" ||
          action.minBlockSize !== "28px",
      )
    ) {
      throw new Error(
        `${id} shared action component contract drifted: ${JSON.stringify({ shared, tone })}`,
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
      sharedComponents: shared,
      userDataIsolation: {
        freshStart: !launchOutcome.userDataPreexisting,
        runRootUnexpectedEntries: unexpectedRunRootEntries,
      },
    });
  }
  const manifestPath = join(outputDirectory, "manifest.json");
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        format: "artemis-goal-parity",
        version: 2,
        userDataIsolation: {
          directory:
            "user-data/<id>-attempt-<attempt> under the throwaway run root",
          note: "Electron user data never sits directly at the run-root case level; every case x attempt launch gets its own fresh directory, and each case records freshStart plus the run-root purity check. The state under test is the seeded goal state inside that isolated directory.",
        },
        results,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(manifestPath);
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true });
}
