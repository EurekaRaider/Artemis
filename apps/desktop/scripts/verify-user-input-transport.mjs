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
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(appDirectory, "..", "..");
const positionalArguments = process.argv
  .slice(2)
  .filter((argument) => !argument.startsWith("--"));
const outputDirectory = resolve(
  positionalArguments[0] ??
    join(repositoryRoot, "artifacts", "user-input-transport"),
);
const electronPath = createRequire(import.meta.url)("electron");
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "artemis-user-input-transport-"),
);
const windowWidth = 1_440;
const locale = "en";

// PR10B keeps the request_user_input producer dormant (single-question tool
// parameters only), so the only legal smoke driver is the direct
// broker-request path: the Electron main process injects synthetic legacy
// and multi-question requests through the real handlers, drives the
// per-question timeout arm via the timer's own resolution function, and
// drives cancellation through the real thread-cancel path.
const steps = [
  {
    id: "user-input-transport",
    view: "user-input-transport",
    scenario:
      "Transport contract with a dormant producer: injected single- and multi-question broker requests persist replayable events, never auto-answer before the timeout window, time out per question with the recommended label, reject duplicate injection and duplicate resolution, settle one aggregated broker backfill per card, close every pending question on thread cancellation with an approved:false receipt, and keep the legacy card path intact while the agent-host tool stays single-question.",
  },
];
const themes = ["light", "dark"];
const cases = steps.flatMap((step) =>
  themes.map((theme) => ({ ...step, theme, caseId: `${step.id}-${theme}` })),
);

// Checklist §6: the six transport guarantees and the named main-process
// checks that prove each one inside a single Electron launch.
const checkGroups = {
  noLostEvents: [
    "multi-request-persisted",
    "multi-request-frozen-kind",
    "multi-request-three-questions",
    "multi-request-per-question-expiry",
    "multi-card-translated-pending",
    "multi-card-projects-first-pending-question",
  ],
  noAutoAnswer: [
    "no-resolution-before-timeout-window",
    "cards-still-pending-without-user-action",
    "multi-registry-still-pending",
    "no-broker-resolve-before-final-answer",
    "timeout-resolves-exactly-first-expired-question",
    "timeout-answer-is-recommended-label",
    "timeout-no-broker-resolve-before-final",
    "timeout-card-still-pending-after-partial-timeout",
    "timeout-card-projects-next-pending-question",
    "expired-request-card-pending",
    "mixed-expiry-all-questions-resolved",
    "mixed-expiry-final-broker-backfill",
    "mixed-expiry-card-settles-timed-out",
  ],
  noInfiniteWait: [
    "cancel-emits-one-kind-less-cancelled",
    "cancel-broker-resolve-rejected",
    "cancel-registry-drained",
    "cancel-closes-card-in-renderer",
  ],
  duplicateSafety: [
    "duplicate-question-resolution-rejected",
    "duplicate-resolution-single-side-effect",
    "duplicate-injection-rejected",
    "duplicate-injection-single-requested-event",
  ],
  legacyRegression: [
    "legacy-request-persisted",
    "legacy-card-pending-rendered",
    "legacy-card-shows-question",
    "legacy-resolved-once",
    "legacy-resolved-answer-is-label",
    "legacy-broker-backfill-dual-channel-consistent",
    "legacy-card-settled-rendered",
    "multi-card-projects-next-pending-question",
    "multi-card-projects-last-pending-question",
    "multi-all-questions-resolved",
    "final-broker-resolve-approved-once",
    "final-broker-resolve-aggregates-answers",
    "multi-registry-drained-after-final",
    "multi-card-answered-rendered",
    "cancel-target-card-pending",
  ],
};

// Dormancy (§6-6): the agent-host tool must still expose exactly the legacy
// single-question parameters — zero multi-question fields in the schema and
// a single-question description. The multi-question tool surface arrives
// with PR10C's producer activation.
const runtimeSource = await readFile(
  join(repositoryRoot, "packages", "agent-host", "src", "runtime.ts"),
  "utf8",
);
const toolDefinitionStart = runtimeSource.indexOf('name: "request_user_input"');
const toolDefinitionEnd =
  toolDefinitionStart === -1
    ? -1
    : runtimeSource.indexOf("execute: async", toolDefinitionStart);
const toolDefinition =
  toolDefinitionStart === -1 || toolDefinitionEnd === -1
    ? null
    : runtimeSource.slice(toolDefinitionStart, toolDefinitionEnd);
const dormancy = {
  toolDefinitionFound: toolDefinition !== null,
  parametersSingleQuestionOnly:
    toolDefinition !== null &&
    !/\bquestions\b/u.test(toolDefinition) &&
    toolDefinition.includes("question:") &&
    toolDefinition.includes("options:"),
  descriptionSingleQuestionOnly:
    toolDefinition !== null && toolDefinition.includes("exactly one question"),
};

