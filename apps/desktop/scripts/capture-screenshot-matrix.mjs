import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(appDirectory, "..", "..");
const outputDirectory = resolve(
  process.argv.slice(2).find((argument) => !argument.startsWith("--")) ??
    join(repositoryRoot, "artifacts", "screenshot-matrix"),
);
const require = createRequire(import.meta.url);
const electronPath = require("electron");
const budget = JSON.parse(
  await readFile(
    join(repositoryRoot, "scripts/ui-performance-budget.json"),
    "utf8",
  ),
);
const locales = [
  "en",
  "zh-CN",
  "zh-TW",
  "ja",
  "ko",
  "es",
  "fr",
  "de",
  "pt-BR",
  "it",
  "ru",
  "ar",
  "hi",
  "id",
];
const baseVariants = locales.map((locale, index) => ({
  id: `${locale}-base`,
  locale,
  direction: locale === "ar" ? "rtl" : "ltr",
  height: 900,
  reducedMotion: false,
  theme: index % 2 === 0 ? "light" : "dark",
  width: 1_440,
  zoomFactor: 1,
}));
const scaledVariants = ["en", "zh-CN", "de", "ar"].flatMap((locale) => [
  {
    id: `${locale}-dark-125`,
    locale,
    direction: locale === "ar" ? "rtl" : "ltr",
    height: 900,
    reducedMotion: false,
    theme: "dark",
    width: 1_440,
    zoomFactor: 1.25,
  },
  {
    id: `${locale}-light-150-reduced`,
    locale,
    direction: locale === "ar" ? "rtl" : "ltr",
    height: 900,
    reducedMotion: true,
    theme: "light",
    width: 1_440,
    zoomFactor: 1.5,
  },
]);
const variants = [
  ...baseVariants,
  ...scaledVariants,
  {
    id: "ja-system-125",
    locale: "ja",
    direction: "ltr",
    height: 900,
    reducedMotion: false,
    theme: "system",
    width: 1_440,
    zoomFactor: 1.25,
  },
  {
    id: "en-dark-200-reduced",
    locale: "en",
    direction: "ltr",
    height: 900,
    reducedMotion: true,
    theme: "dark",
    width: 1_440,
    zoomFactor: 2,
  },
  {
    id: "ar-light-200",
    locale: "ar",
    direction: "rtl",
    height: 900,
    reducedMotion: false,
    theme: "light",
    width: 1_440,
    zoomFactor: 2,
  },
  {
    id: "en-light-narrow",
    locale: "en",
    direction: "ltr",
    height: 720,
    reducedMotion: false,
    theme: "light",
    width: 980,
    zoomFactor: 1,
  },
  {
    id: "ar-dark-narrow-125-reduced",
    locale: "ar",
    direction: "rtl",
    height: 720,
    reducedMotion: true,
    theme: "dark",
    width: 980,
    zoomFactor: 1.25,
  },
];

