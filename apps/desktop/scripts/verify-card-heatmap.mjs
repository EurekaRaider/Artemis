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
  positionalArguments[0] ?? join(repositoryRoot, "artifacts", "card-heatmap"),
);
const electronPath = createRequire(import.meta.url)("electron");
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "artemis-card-heatmap-"),
);
const windowWidth = 1_440;
const locale = "en";

// One case drives the Token Usage page (checklist §2.4 entry chain) to its
// visible state with the main-process synthetic assistant.usage sequence
// (checklist §6-1 option a): the events ride the real renderer agent-event
// IPC channel with backdated timestamps, so the 53-week grid renders a
// genuine data-level distribution from the real data chain. Every identity
// is synthetic (reserved ids, one fake provider/model) and the seed
// performs zero dial-out.
const steps = [
  {
    id: "card-heatmap",
    view: "card-heatmap",
    scenario:
      "Token Usage page summary strip (5 stat items) and 53-week activity heatmap with seeded usage events across intensity levels 1-4.",
  },
];
const themes = ["light", "dark"];
const cases = steps.flatMap((step) =>
  themes.map((theme) => ({ ...step, theme, caseId: `${step.id}-${theme}` })),
);

// The visible grid spans firstVisibleDate (startOfWeek(today) - 52 weeks)
// through today, so the cell count is 365-371 depending on the weekday the
// run lands on (53 week columns; the current week is partial).
const minimumCellCount = 365;
const maximumCellCount = 371;

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
    // Electron user data (Cache, Local Storage, artemis.sqlite) lives in a
    // dedicated user-data subtree with one fresh directory per case x
    // attempt, never directly at the throwaway run root's case level.
    const caseUserDataDirectory = (attempt) =>
      join(
        temporaryDirectory,
        "user-data",
        "card-heatmap",
        `${caseId}-attempt-${attempt}`,
      );
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
          `Card heatmap smoke case ${caseId} failed.`,
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
    const cardHeatmap = audit.cardHeatmap;
    const assertions = [];
    const assert = (name, pass, actual, expected) => {
      const record = { name, pass, actual, expected };
      assertions.push(record);
      return record;
    };
    // Isolation gates follow the #117 standard: the winning launch started
    // from a user-data directory that did not exist yet, the throwaway run
    // root only ever holds the user-data subtree, and no captured audit
    // data leaks a local path from this machine.
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
        "card-heatmap-audit-present",
        cardHeatmap?.view === view,
        cardHeatmap?.view ?? null,
        view,
      ).pass
    ) {
      throw new Error(`${caseId} did not expose cardHeatmap audit data.`);
    }
    // Summary strip sanity (both modes): the five summary items render with
    // non-zero values from the seeded usage chain.
    const summary = cardHeatmap.summary;
    if (
      !assert(
        "summary-present",
        summary?.present === true,
        summary?.present ?? null,
        true,
      ).pass
    ) {
      throw new Error(`${caseId} summary strip was not rendered.`);
    }
    if (
      !assert(
        "summary-item-count",
        summary?.itemCount === 5,
        summary?.itemCount ?? null,
        5,
      ).pass
    ) {
      throw new Error(`${caseId} summary strip does not render 5 items.`);
    }
    const summaryItems = summary?.items ?? [];
    const zeroedValues = summaryItems.filter(
      (item) => !item.value || /^(0|0K|0\.0K)$/u.test(item.value.trim()),
    );
    if (
      !assert(
        "summary-values-non-zero",
        summaryItems.length === 5 && zeroedValues.length === 0,
        summaryItems.map((item) => item.value),
        "5 non-zero values",
      ).pass
    ) {
      throw new Error(
        `${caseId} summary values are zero or missing: ${JSON.stringify(summaryItems)}.`,
      );
    }
    // Heatmap sanity (both modes): the grid spans the 53-week window, the
    // cells are gridcells, and the seeded data produces a data-level
    // histogram that covers levels 1-4 (real data proof, hard constraint 3).
    const heatmap = cardHeatmap.heatmap;
    if (
      !assert(
        "heatmap-grid-present",
        heatmap?.gridPresent === true,
        heatmap?.gridPresent ?? null,
        true,
      ).pass
    ) {
      throw new Error(`${caseId} heatmap grid was not rendered.`);
    }
    if (
      !assert(
        "heatmap-grid-role",
        heatmap?.gridRole === "grid",
        heatmap?.gridRole ?? null,
        "grid",
      ).pass
    ) {
      throw new Error(`${caseId} heatmap grid lost role="grid".`);
    }
    if (
      !assert(
        "heatmap-cell-count",
        typeof heatmap?.cellCount === "number" &&
          heatmap.cellCount >= minimumCellCount &&
          heatmap.cellCount <= maximumCellCount,
        heatmap?.cellCount ?? null,
        `${minimumCellCount}-${maximumCellCount} (53-week window)`,
      ).pass
    ) {
      throw new Error(
        `${caseId} heatmap cell count is outside the 53-week window: ${heatmap?.cellCount}.`,
      );
    }
    if (
      !assert(
        "heatmap-cell-role",
        heatmap?.cellRole === "gridcell",
        heatmap?.cellRole ?? null,
        "gridcell",
      ).pass
    ) {
      throw new Error(`${caseId} heatmap cells lost role="gridcell".`);
    }
    const histogram = heatmap?.dataLevelHistogram ?? {};
    const missingLevels = ["1", "2", "3", "4"].filter(
      (level) => !(Number(histogram[level]) > 0),
    );
    if (
      !assert(
        "heatmap-data-level-distribution",
        missingLevels.length === 0,
        histogram,
        "levels 1-4 all present",
      ).pass
    ) {
      throw new Error(
        `${caseId} heatmap data-level histogram does not cover levels 1-4: ${JSON.stringify(histogram)}.`,
      );
    }
    if (
      !assert(
        "heatmap-month-labels",
        typeof heatmap?.monthLabelCount === "number" &&
          heatmap.monthLabelCount >= 12,
        heatmap?.monthLabelCount ?? null,
        ">= 12",
      ).pass
    ) {
      throw new Error(
        `${caseId} heatmap month label row is missing or too short.`,
      );
    }
    let knownGaps = [];
    if (mode === "before") {
      // Checklist §2.2: the grid container itself carries no aria-label at
      // the pre-extraction baseline. Record it as a known gap instead of
      // failing so the capture stays an honest baseline.
      knownGaps.push({
        gap: "grid-container-aria-label",
        measured: heatmap?.gridAriaLabel ?? null,
        note: "TokenUsagePage.tsx renders role=grid without a container aria-label at baseline (checklist §2.2); the component extraction must add it (checklist §6).",
      });
      if (
        !assert(
          "grid-aria-label-known-gap",
          heatmap?.gridAriaLabel === null,
          heatmap?.gridAriaLabel ?? null,
          null,
        ).pass
      ) {
        knownGaps = knownGaps.filter(
          (entry) => entry.gap !== "grid-container-aria-label",
        );
        knownGaps.push({
          gap: "grid-container-aria-label",
          measured: heatmap?.gridAriaLabel ?? null,
          note: "Expected null at baseline but measured a value; update the before expectations.",
        });
      }
    } else {
      // Checklist §6 assertions for the extracted component contract.
      if (
        !assert(
          "grid-container-aria-label",
          typeof heatmap?.gridAriaLabel === "string" &&
            heatmap.gridAriaLabel.trim().length > 0,
          heatmap?.gridAriaLabel ?? null,
          "non-empty string",
        ).pass
      ) {
        throw new Error(
          `${caseId} heatmap grid container has no aria-label (checklist §6 / v17 12d contract).`,
        );
      }
      if (
        !assert(
          "months-aria-hidden",
          heatmap?.monthContainerAriaHidden === "true",
          heatmap?.monthContainerAriaHidden ?? null,
          "true",
        ).pass
      ) {
        throw new Error(
          `${caseId} heatmap month labels must stay aria-hidden decoration.`,
        );
      }
      const probe = heatmap?.focusTooltipProbe ?? null;
      if (
        !assert(
          "focus-tooltip-visible",
          probe?.focused === true && probe?.tooltipRolePresent === true,
          probe,
          { focused: true, tooltipRolePresent: true },
        ).pass
      ) {
        throw new Error(
          `${caseId} focusing a heatmap cell did not expose its tooltip (checklist §6).`,
        );
      }
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
      measured: {
        summary,
        heatmap,
      },
      knownGaps,
    });
    console.log(
      `PASS ${caseId} (${assertions.length} assertions, screenshot ${screenshotBytes} bytes)`,
    );
  }
  const totalAssertions = results.reduce(
    (sum, result) => sum + result.assertions.length,
    0,
  );
  const auditReport = {
    format: "artemis-card-heatmap-smoke",
    version: 1,
    mode,
    generatedAt: new Date().toISOString(),
    locale,
    windowWidth,
    fixtures: {
      syntheticUsageEvents: {
        channel: "IPC.agentEvent (the real renderer agent-event stream)",
        identity: {
          providerId: "artemis-smoke",
          modelId: "card-heatmap-probe",
          threadId: "artemis-smoke-card-heatmap-thread",
        },
        note: "Main-process smoke branch emits 20 synthetic assistant.usage events with backdated calendar-exact local-noon timestamps (0-350 days ago) over the live agent-event IPC channel; nothing is persisted and no provider or endpoint is dialed (zero network activity).",
      },
    },
    userDataIsolation: {
      directory:
        "user-data/card-heatmap/<caseId>-attempt-<attempt> under the throwaway run root",
      note: "Electron user data never sits directly at the run-root case level; every case x attempt launch gets its own fresh directory (user-data-fresh-start), run-root-purity proves the run root only ever holds the user-data subtree, and no-local-path-leak scans the whole audit payload for this machine's paths.",
    },
    summary: {
      mode,
      cases: results.length,
      passed: results.length,
      failed: 0,
      assertions: totalAssertions,
      knownGaps: results.flatMap((result) => result.knownGaps).length,
    },
    results,
  };
  const auditPath = join(outputDirectory, `${mode}-baseline.json`);
  await writeFile(
    auditPath,
    `${JSON.stringify(auditReport, null, 2)}\n`,
    "utf8",
  );
  console.log(
    `Card heatmap smoke (${mode}) passed: ${results.length} cases, ${totalAssertions} assertions.`,
  );
  console.log(auditPath);
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true });
}
