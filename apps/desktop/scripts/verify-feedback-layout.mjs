import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
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
const outputDirectory = resolve(
  process.argv.slice(2).find((argument) => !argument.startsWith("--")) ??
    join(repositoryRoot, "artifacts", "feedback-layout"),
);
const electronPath = createRequire(import.meta.url)("electron");
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "artemis-feedback-layout-"),
);

function runGit(arguments_) {
  const result = spawnSync("git", arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Feedback/layout verifier could not run git ${arguments_.join(" ")}: ${result.error?.message ?? result.stderr}`,
    );
  }
  return result.stdout.trim();
}

const candidateHead = runGit(["rev-parse", "HEAD"]);
const expectedHead = process.env.ARTEMIS_EXPECTED_HEAD?.trim() || candidateHead;
if (!/^[0-9a-f]{40}$/u.test(candidateHead) || expectedHead !== candidateHead) {
  throw new Error(
    `Feedback/layout expected HEAD ${expectedHead} does not match candidate ${candidateHead}.`,
  );
}
const initialStatus = runGit(["status", "--porcelain"]);
if (initialStatus !== "") {
  throw new Error(
    `Feedback/layout verification requires a clean exact-head worktree:\n${initialStatus}`,
  );
}

const cases = [
  {
    caseId: "settings-dialog-light",
    component: "dialog",
    context: "settings",
    direction: "ltr",
    expectedParts: ["root", "content"],
    portal: true,
    reducedMotion: false,
    scale: 1,
    theme: "light",
    view: "feedback-layout-settings",
    width: 1_440,
  },
  {
    caseId: "settings-dialog-dark-rtl-200",
    component: "dialog",
    context: "settings",
    direction: "rtl",
    expectedParts: ["root", "content"],
    portal: true,
    reducedMotion: true,
    scale: 2,
    theme: "dark",
    view: "feedback-layout-settings",
    width: 1_100,
  },
  {
    caseId: "environment-popover-light-rtl-200",
    component: "popover",
    context: "environment",
    direction: "rtl",
    expectedParts: ["root", "content"],
    portal: true,
    reducedMotion: true,
    scale: 2,
    theme: "light",
    view: "environment-pr-checks",
    width: 1_100,
  },
  {
    caseId: "approval-panel-dark-rtl-200",
    component: "approval-card",
    context: "approval",
    direction: "rtl",
    expectedParts: [
      "root",
      "header",
      "icon",
      "heading",
      "title",
      "description",
      "status",
      "actions",
    ],
    portal: false,
    reducedMotion: true,
    scale: 2,
    theme: "dark",
    view: "environment-feedback-approval",
    width: 1_100,
  },
  {
    caseId: "resource-empty-light-narrow",
    component: "empty-state",
    context: "resource",
    direction: "ltr",
    expectedParts: ["root", "title"],
    portal: false,
    reducedMotion: false,
    scale: 1,
    theme: "light",
    view: "mcp-search-empty",
    width: 1_100,
  },
  {
    caseId: "resource-loading-dark-200",
    component: "loading-state",
    context: "resource",
    direction: "ltr",
    expectedParts: ["root", "label", "skeleton"],
    portal: false,
    reducedMotion: true,
    scale: 2,
    theme: "dark",
    view: "mcp-search-loading",
    width: 1_100,
  },
];

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
    const userDataDirectory = join(
      temporaryDirectory,
      "user-data",
      testCase.caseId,
    );
    const userDataPreexisting = existsSync(userDataDirectory);
    const environment = {
      ...process.env,
      ARTEMIS_SMOKE_ACCESSIBILITY: accessibilityPath,
      ARTEMIS_SMOKE_DIRECTION: testCase.direction,
      ARTEMIS_SMOKE_LOCALE: "en",
      ARTEMIS_SMOKE_SCALE: String(testCase.scale),
      ARTEMIS_SMOKE_SCREENSHOT: screenshotPath,
      ARTEMIS_SMOKE_SETTLE_DELAY: "600",
      ARTEMIS_SMOKE_THEME: testCase.theme,
      ARTEMIS_SMOKE_VIEW: testCase.view,
      ARTEMIS_SMOKE_WINDOW_WIDTH: String(testCase.width),
    };
    delete environment.ARTEMIS_DEV_SERVER_URL;
    delete environment.ELECTRON_RUN_AS_NODE;
    const electronArguments = [
      appDirectory,
      `--user-data-dir=${userDataDirectory}`,
      "--disable-gpu",
      "--disable-gpu-compositing",
      "--disable-gpu-sandbox",
      "--use-angle=swiftshader",
      ...(testCase.reducedMotion
        ? ["--force-prefers-reduced-motion"]
        : ["--force-prefers-no-reduced-motion"]),
    ];
    const launchResult = spawnSync(electronPath, electronArguments, {
      cwd: appDirectory,
      encoding: "utf8",
      env: environment,
      maxBuffer: 2 * 1024 * 1024,
      timeout: 90_000,
    });
    if (launchResult.error || launchResult.status !== 0) {
      throw new Error(
        [
          `Feedback/layout smoke case ${testCase.caseId} failed.`,
          `status=${String(launchResult.status)} signal=${String(launchResult.signal)}`,
          launchResult.error?.message,
          launchResult.stdout,
          launchResult.stderr,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }

    const audit = JSON.parse(await readFile(accessibilityPath, "utf8"));
    const screenshotBytes = (await stat(screenshotPath)).size;
    const feedbackLayout = audit.feedbackLayout;
    const assertions = [];
    const assert = (name, pass, actual, expected) => {
      const assertion = { name, pass, actual, expected };
      assertions.push(assertion);
      if (!pass) {
        throw new Error(
          `${testCase.caseId} assertion failed: ${name}; actual ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}.`,
        );
      }
    };

    assert(
      "user-data-fresh-start",
      !userDataPreexisting,
      userDataPreexisting,
      false,
    );
    assert(
      "renderer-sandbox-launch-flag",
      !electronArguments.includes("--no-sandbox"),
      electronArguments,
      "no --no-sandbox",
    );
    assert(
      "screenshot-not-empty",
      screenshotBytes > 10_000,
      screenshotBytes,
      "> 10000 bytes",
    );
    assert(
      "document-identity",
      audit.title === "Artemis" && audit.documentLanguage === "en",
      { title: audit.title, language: audit.documentLanguage },
      { title: "Artemis", language: "en" },
    );
    assert(
      "audit-issues-empty",
      Array.isArray(audit.issues) && audit.issues.length === 0,
      audit.issues,
      [],
    );
    assert(
      "renderer-runtime-security",
      audit.runtimeSecurity?.sandbox === true &&
        audit.runtimeSecurity?.contextIsolation === true &&
        audit.runtimeSecurity?.nodeIntegration === false,
      audit.runtimeSecurity ?? null,
      { sandbox: true, contextIsolation: true, nodeIntegration: false },
    );
    assert(
      "renderer-console-clean",
      Array.isArray(audit.rendererConsoleEntries) &&
        audit.rendererConsoleEntries.length === 0,
      audit.rendererConsoleEntries ?? null,
      [],
    );
    const serializedAudit = JSON.stringify(audit);
    const leakedMarker = [
      appDirectory,
      repositoryRoot,
      temporaryDirectory,
      tmpdir(),
      homedir(),
    ]
      .filter(Boolean)
      .find((marker) => serializedAudit.includes(marker));
    assert(
      "no-local-path-leak",
      leakedMarker === undefined,
      leakedMarker ?? null,
      null,
    );
    assert(
      "requested-zoom-applied",
      audit.zoomFactor === testCase.scale,
      audit.zoomFactor,
      testCase.scale,
    );
    assert(
      "direction-applied",
      feedbackLayout?.direction === testCase.direction,
      feedbackLayout?.direction,
      testCase.direction,
    );
    assert(
      "reduced-motion-applied",
      feedbackLayout?.reducedMotion === testCase.reducedMotion,
      feedbackLayout?.reducedMotion,
      testCase.reducedMotion,
    );
    assert(
      "semantic-overlay-tokens-resolve",
      Boolean(feedbackLayout?.rootTokens?.overlayScrim) &&
        Boolean(feedbackLayout?.rootTokens?.shadowOverlay) &&
        Boolean(feedbackLayout?.rootTokens?.surfaceRaised),
      feedbackLayout?.rootTokens ?? null,
      "non-empty semantic overlay tokens",
    );
    const found = feedbackLayout?.components?.find(
      (candidate) =>
        candidate.component === testCase.component &&
        candidate.context === testCase.context,
    );
    assert("expected-consumer-present", Boolean(found), found ?? null, {
      component: testCase.component,
      context: testCase.context,
    });
    assert(
      "required-anatomy",
      testCase.expectedParts.every((part) => found.parts.includes(part)),
      found.parts,
      testCase.expectedParts,
    );
    assert(
      "positive-geometry",
      found.geometry.width > 0 && found.geometry.height > 0,
      found.geometry,
      "positive width and height",
    );
    assert(
      "within-viewport",
      found.withinViewport === true,
      found.geometry,
      "inside viewport",
    );
    assert(
      "inline-content-not-cropped",
      found.contentFitsInline === true,
      found,
      true,
    );
    assert(
      "semantic-styles-resolve",
      Boolean(found.computed?.backgroundColor) &&
        Boolean(found.computed?.color),
      found.computed,
      "resolved background and text colors",
    );
    assert(
      "portal-contract",
      found.portalRoot === (testCase.portal ? true : null),
      found.portalRoot,
      testCase.portal ? true : null,
    );
    if (testCase.component === "dialog") {
      assert(
        "native-modal-open",
        found.nativeDialogOpen === true,
        found.nativeDialogOpen,
        true,
      );
      assert(
        "dialog-focus-inside",
        found.focusInside === true,
        found.focusInside,
        true,
      );
      assert(
        "dialog-close-return-reopen",
        feedbackLayout.interaction?.firstOpenFocusInside === true &&
          feedbackLayout.interaction?.focusReturned === true &&
          feedbackLayout.interaction?.reopened === true &&
          feedbackLayout.interaction?.nativeModal === true,
        feedbackLayout.interaction,
        "focus entry, return, and native reopen",
      );
    }
    if (testCase.component === "popover") {
      assert(
        "popover-focus-or-trigger-owned",
        found.focusInside === true,
        found.focusInside,
        true,
      );
    }

    results.push({
      assertions,
      caseId: testCase.caseId,
      candidateHead,
      component: testCase.component,
      context: testCase.context,
      direction: testCase.direction,
      reducedMotion: testCase.reducedMotion,
      scale: testCase.scale,
      screenshotBytes,
      theme: testCase.theme,
      view: testCase.view,
    });
  }

  if (runGit(["rev-parse", "HEAD"]) !== candidateHead) {
    throw new Error(
      "Feedback/layout candidate HEAD changed during verification.",
    );
  }
  const finalStatus = runGit(["status", "--porcelain"]);
  if (finalStatus !== "") {
    throw new Error(
      `Feedback/layout worktree changed during verification:\n${finalStatus}`,
    );
  }
  const report = {
    assertionCount: results.reduce(
      (total, result) => total + result.assertions.length,
      0,
    ),
    candidateHead,
    caseCount: results.length,
    expectedHead,
    generatedAt: new Date().toISOString(),
    results,
    schemaVersion: 1,
  };
  await writeFile(
    join(outputDirectory, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  console.log(
    `Feedback/layout exact-head Electron verification passed (${report.caseCount} cases; ${report.assertionCount} assertions; ${candidateHead}).`,
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