const results = [];
await mkdir(outputDirectory, { recursive: true });
try {
  for (const testCase of cases) {
    const { id, view, theme, caseId, scenario } = testCase;
    const screenshotPath = join(outputDirectory, `${id}-${theme}.png`);
    const accessibilityPath = join(
      outputDirectory,
      `${id}-${theme}.transport.json`,
    );
    for (const artifactPath of [screenshotPath, accessibilityPath]) {
      await rm(artifactPath, { force: true });
    }
    const environment = {
      ...process.env,
      ARTEMIS_SMOKE_SCREENSHOT: screenshotPath,
      ARTEMIS_SMOKE_ACCESSIBILITY: accessibilityPath,
      ARTEMIS_SMOKE_LOCALE: locale,
      ARTEMIS_SMOKE_SETTLE_DELAY: "800",
      ARTEMIS_SMOKE_THEME: theme,
      ARTEMIS_SMOKE_VIEW: view,
      ARTEMIS_SMOKE_WINDOW_WIDTH: String(windowWidth),
    };
    // Never inherit a live dev server: the smoke must exercise the built
    // production renderer from this checkout, not whatever serves
    // 127.0.0.1.
    delete environment.ELECTRON_RUN_AS_NODE;
    delete environment.ARTEMIS_DEV_SERVER_URL;
    // Electron user data (Cache, Local Storage, artemis.sqlite) lives in a
    // dedicated user-data subtree with one fresh directory per case x
    // attempt, never directly at the throwaway run root's case level.
    const caseUserDataDirectory = (attempt) =>
      join(
        temporaryDirectory,
        "user-data",
        "user-input-transport",
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
          `User-input transport smoke case ${caseId} failed.`,
          launchResult.error?.message,
          launchResult.stdout,
          launchResult.stderr,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }

    const audit = JSON.parse(await readFile(accessibilityPath, "utf8"));
    const assertions = [];
    const assert = (name, pass, actual, expected) => {
      const record = { name, pass, actual, expected };
      assertions.push(record);
      if (!pass) {
        throw new Error(
          `${caseId} assertion failed: ${name} (actual ${JSON.stringify(actual)}).`,
        );
      }
      return record;
    };
    // Isolation gates follow the #117 standard: the winning launch started
    // from a user-data directory that did not exist yet, the throwaway run
    // root only ever holds the user-data subtree, and no captured audit
    // data leaks a local path from this machine.
    assert(
      "user-data-fresh-start",
      launchOutcome.userDataPreexisting === false,
      launchOutcome.userDataPreexisting,
      false,
    );
    const unexpectedRunRootEntries = (await readdir(temporaryDirectory))
      .sort()
      .filter((entry) => entry !== "user-data");
    assert(
      "run-root-purity",
      unexpectedRunRootEntries.length === 0,
      unexpectedRunRootEntries,
      [],
    );
    assert(
      "window-width-applied",
      typeof audit.windowInnerWidth === "number" &&
        audit.windowInnerWidth >= 1_400,
      audit.windowInnerWidth,
      ">= 1400",
    );
    assert(
      "audit-issues-empty",
      Array.isArray(audit.issues) && audit.issues.length === 0,
      audit.issues,
      [],
    );
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
    assert(
      "no-local-path-leak",
      leakedMarker === undefined,
      leakedMarker ?? null,
      null,
    );
    const screenshotSize = await stat(screenshotPath).then(
      (fileStat) => fileStat.size,
    );
    assert(
      "screenshot-not-empty",
      screenshotSize > 10_000,
      screenshotSize,
      "> 10000 bytes",
    );

    // §6-1..§6-5: the recorded main-process checks, re-asserted by name so
    // a failure names the exact transport guarantee that broke.
    const transport = audit.userInputTransport ?? null;
    assert(
      "transport-evidence-present",
      transport?.view === "user-input-transport",
      transport?.view ?? null,
      "user-input-transport",
    );
    const checks = Array.isArray(transport?.checks) ? transport.checks : [];
    assert(
      "transport-checks-all-pass",
      checks.length >= 30 && checks.every((check) => check.pass === true),
      {
        count: checks.length,
        failing: checks
          .filter((check) => check.pass !== true)
          .map((check) => check.name),
      },
      { count: ">= 30", failing: [] },
    );
    for (const [group, names] of Object.entries(checkGroups)) {
      for (const name of names) {
        const check = checks.find((candidate) => candidate.name === name);
        assert(`${group}:${name}`, check?.pass === true, check ?? null, {
          pass: true,
        });
      }
    }
    const storeChecks = transport?.storeChecks ?? {};
    assert(
      "store-legacy-requested-once",
      storeChecks.legacyRequested === 1,
      storeChecks.legacyRequested ?? null,
      1,
    );
    assert(
      "store-legacy-resolved-once",
      storeChecks.legacyResolved === 1,
      storeChecks.legacyResolved ?? null,
      1,
    );
    assert(
      "store-multi-requested-once",
      storeChecks.multiRequested === 1,
      storeChecks.multiRequested ?? null,
      1,
    );
    assert(
      "store-multi-resolved-three",
      storeChecks.multiResolved === 3,
      storeChecks.multiResolved ?? null,
      3,
    );
    assert(
      "store-multi-expired-requested-once",
      storeChecks.multiExpiredRequested === 1,
      storeChecks.multiExpiredRequested ?? null,
      1,
    );
    assert(
      "store-multi-expired-resolved-two",
      storeChecks.multiExpiredResolved === 2,
      storeChecks.multiExpiredResolved ?? null,
      2,
    );
    assert(
      "store-multi-cancel-requested-once",
      storeChecks.multiCancelRequested === 1,
      storeChecks.multiCancelRequested ?? null,
      1,
    );
    assert(
      "store-multi-cancel-resolved-once",
      storeChecks.multiCancelResolved === 1,
      storeChecks.multiCancelResolved ?? null,
      1,
    );
    const brokerPosts = Array.isArray(transport?.brokerPosts)
      ? transport.brokerPosts
      : [];
    const brokerResolves = brokerPosts.filter(
      (post) => post.type === "broker.resolve",
    );
    assert(
      "broker-resolve-count-exactly-five",
      brokerResolves.length === 5,
      brokerResolves.length,
      "legacy user 1 + duplicate-injection reject 1 + multi final 1 + expired final 1 + cancel 1 = 5",
    );
    const duplicateReject = brokerResolves.find(
      (post) =>
        post.requestId === "artemis-smoke-multi-worker" &&
        post.resolution?.approved === false &&
        post.error === "User input is already pending.",
    );
    assert(
      "broker-duplicate-injection-reject-receipt",
      Boolean(duplicateReject),
      brokerResolves.filter(
        (post) => post.requestId === "artemis-smoke-multi-worker",
      ),
      "one approved:false reject for the duplicate injection saying 'User input is already pending.'",
    );
    assert(
      "renderer-no-pending-cards-at-rest",
      transport?.renderer?.pendingCards === 0,
      transport?.renderer?.pendingCards ?? null,
      0,
    );

    // §6-6 dormancy: source-level proof that the tool surface stayed
    // single-question in this PR.
    assert(
      "dormancy-tool-definition-found",
      dormancy.toolDefinitionFound,
      dormancy.toolDefinitionFound,
      true,
    );
    assert(
      "dormancy-tool-parameters-single-question-only",
      dormancy.parametersSingleQuestionOnly,
      dormancy,
      "no multi-question fields in the request_user_input parameters",
    );
    assert(
      "dormancy-tool-description-single-question-only",
      dormancy.descriptionSingleQuestionOnly,
      dormancy,
      "description still promises exactly one question",
    );

    results.push({
      id,
      view,
      theme,
      scenario,
      screenshots: [basename(screenshotPath)],
      screenshotBytes: [screenshotSize],
      assertions,
      measured: {
        storeChecks,
        brokerPosts,
        renderer: transport?.renderer ?? null,
        checks,
      },
    });
    console.log(
      `PASS ${caseId} (${assertions.length} assertions, 1 screenshot)`,
    );
  }
  const totalAssertions = results.reduce(
    (sum, result) => sum + result.assertions.length,
    0,
  );
  const auditReport = {
    format: "artemis-user-input-transport-smoke",
    version: 1,
    generatedAt: new Date().toISOString(),
    locale,
    windowWidth,
    method: {
      driver:
        "Direct broker-request path: the smoke seeds one synthetic project/thread, then calls the real handleUserInputBrokerRequest handlers from inside the main process (the dormant producer cannot be driven through the tool surface in this PR).",
      timeoutDrive:
        "The five-minute per-question timers are not shortened and the frozen reducer discards timeouts stamped before a question's expiresAt (reverse time gate), so the timeout arm drives a synthetic request whose first question carries an already-expired deadline (and whose second keeps a live one) through the real emitPayload channel plus a real registry registration, then invokes the timer's own resolution function (completeMultiUserInputQuestion with source 'timeout') — the equivalent assembly of the timer body firing, disclosed here per checklist §6-2.",
      cancelDrive:
        "Cancellation drives the real cancelTaskTurn path (thread cancel), which must emit one kind-less cancelled resolution per multi request and post one broker.resolve approved:false receipt.",
      brokerCapture:
        "agentProcess.post is captured at the instance boundary for the duration of the driver only; the real agent host drops broker resolutions for unknown worker request ids (agent-worker.ts), so no production behavior changes.",
      zeroDialOut:
        "No provider, endpoint, or network resource is dialed; every identity (project, thread, request/nonces, worker ids) is synthetic and reserved.",
    },
    checkGroups,
    dormancy,
    userDataIsolation: {
      directory:
        "user-data/user-input-transport/<caseId>-attempt-<attempt> under the throwaway run root",
      note: "Every case x attempt launch gets its own fresh user-data directory (user-data-fresh-start), run-root-purity proves the run root only ever holds the user-data subtree, and no-local-path-leak scans the whole audit payload for this machine's paths.",
    },
    summary: {
      cases: results.length,
      passed: results.length,
      failed: 0,
      assertions: totalAssertions,
    },
    results,
  };
  const auditPath = join(outputDirectory, "report.json");
  await writeFile(
    auditPath,
    `${JSON.stringify(auditReport, null, 2)}\n`,
    "utf8",
  );
  console.log(
    `User input transport smoke passed: ${results.length} cases, ${totalAssertions} assertions.`,
  );
  console.log(auditPath);
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true });
}