function runGit(arguments_) {
  const result = spawnSync("git", arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Screenshot matrix could not run git ${arguments_.join(" ")}: ${result.error?.message ?? result.stderr}`,
    );
  }
  return result.stdout.trim();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const candidateHead = runGit(["rev-parse", "HEAD"]);
const expectedHead = process.env.ARTEMIS_EXPECTED_HEAD?.trim() || candidateHead;
assert(
  /^[0-9a-f]{40}$/u.test(candidateHead) && expectedHead === candidateHead,
  `Screenshot matrix expected HEAD ${expectedHead} does not match candidate ${candidateHead}.`,
);
const initialStatus = runGit(["status", "--porcelain"]);
assert(
  initialStatus === "",
  `Screenshot matrix requires a clean exact-head worktree:\n${initialStatus}`,
);

await mkdir(outputDirectory, { recursive: true });
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "artemis-screenshot-matrix-"),
);
const manifest = {
  format: "artemis-screenshot-matrix",
  version: 2,
  generatedAt: new Date().toISOString(),
  candidateHead,
  expectedHead,
  platform: process.platform,
  architecture: process.arch,
  rendererSandbox: true,
  coverage: {
    locales,
    directions: ["ltr", "rtl"],
    themes: ["system", "light", "dark"],
    zoomFactors: [1, 1.25, 1.5, 2],
    reducedMotion: [false, true],
    viewports: ["1440x900", "980x720"],
  },
  variants: [],
};

try {
  for (const variant of variants) {
    const screenshotPath = join(outputDirectory, `${variant.id}.png`);
    const accessibilityPath = join(outputDirectory, `${variant.id}.a11y.json`);
    await rm(screenshotPath, { force: true });
    await rm(accessibilityPath, { force: true });
    const environment = {
      ...process.env,
      ARTEMIS_SMOKE_SCREENSHOT: screenshotPath,
      ARTEMIS_SMOKE_ACCESSIBILITY: accessibilityPath,
      ARTEMIS_SMOKE_DIRECTION: variant.direction,
      ARTEMIS_SMOKE_LOCALE: variant.locale,
      ARTEMIS_SMOKE_SCALE: String(variant.zoomFactor),
      ARTEMIS_SMOKE_THEME: variant.theme,
      ARTEMIS_SMOKE_WINDOW_HEIGHT: String(variant.height),
      ARTEMIS_SMOKE_WINDOW_WIDTH: String(variant.width),
    };
    delete environment.ARTEMIS_DEV_SERVER_URL;
    delete environment.ELECTRON_RUN_AS_NODE;
    const electronArguments = [
      appDirectory,
      `--user-data-dir=${join(temporaryDirectory, "user-data", variant.id)}`,
      "--disable-gpu",
      "--disable-gpu-compositing",
      "--disable-gpu-sandbox",
      "--use-angle=swiftshader",
      ...(variant.reducedMotion
        ? ["--force-prefers-reduced-motion"]
        : ["--force-prefers-no-reduced-motion"]),
    ];
    const launchStartedAt = performance.now();
    const result = spawnSync(electronPath, electronArguments, {
      cwd: appDirectory,
      env: environment,
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const launchDurationMs = performance.now() - launchStartedAt;
    if (result.error || result.status !== 0) {
      throw new Error(
        [
          `Screenshot variant ${variant.id} failed.`,
          `status=${String(result.status)} signal=${String(result.signal)}`,
          result.error?.message,
          result.stdout,
          result.stderr,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }

    const screenshot = await readFile(screenshotPath);
    const screenshotSize = (await stat(screenshotPath)).size;
    assert(
      screenshotSize > 10_000,
      `Screenshot variant ${variant.id} is unexpectedly small.`,
    );
    const accessibility = JSON.parse(await readFile(accessibilityPath, "utf8"));
    assert(
      accessibility.title === "Artemis",
      `${variant.id} title is ${JSON.stringify(accessibility.title)}.`,
    );
    assert(
      accessibility.documentLanguage === variant.locale,
      `${variant.id} document language is ${JSON.stringify(accessibility.documentLanguage)}.`,
    );
    assert(
      accessibility.documentDirection === variant.direction,
      `${variant.id} document direction is ${JSON.stringify(accessibility.documentDirection)}.`,
    );
    assert(
      accessibility.zoomFactor === variant.zoomFactor,
      `${variant.id} zoom factor is ${JSON.stringify(accessibility.zoomFactor)}.`,
    );
    assert(
      accessibility.themePreference === variant.theme,
      `${variant.id} theme preference is ${JSON.stringify(accessibility.themePreference)}.`,
    );
    assert(
      ["light", "dark"].includes(accessibility.resolvedTheme) &&
        accessibility.contrastMode === "normal",
      `${variant.id} resolved theme is ${JSON.stringify(accessibility.resolvedTheme)} with contrast ${JSON.stringify(accessibility.contrastMode)}.`,
    );
    assert(
      Array.isArray(accessibility.issues) && accessibility.issues.length === 0,
      `${variant.id} accessibility issues: ${JSON.stringify(accessibility.issues)}.`,
    );
    assert(
      accessibility.interactiveCount >= 1,
      `${variant.id} has no interactive controls.`,
    );
    assert(
      accessibility.runtimeSecurity?.sandbox === true &&
        accessibility.runtimeSecurity?.contextIsolation === true &&
        accessibility.runtimeSecurity?.nodeIntegration === false,
      `${variant.id} runtime security failed: ${JSON.stringify(accessibility.runtimeSecurity)}.`,
    );
    assert(
      Array.isArray(accessibility.rendererConsoleEntries) &&
        accessibility.rendererConsoleEntries.length === 0,
      `${variant.id} renderer console is not clean: ${JSON.stringify(accessibility.rendererConsoleEntries)}.`,
    );
    assert(
      accessibility.feedbackLayout?.reducedMotion === variant.reducedMotion,
      `${variant.id} reduced-motion state is ${JSON.stringify(accessibility.feedbackLayout?.reducedMotion)}.`,
    );
    assert(
      Math.abs(
        accessibility.windowInnerWidth - variant.width / variant.zoomFactor,
      ) <= 35,
      `${variant.id} inner width is ${String(accessibility.windowInnerWidth)}.`,
    );
    assert(
      Math.abs(
        accessibility.windowInnerHeight - variant.height / variant.zoomFactor,
      ) <= 65,
      `${variant.id} inner height is ${String(accessibility.windowInnerHeight)}.`,
    );

    const startupTimings = accessibility.startupTimings ?? [];
    for (const [stage, maximum] of Object.entries(
      budget.thresholds.startupStageMaximumMs,
    )) {
      const timing = startupTimings.find(
        (candidate) => candidate.stage === stage,
      );
      assert(
        Number.isFinite(timing?.elapsedMs) && timing.elapsedMs <= maximum,
        `${variant.id} startup stage ${stage} is ${String(timing?.elapsedMs)}ms; maximum ${String(maximum)}ms.`,
      );
    }

    manifest.variants.push({
      ...variant,
      screenshot: `${variant.id}.png`,
      screenshotBytes: screenshotSize,
      screenshotSha256: createHash("sha256").update(screenshot).digest("hex"),
      accessibility: `${variant.id}.a11y.json`,
      interactiveCount: accessibility.interactiveCount,
      issueCount: accessibility.issues.length,
      rendererSandbox: true,
      launchDurationMs: Number(launchDurationMs.toFixed(1)),
      startupTimings,
      actualViewport: {
        width: accessibility.windowInnerWidth,
        height: accessibility.windowInnerHeight,
      },
    });
  }

  assert(
    new Set(manifest.variants.map((variant) => variant.screenshotSha256))
      .size === variants.length,
    "Screenshot matrix variants are not visually distinct.",
  );
  const finalHead = runGit(["rev-parse", "HEAD"]);
  const finalStatus = runGit(["status", "--porcelain"]);
  assert(
    finalHead === candidateHead && finalStatus === initialStatus,
    `Screenshot matrix changed the candidate worktree: HEAD ${finalHead}; status ${JSON.stringify(finalStatus)}.`,
  );
  const manifestPath = join(outputDirectory, "manifest.json");
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, undefined, 2)}\n`,
    "utf8",
  );
  console.log(manifestPath);
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true });
}
