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
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(appDirectory, "..", "..");
const outputDirectory = resolve(
  process.argv[2] ?? join(repositoryRoot, "artifacts", "screenshot-matrix"),
);
const require = createRequire(import.meta.url);
const electronPath = require("electron");
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
const variants = [
  ...locales.map((locale) => [locale, 1]),
  ...["en", "zh-CN", "de", "ar"].flatMap((locale) => [
    [locale, 1.25],
    [locale, 1.5],
  ]),
];

await mkdir(outputDirectory, { recursive: true });
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "artemis-screenshot-matrix-"),
);
const manifest = {
  format: "artemis-screenshot-matrix",
  version: 1,
  generatedAt: new Date().toISOString(),
  platform: process.platform,
  architecture: process.arch,
  rendererSandbox: true,
  variants: [],
};
let sandboxFallback = false;

try {
  for (const [locale, zoomFactor] of variants) {
    const suffix = `${locale}-${Math.round(zoomFactor * 100)}`;
    const screenshotPath = join(outputDirectory, `${suffix}.png`);
    const accessibilityPath = join(outputDirectory, `${suffix}.a11y.json`);
    await rm(screenshotPath, { force: true });
    await rm(accessibilityPath, { force: true });
    const environment = {
      ...process.env,
      ARTEMIS_SMOKE_SCREENSHOT: screenshotPath,
      ARTEMIS_SMOKE_ACCESSIBILITY: accessibilityPath,
      ARTEMIS_SMOKE_LOCALE: locale,
      ARTEMIS_SMOKE_SCALE: String(zoomFactor),
    };
    delete environment.ELECTRON_RUN_AS_NODE;
    const launch = (disableRendererSandbox) =>
      spawnSync(
        electronPath,
        [
          appDirectory,
          `--user-data-dir=${join(
            temporaryDirectory,
            `${suffix}-${disableRendererSandbox ? "fallback" : "sandboxed"}`,
          )}`,
          "--disable-gpu",
          "--disable-gpu-compositing",
          "--disable-gpu-sandbox",
          "--use-angle=swiftshader",
          ...(disableRendererSandbox ? ["--no-sandbox"] : []),
        ],
        {
          cwd: appDirectory,
          env: environment,
          encoding: "utf8",
          timeout: 45_000,
          maxBuffer: 2 * 1024 * 1024,
        },
      );
    let result = launch(sandboxFallback);
    if (
      !sandboxFallback &&
      (result.error || result.status !== 0) &&
      !process.env.CI
    ) {
      sandboxFallback = true;
      manifest.rendererSandbox = false;
      result = launch(true);
    }
    if (result.error || result.status !== 0) {
      throw new Error(
        [
          `Screenshot variant ${suffix} failed.`,
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
    if (screenshotSize < 10_000) {
      throw new Error(`Screenshot variant ${suffix} is unexpectedly small.`);
    }
    const accessibility = JSON.parse(await readFile(accessibilityPath, "utf8"));
    if (
      accessibility.documentLanguage !== locale ||
      accessibility.documentDirection !== (locale === "ar" ? "rtl" : "ltr") ||
      accessibility.zoomFactor !== zoomFactor ||
      !Array.isArray(accessibility.issues) ||
      accessibility.issues.length > 0 ||
      accessibility.interactiveCount < 1
    ) {
      throw new Error(
        `Accessibility audit failed for ${suffix}: ${JSON.stringify(
          accessibility,
        )}`,
      );
    }
    manifest.variants.push({
      locale,
      zoomFactor,
      screenshot: `${suffix}.png`,
      screenshotBytes: screenshotSize,
      screenshotSha256: createHash("sha256").update(screenshot).digest("hex"),
      accessibility: `${suffix}.a11y.json`,
      interactiveCount: accessibility.interactiveCount,
      issueCount: accessibility.issues.length,
      rendererSandbox: !sandboxFallback,
    });
  }
  if (
    new Set(manifest.variants.map((variant) => variant.screenshotSha256))
      .size !== variants.length
  ) {
    throw new Error("Screenshot matrix variants are not visually distinct.");
  }
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
