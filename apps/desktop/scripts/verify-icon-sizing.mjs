import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(appDirectory, "..", "..");
const arguments_ = process.argv.slice(2);
const mode = arguments_.includes("--before") ? "before" : "after";
const positionalArguments = arguments_.filter(
  (argument) => !argument.startsWith("--"),
);
const outputDirectory = resolve(
  positionalArguments[0] ?? join(repositoryRoot, "artifacts", "icon-sizing"),
);
const electronPath = createRequire(import.meta.url)("electron");
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "artemis-icon-sizing-"),
);
const windowWidth = 1_440;
const locale = "en";
const seededServerName = "Artemis Smoke Icon Sizing";

// Each case drives one icon-sizing surface list from checklist §2.2 to its
// visible state, then the harness captures one screenshot and the shared
// accessibility audit (which carries the getBoundingClientRect measurements
// for every target). Every identity is synthetic: the git repository fixture
// lives inside the isolated user-data directory, the seeded MCP server uses
// a stdio command path that cannot exist with enabled:false (zero spawn,
// zero dial-out), and the add-plugin page renders only static offline cards.
const steps = [
  {
    id: "environment",
    view: "icon-sizing-environment",
    scenario:
      "Environment panel rows: project row icon, header add action, chevron, external.",
  },
  {
    id: "environment-branch-menu",
    view: "icon-sizing-environment-branch-menu",
    scenario:
      "Branch popover opened from the branch row: branch search, current-branch check, branch actions add (plus the base rows).",
  },
  {
    id: "environment-commit",
    view: "icon-sizing-environment-commit",
    scenario:
      "Commit dialog opened from the commit-or-push row: git destination trigger chevron.",
  },
  {
    id: "resource-manage",
    view: "icon-sizing-resource-manage",
    scenario:
      "Resource Center manage view on the MCP tab with the discovery panel open: seeded row avatar semantic icon, discovery search field icon, avatar fallback css-probe.",
  },
  {
    id: "add-plugin",
    view: "icon-sizing-add-plugin",
    scenario:
      "Add-plugin page from the marketplace header: offline marketplace card button icon.",
  },
];
const themes = ["light", "dark"];
const cases = steps.flatMap((step) =>
  themes.map((theme) => ({ ...step, theme, caseId: `${step.id}-${theme}` })),
);

// Targets each view must render (sanity gates in both modes). The shared
// audit measures every target; only the required ones gate the run.
const requiredTargetsByView = {
  "icon-sizing-environment": [
    "environment-row-icon",
    "environment-header-action",
    "environment-chevron",
    "environment-external",
  ],
  "icon-sizing-environment-branch-menu": [
    "environment-row-icon",
    "environment-header-action",
    "environment-chevron",
    "environment-branch-search",
    "environment-branch-list-check",
    "environment-branch-actions",
  ],
  "icon-sizing-environment-commit": ["environment-git-destination-chevron"],
  "icon-sizing-resource-manage": [
    "resource-avatar-semantic",
    "resource-discovery-search",
    "resource-avatar-fallback",
  ],
  "icon-sizing-add-plugin": ["resource-add-plugin-card"],
};

// Current pixel values from checklist §2.2 (baseline 9bd4d16). The before
// mode records measured-vs-expected deviations without failing so the token
// migration always starts from an honest baseline capture.
const baselineExpectations = {
  "environment-row-icon": 18,
  "environment-header-action": 18,
  "environment-chevron": 16,
  "environment-external": 16,
  "environment-branch-search": 14,
  "environment-branch-list-check": 16,
  "environment-branch-actions": 18,
  "environment-git-destination-chevron": 20,
  "resource-avatar-semantic": 22,
  "resource-avatar-fallback": 20,
  "resource-search-field": 17,
  "resource-discovery-search": 17,
  "resource-add-plugin-card": 17,
};

// Tier values from checklist §2.4 (xs=12 sm=14 base=16 lg=20 xl=24) that the
// after mode asserts once the token migration lands.
const tierExpectations = {
  "environment-row-icon": 20,
  "environment-header-action": 20,
  "environment-chevron": 16,
  "environment-external": 16,
  "environment-branch-search": 14,
  "environment-branch-list-check": 16,
  "environment-branch-actions": 20,
  "environment-git-destination-chevron": 20,
  "resource-avatar-semantic": 24,
  "resource-avatar-fallback": 20,
  "resource-search-field": 16,
  "resource-discovery-search": 16,
  "resource-add-plugin-card": 16,
};

