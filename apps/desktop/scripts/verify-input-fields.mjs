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
  positionalArguments[0] ?? join(repositoryRoot, "artifacts", "input-fields"),
);
const electronPath = createRequire(import.meta.url)("electron");
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "artemis-input-fields-"),
);
const windowWidth = 1_440;
const locale = "en";

// Two cases cover both real entry points (checklist §0) across both themes.
// The automations case drives the once schedule dialog through the real
// save chain; the avatar case drives the settings general tab through the
// real keyboard activation chain. Every identity is synthetic (reserved
// ids, fixture-only project path, a fixture-generated 1x1 PNG avatar) and
// both the main-process seed and the driven chains perform zero dial-out.
const steps = [
  {
    id: "input-fields-automations-once",
    view: "input-fields-automations-once",
    scenario:
      "Automations once schedule dialog: the native date field renders required inside a validating (no noValidate) form, a real Tab traversal reaches it with a visible :focus-visible ring, and the real save busy state disables it before the dialog closes.",
  },
  {
    id: "input-fields-settings-avatar",
    view: "input-fields-settings-avatar",
    scenario:
      "Settings general tab avatar field: the sr-only focusable file input keeps the exact accept whitelist, a real Tab traversal reaches it and shows the focus-within ring on the trigger label, Enter activates the real (DevTools-intercepted) file chooser, and the synthetic pick clears the input, renders the preview, and exposes remove.",
  },
];
const themes = ["light", "dark"];
const cases = steps.flatMap((step) =>
  themes.map((theme) => ({ ...step, theme, caseId: `${step.id}-${theme}` })),
);

