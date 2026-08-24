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

async function runCase(name, width) {
  const screenshotPath = join(temporaryDirectory, `${name}.png`);
  const accessibilityPath = join(temporaryDirectory, `${name}.a11y.json`);
  const environment = {
    ...process.env,
    ARTEMIS_SMOKE_SCREENSHOT: screenshotPath,
    ARTEMIS_SMOKE_ACCESSIBILITY: accessibilityPath,
    ARTEMIS_SMOKE_LOCALE: "zh-CN",
    ARTEMIS_SMOKE_VIEW: "environment",
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
        result.error?.message,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return JSON.parse(await readFile(accessibilityPath, "utf8"));
}

try {
  const wide = await runCase("wide", 1_420);
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
    !wide.issues.some(
      (issue) => issue.rule === "environment-conversation-overlap",
    ),
    "Wide window environment panel overlaps the conversation.",
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
        },
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
