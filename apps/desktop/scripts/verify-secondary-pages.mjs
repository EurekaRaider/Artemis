import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(appDirectory, "..", "..");
const runGit = (arguments_) => {
  const result = spawnSync("git", arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Secondary pages verifier could not run git ${arguments_.join(" ")}: ${result.error?.message ?? result.stderr}`,
    );
  }
  return result.stdout.trim();
};

const candidateHead = runGit(["rev-parse", "HEAD"]);
const expectedHead = process.env.ARTEMIS_EXPECTED_HEAD?.trim() || candidateHead;
if (
  !/^[0-9a-f]{40}$/u.test(candidateHead) ||
  !/^[0-9a-f]{40}$/u.test(expectedHead) ||
  candidateHead !== expectedHead
) {
  throw new Error(
    `Secondary pages expected HEAD ${expectedHead} does not match candidate ${candidateHead}.`,
  );
}
const initialStatus = runGit(["status", "--porcelain"]);
if (initialStatus !== "") {
  throw new Error(
    `Secondary pages verification requires a clean exact-head worktree:\n${initialStatus}`,
  );
}

const outputDirectory = resolve(
  process.argv.slice(2).find((argument) => !argument.startsWith("--")) ??
    join(repositoryRoot, "artifacts", "secondary-pages"),
);
const electronPath = createRequire(import.meta.url)("electron");
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "artemis-secondary-pages-"),
);
const pages = [
  { id: "archive", view: "secondary-pages-archive" },
  { id: "token-usage", view: "secondary-pages-token-usage" },
  { id: "automations", view: "secondary-pages-automations" },
];
const variants = [
  {
    id: "light-en-wide-100",
    direction: "ltr",
    locale: "en",
    scale: 1,
    theme: "light",
    width: 1_440,
  },
  {
    id: "dark-en-wide-100",
    direction: "ltr",
    locale: "en",
    scale: 1,
    theme: "dark",
    width: 1_440,
  },
  {
    id: "light-zh-wide-100",
    direction: "ltr",
    locale: "zh-CN",
    scale: 1,
    theme: "light",
    width: 1_440,
  },
  {
    id: "dark-ar-rtl-narrow-100",
    direction: "rtl",
    locale: "ar",
    scale: 1,
    theme: "dark",
    width: 980,
  },
  {
    id: "light-en-wide-200",
    direction: "ltr",
    locale: "en",
    scale: 2,
    theme: "light",
    width: 1_440,
  },
];
const cases = pages.flatMap((page) =>
  variants.map((variant) => ({
    ...page,
    ...variant,
    caseId: `${page.id}-${variant.id}`,
    pageId: page.id,
    variantId: variant.id,
  })),
);

const results = [];
await mkdir(outputDirectory, { recursive: true });
try {
  for (const testCase of cases) {
    const screenshotPath = join(outputDirectory, `${testCase.caseId}.png`);
    const accessibilityPath = join(
      outputDirectory,
      `${testCase.caseId}.a11y.json`,
    );
    await rm(screenshotPath, { force: true });
    await rm(accessibilityPath, { force: true });
    const environment = {
      ...process.env,
      ARTEMIS_SMOKE_ACCESSIBILITY: accessibilityPath,
      ARTEMIS_SMOKE_DIRECTION: testCase.direction,
      ARTEMIS_SMOKE_LOCALE: testCase.locale,
      ARTEMIS_SMOKE_SCALE: String(testCase.scale),
      ARTEMIS_SMOKE_SCREENSHOT: screenshotPath,
      ARTEMIS_SMOKE_SETTLE_DELAY: "700",
      ARTEMIS_SMOKE_THEME: testCase.theme,
      ARTEMIS_SMOKE_VIEW: testCase.view,
      ARTEMIS_SMOKE_WINDOW_WIDTH: String(testCase.width),
    };
    delete environment.ARTEMIS_DEV_SERVER_URL;
    delete environment.ELECTRON_RUN_AS_NODE;

    const userDataDirectory = (attempt) =>
      join(
        temporaryDirectory,
        "user-data",
        testCase.caseId,
        `attempt-${attempt}`,
      );
    const launch = (attempt) => {
      const target = userDataDirectory(attempt);
      const userDataPreexisting = existsSync(target);
      const result = spawnSync(
        electronPath,
        [
          appDirectory,
          `--user-data-dir=${target}`,
          "--disable-gpu",
          "--disable-gpu-compositing",
          "--disable-gpu-sandbox",
          "--use-angle=swiftshader",
        ],
        {
          cwd: appDirectory,
          encoding: "utf8",
          env: environment,
          maxBuffer: 2 * 1024 * 1024,
          timeout: 90_000,
        },
      );
      return { result, userDataPreexisting };
    };
    const launchOutcome = launch(0);
    const launchResult = launchOutcome.result;
    if (launchResult.error || launchResult.status !== 0) {
      throw new Error(
        [
          `Secondary page smoke case ${testCase.caseId} failed.`,
          launchResult.error?.message,
          launchResult.stdout,
          launchResult.stderr,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }

    const screenshot = await readFile(screenshotPath);
    const screenshotBytes = (await stat(screenshotPath)).size;
    const audit = JSON.parse(await readFile(accessibilityPath, "utf8"));
    const secondary = audit.secondaryPages;
    const assertions = [];
    const assert = (name, pass, actual, expected) => {
      assertions.push({ name, pass, actual, expected });
      if (!pass) {
        throw new Error(
          `${testCase.caseId} ${name} failed: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
        );
      }
    };

    assert(
      "user-data-fresh-start",
      launchOutcome.userDataPreexisting === false,
      launchOutcome.userDataPreexisting,
      false,
    );
    assert(
      "screenshot-not-empty",
      screenshotBytes > 10_000,
      screenshotBytes,
      "> 10000 bytes",
    );
    assert(
      "document-language",
      audit.documentLanguage === testCase.locale,
      audit.documentLanguage,
      testCase.locale,
    );
    assert(
      "document-direction",
      audit.documentDirection === testCase.direction,
      audit.documentDirection,
      testCase.direction,
    );
    assert(
      "zoom-factor",
      audit.zoomFactor === testCase.scale,
      audit.zoomFactor,
      testCase.scale,
    );
    assert(
      "viewport-width",
      Math.abs(audit.windowInnerWidth - testCase.width / testCase.scale) <= 30,
      audit.windowInnerWidth,
      `${testCase.width / testCase.scale} +/- 30`,
    );
    assert(
      "accessibility-issues-empty",
      Array.isArray(audit.issues) && audit.issues.length === 0,
      audit.issues,
      [],
    );
    assert(
      "renderer-console-clean",
      Array.isArray(audit.rendererConsoleEntries) &&
        audit.rendererConsoleEntries.length === 0,
      audit.rendererConsoleEntries,
      [],
    );
    assert(
      "sandboxed-runtime",
      audit.runtimeSecurity?.contextIsolation === true &&
        audit.runtimeSecurity?.nodeIntegration === false &&
        audit.runtimeSecurity?.sandbox === true,
      audit.runtimeSecurity,
      {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    );
    assert(
      "secondary-audit-present",
      secondary?.view === testCase.view,
      secondary?.view,
      testCase.view,
    );
    assert(
      "public-data-surface",
      secondary?.root?.component === "data-surface" &&
        secondary?.root?.role === "region" &&
        typeof secondary?.root?.ariaLabel === "string" &&
        secondary.root.ariaLabel.trim().length > 0 &&
        secondary?.components?.dataSurface === 1,
      secondary?.root,
      "one named public data-surface region",
    );
    assert(
      "no-page-horizontal-overflow",
      secondary?.viewport?.horizontalOverflow === false,
      secondary?.viewport,
      "no document/body horizontal overflow",
    );
    assert(
      "theme-tokens-resolved",
      Boolean(secondary?.theme?.canvas && secondary?.theme?.textPrimary),
      secondary?.theme,
      "non-empty canvas and text tokens",
    );

    if (testCase.pageId === "archive") {
      assert(
        "archive-real-card",
        secondary?.archive?.cardCount === 1 &&
          secondary?.components?.managementCard === 1,
        secondary?.archive,
        "one archived management card",
      );
      assert(
        "archive-public-controls",
        secondary?.archive?.searchPresent === true &&
          secondary?.components?.searchField === 1 &&
          secondary?.components?.button >= 2,
        secondary?.components,
        "public search and restore/delete actions",
      );
    } else if (testCase.pageId === "token-usage") {
      const heatmap = audit.cardHeatmap?.heatmap;
      const histogram = heatmap?.dataLevelHistogram ?? {};
      assert(
        "token-summary-stats",
        audit.cardHeatmap?.summary?.itemCount === 5 &&
          secondary?.components?.dataStat === 5,
        audit.cardHeatmap?.summary,
        "five public data stats",
      );
      assert(
        "token-heatmap-geometry",
        heatmap?.gridRole === "grid" &&
          heatmap?.rowRole === "row" &&
          heatmap?.rowCount === 7 &&
          heatmap?.cellRole === "gridcell" &&
          heatmap?.cellCount >= 365 &&
          heatmap?.cellCount <= 371 &&
          heatmap?.labelledCellCount === heatmap?.cellCount &&
          heatmap?.ownedCellCount === heatmap?.cellCount &&
          heatmap?.contextCellCount === heatmap?.cellCount &&
          heatmap?.tabStopCount === 1,
        heatmap,
        "named 53-week roving grid",
      );
      assert(
        "token-values-beyond-color",
        ["1", "2", "3", "4"].every((level) => Number(histogram[level]) > 0) &&
          heatmap?.distinctCellLabelCount >= 365,
        {
          distinctCellLabelCount: heatmap?.distinctCellLabelCount,
          histogram,
        },
        "levels 1-4 plus distinct per-cell text labels",
      );
      assert(
        "token-focus-tooltip",
        heatmap?.focusTooltipProbe?.focused === true &&
          heatmap?.focusTooltipProbe?.tooltipRolePresent === true &&
          heatmap?.focusTooltipProbe?.cellWithinScrollPort === true &&
          heatmap?.focusTooltipProbe?.tooltipWithinScrollPort === true,
        heatmap?.focusTooltipProbe,
        {
          focused: true,
          tooltipRolePresent: true,
          cellWithinScrollPort: true,
          tooltipWithinScrollPort: true,
        },
      );
    } else {
      assert(
        "automation-real-card",
        secondary?.automations?.cardCount === 1 &&
          secondary?.automations?.statusWithinCard === true &&
          secondary?.components?.managementCard === 1 &&
          secondary?.components?.status === 1,
        secondary?.automations,
        "one public management card with status",
      );
      assert(
        "automation-long-content",
        secondary?.automations?.longName?.includes("deliberately long") ===
          true,
        secondary?.automations?.longName,
        "synthetic long-name fixture",
      );
      assert(
        "automation-public-controls",
        secondary?.automations?.projectFilterPresent === true &&
          secondary?.components?.select === 1 &&
          secondary?.components?.button >= 5,
        secondary?.components,
        "public project filter and actions",
      );
    }

    const serializedAudit = JSON.stringify(audit);
    const leakedPath = [
      appDirectory,
      repositoryRoot,
      temporaryDirectory,
      tmpdir(),
      homedir(),
    ].find((path) => serializedAudit.includes(path));
    assert("no-local-path-leak", leakedPath === undefined, leakedPath, null);
    const unexpectedRunRootEntries = (await readdir(temporaryDirectory))
      .filter((entry) => entry !== "user-data")
      .sort();
    assert(
      "run-root-purity",
      unexpectedRunRootEntries.length === 0,
      unexpectedRunRootEntries,
      [],
    );

    results.push({
      assertions,
      caseId: testCase.caseId,
      direction: testCase.direction,
      locale: testCase.locale,
      page: testCase.pageId,
      rendererSandbox: true,
      scale: testCase.scale,
      screenshot: `${testCase.caseId}.png`,
      screenshotBytes,
      screenshotSha256: createHash("sha256").update(screenshot).digest("hex"),
      theme: testCase.theme,
      view: testCase.view,
      width: testCase.width,
    });
    console.log(
      `PASS ${testCase.caseId} (${assertions.length} assertions, ${screenshotBytes} bytes)`,
    );
  }

  for (const page of pages) {
    const pageResults = results.filter((result) => result.page === page.id);
    if (
      new Set(pageResults.map((result) => result.screenshotSha256)).size !==
      variants.length
    ) {
      throw new Error(`${page.id} matrix screenshots are not all distinct.`);
    }
    const light = pageResults.find(
      (result) => result.caseId === `${page.id}-light-en-wide-100`,
    );
    const dark = pageResults.find(
      (result) => result.caseId === `${page.id}-dark-en-wide-100`,
    );
    if (light?.screenshotSha256 === dark?.screenshotSha256) {
      throw new Error(`${page.id} light and dark screenshots are identical.`);
    }
  }

  const completedHead = runGit(["rev-parse", "HEAD"]);
  const completedStatus = runGit(["status", "--porcelain"]);
  if (completedHead !== candidateHead || completedStatus !== "") {
    throw new Error(
      `Secondary pages source changed during verification: start=${candidateHead} end=${completedHead} status=${JSON.stringify(completedStatus)}.`,
    );
  }
  const totalAssertions = results.reduce(
    (sum, result) => sum + result.assertions.length,
    0,
  );
  const report = {
    format: "artemis-secondary-pages-smoke",
    version: 1,
    generatedAt: new Date().toISOString(),
    candidateHead,
    completedHead,
    expectedHead,
    fixtures: {
      archive:
        "One synthetic archived task and project inside fresh isolated user data.",
      automations:
        "One disabled synthetic review automation with a weekly UTC schedule; it cannot run.",
      tokenUsage:
        "Twenty synthetic assistant.usage events delivered over the real renderer IPC stream; no provider call.",
    },
    matrix: variants,
    summary: {
      assertions: totalAssertions,
      cases: results.length,
      failed: 0,
      passed: results.length,
    },
    results,
  };
  const reportPath = join(outputDirectory, "report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(
    `Secondary pages smoke passed: ${results.length} cases, ${totalAssertions} assertions.`,
  );
  console.log(reportPath);
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true });
}