const results = [];
await mkdir(outputDirectory, { recursive: true });
try {
  for (const testCase of cases) {
    const { id, view, theme, caseId, scenario } = testCase;
    const screenshotPath = join(outputDirectory, `${id}-${theme}.png`);
    const focusedScreenshotPath = join(
      outputDirectory,
      `${id}-${theme}-focused.png`,
    );
    const pickedScreenshotPath = join(
      outputDirectory,
      `${id}-${theme}-picked.png`,
    );
    const accessibilityPath = join(outputDirectory, `${id}-${theme}.a11y.json`);
    const expectedScreenshots = [screenshotPath, focusedScreenshotPath];
    if (id === "input-fields-settings-avatar") {
      expectedScreenshots.push(pickedScreenshotPath);
    }
    for (const artifactPath of [...expectedScreenshots, accessibilityPath]) {
      await rm(artifactPath, { force: true });
    }
    const environment = {
      ...process.env,
      ARTEMIS_SMOKE_SCREENSHOT: screenshotPath,
      ARTEMIS_SMOKE_SCREENSHOT_FOCUSED: focusedScreenshotPath,
      ...(id === "input-fields-settings-avatar"
        ? { ARTEMIS_SMOKE_SCREENSHOT_PICKED: pickedScreenshotPath }
        : {}),
      ARTEMIS_SMOKE_ACCESSIBILITY: accessibilityPath,
      ARTEMIS_SMOKE_LOCALE: locale,
      ARTEMIS_SMOKE_SETTLE_DELAY: "500",
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
        "input-fields",
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
          `Input fields smoke case ${caseId} failed.`,
          launchResult.error?.message,
          launchResult.stdout,
          launchResult.stderr,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }

    const audit = JSON.parse(await readFile(accessibilityPath, "utf8"));
    const inputFields = audit.inputFields;
    const probe = inputFields?.probe ?? null;
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
        "input-fields-audit-present",
        inputFields?.view === view,
        inputFields?.view ?? null,
        view,
      ).pass
    ) {
      throw new Error(`${caseId} did not expose inputFields audit data.`);
    }
    const keyboardChain = (labels) => {
      for (const label of labels) {
        if (
          !assert(label.name, label.pass, label.actual, label.expected).pass
        ) {
          throw new Error(
            `${caseId} assertion failed: ${label.name} (actual ${JSON.stringify(
              label.actual,
            )}).`,
          );
        }
      }
    };
    // Shared keyboard-chain gates (checklist §6-2): the document held real
    // OS focus, real Tab key events reached the target control, the focus
    // order includes it, and the visible focus evidence was captured while
    // it held focus.
    keyboardChain([
      {
        name: "document-has-focus",
        pass: probe?.documentHasFocus === true,
        actual: probe?.documentHasFocus ?? null,
        expected: true,
      },
      {
        name: "tab-traversal-reached-target",
        pass: probe?.tab?.reached === true,
        actual: probe?.tab ?? null,
        expected: { reached: true },
      },
      {
        name: "target-in-focus-order",
        pass:
          probe?.focus?.tabIndex === 0 &&
          typeof probe?.focus?.tabOrderIndex === "number" &&
          probe.focus.tabOrderIndex >= 0,
        actual: {
          tabIndex: probe?.focus?.tabIndex ?? null,
          tabOrderIndex: probe?.focus?.tabOrderIndex ?? null,
        },
        expected: { tabIndex: 0, tabOrderIndex: ">= 0" },
      },
    ]);
    // Screenshot artifacts are only statted after the semantic keyboard
    // gates above: a failed Tab traversal must surface as its named
    // assertion (with the probe evidence) instead of a bare ENOENT from
    // stat() running before the assertion chain.
    const screenshotSizes = [];
    for (const artifactPath of expectedScreenshots) {
      try {
        screenshotSizes.push((await stat(artifactPath)).size);
      } catch {
        const artifactName = basename(artifactPath);
        throw new Error(
          `${caseId} exited cleanly without writing screenshot artifact ${artifactName}; the evidence driver likely stopped before capturing it.`,
        );
      }
    }
    if (
      !assert(
        "screenshots-not-empty",
        screenshotSizes.length === expectedScreenshots.length &&
          screenshotSizes.every((bytes) => bytes > 10_000),
        screenshotSizes,
        `${expectedScreenshots.length} screenshots > 10000 bytes`,
      ).pass
    ) {
      throw new Error(`${caseId} produced an unexpectedly small screenshot.`);
    }
    if (id === "input-fields-automations-once") {
      const preSubmit = probe?.busy?.preSubmit ?? null;
      keyboardChain([
        {
          name: "once-form-rendered",
          pass:
            preSubmit?.formRole === "dialog" &&
            preSubmit?.formAriaModal === "true" &&
            preSubmit?.dateType === "date",
          actual: {
            formRole: preSubmit?.formRole ?? null,
            formAriaModal: preSubmit?.formAriaModal ?? null,
            dateType: preSubmit?.dateType ?? null,
          },
          expected: {
            formRole: "dialog",
            formAriaModal: "true",
            dateType: "date",
          },
        },
        {
          name: "date-required-native-validation-active",
          pass:
            preSubmit?.dateRequired === true &&
            preSubmit?.formNoValidate === false,
          actual: {
            dateRequired: preSubmit?.dateRequired ?? null,
            formNoValidate: preSubmit?.formNoValidate ?? null,
          },
          expected: { dateRequired: true, formNoValidate: false },
        },
        {
          name: "date-controlled-value",
          pass: preSubmit?.dateValue === "2099-06-15",
          actual: preSubmit?.dateValue ?? null,
          expected: "2099-06-15",
        },
        {
          name: "date-focus-ring-visible",
          pass:
            probe?.focus?.focused === true &&
            probe?.focus?.matchesFocusVisible === true &&
            probe?.focus?.outlineStyle === "solid" &&
            probe?.focus?.outlineWidth === "2px",
          actual: {
            focused: probe?.focus?.focused ?? null,
            matchesFocusVisible: probe?.focus?.matchesFocusVisible ?? null,
            outlineStyle: probe?.focus?.outlineStyle ?? null,
            outlineWidth: probe?.focus?.outlineWidth ?? null,
          },
          expected: {
            focused: true,
            matchesFocusVisible: true,
            outlineStyle: "solid",
            outlineWidth: "2px",
          },
        },
        {
          name: "date-disabled-while-saving",
          pass: probe?.busy?.busyDisabledObserved === true,
          actual: probe?.busy?.disabledTransitions ?? null,
          expected: "disabled=true observed during the save busy state",
        },
        {
          name: "save-completed-cleanly",
          pass:
            probe?.busy?.dialogClosedAfterSave === true &&
            probe?.busy?.errorMessage === null,
          actual: {
            dialogClosedAfterSave: probe?.busy?.dialogClosedAfterSave ?? null,
            errorMessage: probe?.busy?.errorMessage ?? null,
          },
          expected: { dialogClosedAfterSave: true, errorMessage: null },
        },
      ]);
    } else {
      const avatar = inputFields?.avatar ?? null;
      const activation = probe?.activation ?? null;
      const pick = probe?.pick ?? null;
      keyboardChain([
        {
          name: "avatar-accept-whitelist",
          pass: avatar?.accept === "image/jpeg,image/png,image/webp",
          actual: avatar?.accept ?? null,
          expected: "image/jpeg,image/png,image/webp",
        },
        {
          name: "avatar-file-type",
          pass: avatar?.type === "file",
          actual: avatar?.type ?? null,
          expected: "file",
        },
        {
          // The sr-only contract (checklist §6-2): visually hidden via the
          // clip pattern — NOT display:none — so the input keeps a layout
          // box, an offsetParent, and its place in the sequential focus
          // order. Chromium's used values for the 1px CSS size can round
          // up to 2px on inputs, so the gate bounds instead of equating.
          name: "avatar-sr-only-focusable-form",
          pass:
            avatar?.srOnly?.display !== "none" &&
            avatar?.srOnly?.visibility !== "hidden" &&
            avatar?.srOnly?.position === "absolute" &&
            avatar?.srOnly?.clipPath === "inset(50%)" &&
            avatar?.geometry?.offsetParentPresent === true &&
            typeof avatar?.geometry?.offsetWidth === "number" &&
            avatar.geometry.offsetWidth > 0 &&
            avatar.geometry.offsetWidth <= 2 &&
            typeof avatar?.geometry?.offsetHeight === "number" &&
            avatar.geometry.offsetHeight > 0 &&
            avatar.geometry.offsetHeight <= 2,
          actual: {
            srOnly: avatar?.srOnly ?? null,
            geometry: avatar?.geometry ?? null,
          },
          expected: {
            display: "not none",
            position: "absolute",
            clipPath: "inset(50%)",
            offsetSize: "1-2px (clipped, not display:none)",
            offsetParent: "present",
          },
        },
        {
          name: "avatar-focus-ring-on-trigger-label",
          pass:
            probe?.focus?.focused === true &&
            probe?.focus?.labelMatchesFocusWithin === true &&
            probe?.focus?.labelOutlineStyle === "solid" &&
            probe?.focus?.labelOutlineWidth === "2px",
          actual: {
            focused: probe?.focus?.focused ?? null,
            labelMatchesFocusWithin:
              probe?.focus?.labelMatchesFocusWithin ?? null,
            labelOutlineStyle: probe?.focus?.labelOutlineStyle ?? null,
            labelOutlineWidth: probe?.focus?.labelOutlineWidth ?? null,
          },
          expected: {
            focused: true,
            labelMatchesFocusWithin: true,
            labelOutlineStyle: "solid",
            labelOutlineWidth: "2px",
          },
        },
        {
          name: "enter-activated-real-file-chooser",
          pass:
            activation?.entered === true &&
            activation?.interceptionArmed === true &&
            activation?.fileChooserOpened === true,
          actual: activation ?? null,
          expected: {
            entered: true,
            interceptionArmed: true,
            fileChooserOpened: true,
          },
        },
        {
          name: "synthetic-pick-accepted",
          pass:
            Array.isArray(activation?.acceptedFiles) &&
            activation.acceptedFiles.length === 1 &&
            activation.acceptedFiles[0] === "avatar.png" &&
            activation.acceptError === undefined,
          actual: {
            acceptedFiles: activation?.acceptedFiles ?? null,
            acceptError: activation?.acceptError ?? null,
          },
          expected: { acceptedFiles: ["avatar.png"], acceptError: undefined },
        },
        {
          name: "input-cleared-after-pick",
          pass: pick?.valueCleared === true,
          actual: pick?.valueCleared ?? null,
          expected: true,
        },
        {
          name: "avatar-preview-and-remove-rendered",
          pass:
            pick?.previewImagePresent === true &&
            pick?.removePresent === true &&
            pick?.settled === true,
          actual: {
            previewImagePresent: pick?.previewImagePresent ?? null,
            removePresent: pick?.removePresent ?? null,
            settled: pick?.settled ?? null,
          },
          expected: {
            previewImagePresent: true,
            removePresent: true,
            settled: true,
          },
        },
        {
          name: "preview-is-synthetic-webp-data-url",
          pass: avatar?.previewImageSrcPrefix === "data:image/webp;base64",
          actual: avatar?.previewImageSrcPrefix ?? null,
          expected: "data:image/webp;base64",
        },
        {
          name: "avatar-disabled-while-saving",
          pass: pick?.busyDisabledObserved === true,
          actual: pick?.disabledTransitions ?? null,
          expected: "disabled=true observed during the avatar busy state",
        },
      ]);
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
      screenshots: expectedScreenshots.map((artifactPath) =>
        basename(artifactPath),
      ),
      screenshotBytes: screenshotSizes,
      assertions,
      measured: {
        probe,
        avatar: inputFields?.avatar ?? null,
      },
    });
    console.log(
      `PASS ${caseId} (${assertions.length} assertions, ${expectedScreenshots.length} screenshots)`,
    );
  }
  const totalAssertions = results.reduce(
    (sum, result) => sum + result.assertions.length,
    0,
  );
  const auditReport = {
    format: "artemis-input-fields-smoke",
    version: 1,
    generatedAt: new Date().toISOString(),
    locale,
    windowWidth,
    v17Reference: {
      card: "04c (cat-input-03, prototype/components.html:1032)",
      frames:
        "docs/d76迁移项目/v17-ref-pr9c/ (04c-light.png, 04c-dark.png, capture-report.json)",
      note: "v17 04c is the spec-gallery card; the PR body contrasts it with these production captures (panel-scoped input styles, hidden-input trigger pattern).",
    },
    fixtures: {
      syntheticProject: {
        id: "artemis-smoke-input-fields-project",
        note: "Upserted only inside the throwaway isolated user-data store so the once-form create button is reachable; the path points at a fixtures directory inside the same user-data tree.",
      },
      syntheticAvatar: {
        file: "fixtures/input-fields/avatar.png (1x1 fixture-generated PNG, base64-embedded)",
        note: "Never a real user photo; the intercepted file chooser is satisfied with this synthetic image.",
      },
      zeroDialOut:
        "No provider, endpoint, or process is dialed; the saved once automation is dated 2099 so the scheduler never fires it.",
    },
    keyboardEvidence: {
      tabTraversal:
        "Real DevTools-protocol Input.dispatchKeyEvent Tab presses from document start until the target control holds document.activeElement (cap 200).",
      focusRing:
        "Computed outline read from the focused control (date: input:focus-visible; avatar: label focus-within) while it held real keyboard focus after webContents.focus() on the offscreen window.",
      enterActivation:
        "Enter is dispatched as a real key event to the focused avatar input; Chromium's own file chooser then opens as Page.fileChooserOpened over the DevTools protocol (no native dialog ever shows), and Page.fileChooserAccepted feeds the synthetic PNG so the real change -> clear -> preview -> remove chain runs.",
    },
    userDataIsolation: {
      directory:
        "user-data/input-fields/<caseId>-attempt-<attempt> under the throwaway run root",
      note: "Electron user data never sits directly at the run-root case level; every case x attempt launch gets its own fresh directory (user-data-fresh-start), run-root-purity proves the run root only ever holds the user-data subtree, and no-local-path-leak scans the whole audit payload for this machine's paths.",
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
    `Input fields smoke passed: ${results.length} cases, ${totalAssertions} assertions.`,
  );
  console.log(auditPath);
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true });
}