const results = [];
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
      ARTEMIS_SMOKE_SETTLE_DELAY: "500",
      ARTEMIS_SMOKE_THEME: theme,
      ARTEMIS_SMOKE_VIEW: view,
      ARTEMIS_SMOKE_WINDOW_WIDTH: String(windowWidth),
    };
    // Never inherit a live dev server: the smoke must exercise the built
    // production renderer from this checkout, not whatever serves 127.0.0.1.
    delete environment.ELECTRON_RUN_AS_NODE;
    delete environment.ARTEMIS_DEV_SERVER_URL;
    // Electron user data (Cache, Local Storage, artemis.sqlite, mcp.json and
    // the git repository fixture) lives in a dedicated user-data subtree with
    // one fresh directory per case x attempt, never directly at the
    // throwaway run root's case level.
    const caseUserDataDirectory = (attempt) =>
      join(temporaryDirectory, "user-data", `${caseId}-attempt-${attempt}`);
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
          timeout: 90_000,
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
    if (
      (launchOutcome.result.error || launchOutcome.result.status !== 0) &&
      !process.env.CI
    ) {
      launchOutcome = launch(false, 2);
    }
    const launchResult = launchOutcome.result;
    if (launchResult.error || launchResult.status !== 0) {
      throw new Error(
        [
          `Icon sizing smoke case ${caseId} failed.`,
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
    const iconSizing = audit.iconSizing;
    const assertions = [];
    const assert = (name, pass, actual, expected) => {
      const record = { name, pass, actual, expected };
      assertions.push(record);
      return record;
    };
    // Isolation gates follow the #117 standard: the winning launch started
    // from a user-data directory that did not exist yet, the throwaway run
    // root only ever holds the user-data subtree, and no captured audit data
    // leaks a local path from this machine.
    if (
      !assert(
        "user-data-fresh-start",
        launchOutcome.userDataPreexisting === false,
        launchOutcome.userDataPreexisting,
        false,
      ).pass
    ) {
      throw new Error(
        `${caseId} user-data directory already existed before launch; another case or attempt left residue behind.`,
      );
    }
    const unexpectedRunRootEntries = (await readdir(temporaryDirectory))
      .sort()
      .filter((entry) => entry !== "user-data");
    if (
      !assert(
        "run-root-purity",
        unexpectedRunRootEntries.length === 0,
        unexpectedRunRootEntries,
        [],
      ).pass
    ) {
      throw new Error(
        `${caseId} run root is not pure: unexpected top-level entries ${JSON.stringify(
          unexpectedRunRootEntries,
        )}. Electron user data must stay inside the user-data subtree.`,
      );
    }
    if (
      !assert(
        "screenshot-not-empty",
        screenshotBytes > 10_000,
        screenshotBytes,
        "> 10000 bytes",
      ).pass
    ) {
      throw new Error(`${caseId} screenshot is unexpectedly small.`);
    }
    if (
      !assert(
        "window-width-applied",
        typeof audit.windowInnerWidth === "number" &&
          audit.windowInnerWidth >= 1_400,
        audit.windowInnerWidth,
        ">= 1400",
      ).pass
    ) {
      throw new Error(`${caseId} window width was not applied.`);
    }
    if (
      !assert(
        "audit-issues-empty",
        Array.isArray(audit.issues) && audit.issues.length === 0,
        audit.issues,
        [],
      ).pass
    ) {
      throw new Error(
        `${caseId} accessibility audit failed: ${JSON.stringify(audit.issues)}`,
      );
    }
    const serializedAudit = JSON.stringify(audit);
    const localPathMarkers = [
      appDirectory,
      repositoryRoot,
      temporaryDirectory,
      tmpdir(),
      homedir(),
    ].filter(Boolean);
    const leakedMarker = localPathMarkers.find((marker) =>
      serializedAudit.includes(marker),
    );
    if (
      !assert(
        "no-local-path-leak",
        leakedMarker === undefined,
        leakedMarker ?? null,
        null,
      ).pass
    ) {
      throw new Error(
        `${caseId} audit data leaked a local path: ${leakedMarker}.`,
      );
    }
    if (
      !assert(
        "icon-sizing-audit-present",
        iconSizing?.view === view && iconSizing.targets !== undefined,
        iconSizing?.view ?? null,
        view,
      ).pass
    ) {
      throw new Error(`${caseId} did not expose iconSizing audit data.`);
    }
    const targets = iconSizing.targets;
    const measured = {};
    const deviations = [];
    for (const targetName of requiredTargetsByView[view] ?? []) {
      const target = targets[targetName];
      const rectWidth = target?.sample?.rectWidth ?? null;
      const rectHeight = target?.sample?.rectHeight ?? null;
      measured[targetName] = {
        selector: target?.selector ?? null,
        count: target?.count ?? 0,
        sample: target?.sample ?? null,
      };
      if (
        !assert(
          `${targetName}-present`,
          target?.count > 0 && rectWidth !== null,
          { count: target?.count ?? 0, rectWidth },
          "count > 0",
        ).pass
      ) {
        throw new Error(
          `${caseId} target ${targetName} was not rendered (${target?.selector ?? "unknown selector"}).`,
        );
      }
      if (
        !assert(
          `${targetName}-positive-size`,
          rectWidth > 0 && rectHeight > 0,
          { rectWidth, rectHeight },
          "> 0",
        ).pass
      ) {
        throw new Error(
          `${caseId} target ${targetName} measured a non-positive size.`,
        );
      }
      if (mode === "before") {
        const expected = baselineExpectations[targetName];
        if (rectWidth !== expected || rectHeight !== expected) {
          deviations.push({
            target: targetName,
            measured: { rectWidth, rectHeight },
            checklistCurrent: expected,
          });
        }
      } else {
        const expected = tierExpectations[targetName];
        if (
          !assert(
            `${targetName}-tier-size`,
            rectWidth === expected && rectHeight === expected,
            { rectWidth, rectHeight },
            expected,
          ).pass
        ) {
          throw new Error(
            `${caseId} target ${targetName} is not at tier size ${expected}: ${JSON.stringify(
              { rectWidth, rectHeight },
            )}.`,
          );
        }
      }
    }
    // Record non-required targets too so the JSON captures every measured
    // surface for the before/after comparison evidence.
    for (const [targetName, target] of Object.entries(targets)) {
      if (measured[targetName]) continue;
      measured[targetName] = {
        selector: target?.selector ?? null,
        count: target?.count ?? 0,
        sample: target?.sample ?? null,
      };
    }
    const failed = assertions.filter((assertion) => !assertion.pass);
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
      assertions,
      measured,
      deviations,
    });
    console.log(
      `PASS ${caseId} (${assertions.length} assertions, screenshot ${screenshotBytes} bytes${
        deviations.length ? `, ${deviations.length} baseline deviations` : ""
      })`,
    );
  }
  const totalAssertions = results.reduce(
    (sum, result) => sum + result.assertions.length,
    0,
  );
  const allDeviations = results.flatMap((result) =>
    result.deviations.map((deviation) => ({
      case: `${result.id}-${result.theme}`,
      ...deviation,
    })),
  );
  const auditReport = {
    format: "artemis-icon-sizing-smoke",
    version: 1,
    mode,
    generatedAt: new Date().toISOString(),
    locale,
    windowWidth,
    expectedSizes: mode === "before" ? baselineExpectations : tierExpectations,
    fixtures: {
      seededMcpServer: {
        id: "artemis-smoke-icon-sizing",
        name: seededServerName,
        transport: "stdio",
        command: "/artemis-smoke-icon-sizing/stdio-server",
        enabled: false,
        note: "Synthetic identity only: the command path cannot exist and enabled stays false, so the seeded row performs zero spawn and zero dial-out at startup (mcp-editor seed precedent).",
      },
      gitRepository: {
        location:
          "user-data fixtures/environment-repository inside the isolated user-data directory",
        note: "Reuses the environment smoke fixture: real git branches and a dirty working tree, created and read entirely inside the throwaway user-data subtree.",
      },
      avatarFallbackProbe: {
        note: "No current consumer renders a bare svg inside .resource-avatar, so the fallback rule is measured with a temporary css-probe element instead of the UI.",
      },
    },
    userDataIsolation: {
      directory:
        "user-data/<caseId>-attempt-<attempt> under the throwaway run root",
      note: "Electron user data (including the seeded mcp.json store and the git fixture) never sits directly at the run-root case level; every case x attempt launch gets its own fresh directory (user-data-fresh-start), run-root-purity proves the run root only ever holds the user-data subtree, and no-local-path-leak scans the whole audit payload for this machine's paths.",
    },
    summary: {
      mode,
      cases: results.length,
      passed: results.length,
      failed: 0,
      assertions: totalAssertions,
      baselineDeviations: allDeviations.length,
    },
    baselineDeviations: allDeviations,
    results,
  };
  const auditPath = join(outputDirectory, `${mode}-baseline.json`);
  await writeFile(
    auditPath,
    `${JSON.stringify(auditReport, null, 2)}\n`,
    "utf8",
  );
  console.log(
    `Icon sizing smoke (${mode}) passed: ${results.length} cases, ${totalAssertions} assertions${
      allDeviations.length
        ? `, ${allDeviations.length} baseline deviations recorded`
        : ""
    }.`,
  );
  console.log(auditPath);
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true });
}
