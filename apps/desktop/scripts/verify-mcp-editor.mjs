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
const repositoryRoot = resolve(appDirectory, "..", "..");
const outputDirectory = resolve(
  process.argv[2] ?? join(repositoryRoot, "artifacts", "mcp-editor"),
);
const electronPath = createRequire(import.meta.url)("electron");
const temporaryDirectory = await mkdtemp(join(tmpdir(), "artemis-mcp-editor-"));
const windowWidth = 1_440;
const locale = "en";
const seededServerName = "Artemis Smoke Remote";
const newServerName = "artemis-smoke-mcp-server";
const syntheticBearerMarker = "artemis-smoke-bearer";
const savingLabel = "Saving…";
const removingLabel = "Removing…";
const savedMessage = "MCP server saved and connected.";
const removedMessage = "MCP server removed.";
const validationHeading = "Fix these issues before saving:";
const validationCommandRequired =
  "Enter the launch command for the MCP server.";
const saveFailureDetail = "Simulated MCP server save failure.";
const removeFailureDetail = "Simulated MCP server removal failure.";
const testConnectionFailure = "Connection failed.";
const testFailureDetail = "Simulated MCP connection test rejection.";
const testSavedOnlyHint =
  "Tests the saved configuration — save your changes first";
const driftedUrl = "https://mcp.artemis-smoke.example.test/mcp-drift";
const seededStdioServerName = "Artemis Smoke Local";
const seededStdioCommand = "/artemis-smoke-mcp-editor/stdio-server";
const seededStdioArgs = ["--smoke"];
const driftedArgument = "--drift";
const confirmUninstallPrefix = `Uninstall ${seededServerName}?`;
// The manage row renders "Disabled · N tools" while config.enabled is false,
// which is the renderer-visible proof that the seeded fixture never dialed.
const seedOfflineRowPrefix = "Disabled";

// Each step drives one checklist §6 interaction to its end state, then the
// harness captures one screenshot and one accessibility audit for that state.
// Every identity is synthetic: the seeded streamable-http server points at a
// reserved .test hostname with an unset bearer, and both stdio identities
// (the seeded server and the one step c creates) use command paths that
// cannot exist.
const steps = [
  {
    id: "a-new",
    view: "mcp-editor-new",
    scenario:
      "Open the new-server form from Resource Center > MCP; assert the field cards render with no test-connection or uninstall control.",
  },
  {
    id: "b-validation",
    view: "mcp-editor-validation",
    scenario:
      "Submit with a whitespace-only launch command; the validation alert lists the missing required field and Save stays disabled.",
  },
  {
    id: "c-save",
    view: "mcp-editor-save",
    scenario:
      "Fill the launch command and save; the wrapper goes aria-busy with 'Saving…', then the editor closes on the saved message with both servers listed.",
  },
  {
    id: "d-save-error",
    view: "mcp-editor-save-error",
    scenario:
      "Inject a saveMcpServer rejection; the action-error alert appears with a Retry affordance and the draft command is retained.",
  },
  {
    id: "e-test-busy",
    view: "mcp-editor-test-busy",
    scenario:
      "Edit-mode Test connection pending: the test region is aria-busy with 'Testing the connection…', its button disabled, and Save/Uninstall mutually disabled while the form wrapper stays idle.",
  },
  {
    id: "f-test-success",
    view: "mcp-editor-test-success",
    scenario:
      "The reconnect snapshot reports connected; the test status announces 'Connected.' with no failure alert.",
  },
  {
    id: "g-test-failure",
    view: "mcp-editor-test-failure",
    scenario:
      "The reconnect snapshot reports failed; the failure alert shows 'Connection failed.' plus the injected error message.",
  },
  {
    id: "h-remove-confirm",
    view: "mcp-editor-remove-confirm",
    scenario:
      "Uninstall opens the danger alertdialog; cancelling it closes the dialog without removing the server, and the dialog reopens for evidence.",
  },
  {
    id: "i-remove",
    view: "mcp-editor-remove",
    scenario:
      "Confirm the danger dialog; every editor control disables under 'Removing…', then the editor closes on the removed message with the server gone.",
  },
  {
    id: "j-remove-error",
    view: "mcp-editor-remove-error",
    scenario:
      "Inject a one-shot removeMcpServer rejection; the alert offers Retry and the retry drives the real removal through to the removed state.",
  },
  {
    id: "k-credentials",
    view: "mcp-editor-credentials",
    scenario:
      "Type a synthetic bearer into the masked input and save: no text node, attribute, or markup occurrence of the value, and zero console capture.",
  },
  {
    id: "l-test-drift",
    view: "mcp-editor-test-drift",
    scenario:
      "Edit the saved server URL without saving: the test button disables behind the saved-only hint ('Tests the saved configuration — save your changes first'); the seeded saved config is untouched.",
  },
  {
    id: "m-test-drift-stdio",
    view: "mcp-editor-test-drift-stdio",
    scenario:
      "Edit the saved stdio server's arguments without saving: the test button disables behind the saved-only hint, a programmatic click on it still fires zero reconnect IPC, and reverting the argument re-enables testing; both seeded rows stay offline.",
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
    const accessibilityPath = join(outputDirectory, `${id}-${theme}.a11y.json`);
    await rm(screenshotPath, { force: true });
    await rm(accessibilityPath, { force: true });
    const environment = {
      ...process.env,
      ARTEMIS_SMOKE_SCREENSHOT: screenshotPath,
      ARTEMIS_SMOKE_ACCESSIBILITY: accessibilityPath,
      ARTEMIS_SMOKE_LOCALE: locale,
      ARTEMIS_SMOKE_SETTLE_DELAY: "250",
      ARTEMIS_SMOKE_THEME: theme,
      ARTEMIS_SMOKE_VIEW: view,
      ARTEMIS_SMOKE_WINDOW_WIDTH: String(windowWidth),
    };
    // Never inherit a live dev server: the smoke must exercise the built
    // production renderer from this checkout, not whatever serves 127.0.0.1.
    delete environment.ELECTRON_RUN_AS_NODE;
    delete environment.ARTEMIS_DEV_SERVER_URL;
    // Electron user data (Cache, Local Storage, artemis.sqlite, mcp.json ...)
    // lives in a dedicated user-data subtree with one fresh directory per
    // case x attempt, never directly at the throwaway run root's case level.
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
          timeout: 60_000,
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
          `MCP editor smoke case ${caseId} failed.`,
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
    const editor = audit.mcpEditor;
    if (screenshotBytes < 10_000) {
      throw new Error(`${caseId} screenshot is unexpectedly small.`);
    }
    if (audit.issues?.length) {
      throw new Error(
        `${caseId} accessibility audit failed: ${JSON.stringify(audit.issues)}`,
      );
    }
    if (!editor) {
      throw new Error(`${caseId} did not expose mcpEditor audit data.`);
    }
    const assertions = [];
    const assert = (name, pass, actual, expected) => {
      const record = { name, pass, actual, expected };
      assertions.push(record);
      return record;
    };
    // The state under test is the seeded mcp.json store living inside the
    // isolated user-data directory itself, so the isolation gates are
    // (1) the winning launch started from a directory that did not exist yet
    // -- no other case or attempt residue can feed this run's seeded server
    // -- and (2) the throwaway run root only ever holds the dedicated
    // user-data subtree, so no Electron or app write escapes beside it.
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
    const busyEntry = (label) =>
      (editor.busyTrace ?? []).find(
        (entry) => entry.ariaBusy === "true" && entry.busyText === label,
      ) ?? null;
    const expectations = {
      "a-new": () => [
        assert(
          "editor-visible",
          editor.editorVisible === true,
          editor.editorVisible,
          true,
        ),
        assert(
          "heading-add-server",
          editor.heading === "Add MCP server",
          editor.heading,
          "Add MCP server",
        ),
        assert(
          "save-present",
          editor.savePresent === true,
          editor.savePresent,
          true,
        ),
        assert(
          "launch-command-input-empty",
          editor.commandValue === "",
          editor.commandValue,
          "",
        ),
        assert(
          "test-control-absent",
          editor.testPresent === false,
          editor.testPresent,
          false,
        ),
        assert(
          "uninstall-control-absent",
          editor.removePresent === false,
          editor.removePresent,
          false,
        ),
      ],
      "b-validation": () => [
        assert(
          "editor-visible",
          editor.editorVisible === true,
          editor.editorVisible,
          true,
        ),
        assert(
          "whitespace-draft-kept",
          editor.commandValue === "   ",
          editor.commandValue,
          "   ",
        ),
        assert(
          "validation-alert-visible",
          editor.validationVisible === true,
          editor.validationVisible,
          true,
        ),
        assert(
          "validation-role-alert",
          editor.validationRole === "alert",
          editor.validationRole,
          "alert",
        ),
        assert(
          "validation-heading-shown",
          typeof editor.validationText === "string" &&
            editor.validationText.includes(validationHeading),
          editor.validationText,
          `contains "${validationHeading}"`,
        ),
        assert(
          "validation-command-required",
          typeof editor.validationText === "string" &&
            editor.validationText.includes(validationCommandRequired),
          editor.validationText,
          `contains "${validationCommandRequired}"`,
        ),
        assert(
          "save-disabled-on-invalid",
          editor.saveDisabled === true,
          editor.saveDisabled,
          true,
        ),
        assert(
          "no-busy-while-invalid",
          editor.feedbackAriaBusy !== "true",
          editor.feedbackAriaBusy,
          'not "true"',
        ),
      ],
      "c-save": () => [
        assert(
          "busy-trace-saving",
          busyEntry(savingLabel) !== null,
          editor.busyTrace,
          `includes aria-busy entry "${savingLabel}"`,
        ),
        assert(
          "busy-save-controls-disabled",
          busyEntry(savingLabel)?.saveDisabled === true &&
            busyEntry(savingLabel)?.backDisabled === true,
          busyEntry(savingLabel),
          { saveDisabled: true, backDisabled: true },
        ),
        assert(
          "editor-closed-after-save",
          editor.editorVisible === false,
          editor.editorVisible,
          false,
        ),
        assert(
          "saved-message-shown",
          editor.manageMessageText === savedMessage,
          editor.manageMessageText,
          savedMessage,
        ),
        assert(
          "both-servers-listed",
          Array.isArray(editor.manageServerNames) &&
            editor.manageServerNames.includes(seededServerName) &&
            editor.manageServerNames.includes(newServerName),
          editor.manageServerNames,
          `includes "${seededServerName}" and "${newServerName}"`,
        ),
        assert(
          "no-action-error",
          editor.actionErrorVisible === false,
          editor.actionErrorVisible,
          false,
        ),
      ],
      "d-save-error": () => [
        assert(
          "editor-retained",
          editor.editorVisible === true,
          editor.editorVisible,
          true,
        ),
        assert(
          "action-error-visible",
          editor.actionErrorVisible === true,
          editor.actionErrorVisible,
          true,
        ),
        assert(
          "action-error-role-alert",
          editor.actionErrorRole === "alert",
          editor.actionErrorRole,
          "alert",
        ),
        assert(
          "action-error-text",
          typeof editor.actionErrorText === "string" &&
            editor.actionErrorText.includes(saveFailureDetail),
          editor.actionErrorText,
          `contains "${saveFailureDetail}"`,
        ),
        assert(
          "retry-affordance-enabled",
          editor.retryPresent === true && editor.retryDisabled === false,
          { present: editor.retryPresent, disabled: editor.retryDisabled },
          { present: true, disabled: false },
        ),
        assert(
          "draft-retained",
          editor.commandValue === newServerName,
          editor.commandValue,
          newServerName,
        ),
        assert(
          "save-retriggerable",
          editor.saveDisabled === false,
          editor.saveDisabled,
          false,
        ),
        assert(
          "busy-trace-saving",
          busyEntry(savingLabel) !== null,
          editor.busyTrace,
          `includes aria-busy entry "${savingLabel}"`,
        ),
      ],
      "e-test-busy": () => [
        assert(
          "editor-visible",
          editor.editorVisible === true,
          editor.editorVisible,
          true,
        ),
        assert(
          "test-control-present",
          editor.testPresent === true,
          editor.testPresent,
          true,
        ),
        assert(
          "test-region-busy",
          editor.testAriaBusy === "true",
          editor.testAriaBusy,
          "true",
        ),
        assert(
          "test-busy-status",
          editor.testStatusText === "Testing the connection…",
          editor.testStatusText,
          "Testing the connection…",
        ),
        assert(
          "test-button-disabled",
          editor.testButtonDisabled === true,
          editor.testButtonDisabled,
          true,
        ),
        assert(
          "save-disabled-while-test-busy",
          editor.saveDisabled === true,
          editor.saveDisabled,
          true,
        ),
        assert(
          "uninstall-disabled-while-test-busy",
          editor.removeDisabled === true,
          editor.removeDisabled,
          true,
        ),
        assert(
          "form-wrapper-not-busy",
          editor.feedbackAriaBusy !== "true",
          editor.feedbackAriaBusy,
          'not "true"',
        ),
        assert(
          "no-failure-while-busy",
          editor.testFailureVisible === false,
          editor.testFailureVisible,
          false,
        ),
      ],
      "f-test-success": () => [
        assert(
          "test-settled",
          editor.testAriaBusy !== "true",
          editor.testAriaBusy,
          'not "true"',
        ),
        assert(
          "success-status-shown",
          editor.testStatusText === "Connected.",
          editor.testStatusText,
          "Connected.",
        ),
        assert(
          "test-button-re-enabled",
          editor.testButtonDisabled === false,
          editor.testButtonDisabled,
          false,
        ),
        assert(
          "no-failure-alert",
          editor.testFailureVisible === false,
          editor.testFailureVisible,
          false,
        ),
        assert(
          "no-action-error",
          editor.actionErrorVisible === false,
          editor.actionErrorVisible,
          false,
        ),
      ],
      "g-test-failure": () => [
        assert(
          "editor-retained",
          editor.editorVisible === true,
          editor.editorVisible,
          true,
        ),
        assert(
          "failure-alert-visible",
          editor.testFailureVisible === true,
          editor.testFailureVisible,
          true,
        ),
        assert(
          "failure-label",
          typeof editor.testFailureText === "string" &&
            editor.testFailureText.includes(testConnectionFailure),
          editor.testFailureText,
          `contains "${testConnectionFailure}"`,
        ),
        assert(
          "failure-message-visible",
          typeof editor.testFailureText === "string" &&
            editor.testFailureText.includes(testFailureDetail),
          editor.testFailureText,
          `contains "${testFailureDetail}"`,
        ),
        assert(
          "test-settled",
          editor.testAriaBusy !== "true",
          editor.testAriaBusy,
          'not "true"',
        ),
        assert(
          "test-button-re-enabled",
          editor.testButtonDisabled === false,
          editor.testButtonDisabled,
          false,
        ),
      ],
      "h-remove-confirm": () => {
        const dialog = editor.confirmDialog;
        const probe = editor.probe ?? {};
        return [
          assert(
            "danger-dialog-visible",
            dialog?.visible === true,
            dialog,
            "visible danger alertdialog",
          ),
          assert(
            "dialog-role-alertdialog",
            dialog?.role === "alertdialog",
            dialog?.role ?? null,
            "alertdialog",
          ),
          assert(
            "dialog-danger-tone",
            typeof dialog?.tone === "string" && dialog.tone.includes("danger"),
            dialog?.tone ?? null,
            'contains "danger"',
          ),
          assert(
            "dialog-message-names-server",
            typeof dialog?.message === "string" &&
              dialog.message.startsWith(confirmUninstallPrefix),
            dialog?.message ?? null,
            `starts with "${confirmUninstallPrefix}"`,
          ),
          assert(
            "dialog-buttons-labelled",
            probe.dialog?.cancelLabel === "Cancel" &&
              probe.dialog?.confirmLabel === "Confirm",
            probe.dialog ?? null,
            { cancelLabel: "Cancel", confirmLabel: "Confirm" },
          ),
          assert(
            "rejection-closed-dialog",
            probe.rejection?.dialogGone === true,
            probe.rejection ?? null,
            { dialogGone: true },
          ),
          assert(
            "rejection-kept-server",
            probe.rejection?.editorStillOpen === true,
            probe.rejection ?? null,
            { editorStillOpen: true },
          ),
        ];
      },
      "i-remove": () => [
        assert(
          "busy-trace-removing",
          busyEntry(removingLabel) !== null,
          editor.busyTrace,
          `includes aria-busy entry "${removingLabel}"`,
        ),
        assert(
          "removing-controls-disabled",
          busyEntry(removingLabel)?.saveDisabled === true &&
            busyEntry(removingLabel)?.removeDisabled === true &&
            busyEntry(removingLabel)?.testDisabled === true &&
            busyEntry(removingLabel)?.backDisabled === true &&
            busyEntry(removingLabel)?.urlDisabled === true,
          busyEntry(removingLabel),
          {
            saveDisabled: true,
            removeDisabled: true,
            testDisabled: true,
            backDisabled: true,
            urlDisabled: true,
          },
        ),
        assert(
          "editor-closed-after-remove",
          editor.editorVisible === false,
          editor.editorVisible,
          false,
        ),
        assert(
          "removed-message-shown",
          editor.manageMessageText === removedMessage,
          editor.manageMessageText,
          removedMessage,
        ),
        assert(
          "seeded-server-gone",
          Array.isArray(editor.manageServerNames) &&
            !editor.manageServerNames.includes(seededServerName),
          editor.manageServerNames,
          `without "${seededServerName}"`,
        ),
        assert(
          "no-action-error",
          editor.actionErrorVisible === false,
          editor.actionErrorVisible,
          false,
        ),
      ],
      "j-remove-error": () => {
        const failure = editor.probe?.injectedFailure ?? null;
        return [
          assert(
            "injected-failure-alert",
            typeof failure?.alertText === "string" &&
              failure.alertText.includes(removeFailureDetail),
            failure,
            `alert containing "${removeFailureDetail}"`,
          ),
          assert(
            "injected-failure-retry-enabled",
            failure?.retryDisabled === false,
            failure,
            { retryDisabled: false },
          ),
          assert(
            "injected-failure-editor-retained",
            failure?.editorStillOpen === true,
            failure,
            { editorStillOpen: true },
          ),
          assert(
            "busy-trace-removing",
            busyEntry(removingLabel) !== null,
            editor.busyTrace,
            `includes aria-busy entry "${removingLabel}"`,
          ),
          assert(
            "retry-recovered-editor-closed",
            editor.editorVisible === false,
            editor.editorVisible,
            false,
          ),
          assert(
            "retry-recovered-message",
            editor.manageMessageText === removedMessage,
            editor.manageMessageText,
            removedMessage,
          ),
          assert(
            "retry-recovered-server-gone",
            Array.isArray(editor.manageServerNames) &&
              !editor.manageServerNames.includes(seededServerName),
            editor.manageServerNames,
            `without "${seededServerName}"`,
          ),
        ];
      },
      "l-test-drift": () => [
        assert(
          "editor-visible",
          editor.editorVisible === true,
          editor.editorVisible,
          true,
        ),
        assert(
          "test-control-present",
          editor.testPresent === true,
          editor.testPresent,
          true,
        ),
        assert(
          "url-edited-not-saved",
          editor.urlValue === driftedUrl,
          editor.urlValue,
          driftedUrl,
        ),
        assert(
          "test-button-disabled-on-drift",
          editor.testButtonDisabled === true,
          editor.testButtonDisabled,
          true,
        ),
        assert(
          "saved-only-hint-visible",
          editor.testHintPresent === true &&
            typeof editor.testHintText === "string" &&
            editor.testHintText.includes(testSavedOnlyHint),
          { present: editor.testHintPresent, text: editor.testHintText },
          `visible hint containing "${testSavedOnlyHint}"`,
        ),
        assert(
          "no-test-busy-while-drifted",
          editor.testAriaBusy !== "true",
          editor.testAriaBusy,
          'not "true"',
        ),
        assert(
          "no-failure-alert",
          editor.testFailureVisible === false,
          editor.testFailureVisible,
          false,
        ),
        assert(
          "form-wrapper-not-busy",
          editor.feedbackAriaBusy !== "true",
          editor.feedbackAriaBusy,
          'not "true"',
        ),
      ],
      "m-test-drift-stdio": () => {
        const probe = editor.probe ?? {};
        const before = probe.before ?? null;
        const drifted = probe.drifted ?? null;
        const afterClick = probe.afterClick ?? null;
        const reverted = probe.reverted ?? null;
        return [
          assert(
            "editor-visible",
            editor.editorVisible === true,
            editor.editorVisible,
            true,
          ),
          assert(
            "drift-field-args",
            probe.driftField === "args",
            probe.driftField,
            "args",
          ),
          assert(
            "test-enabled-before-drift",
            before?.testDisabled === false,
            before?.testDisabled,
            false,
          ),
          assert(
            "stdio-args-seeded",
            JSON.stringify(before?.argsValues) ===
              JSON.stringify(seededStdioArgs),
            before?.argsValues,
            seededStdioArgs,
          ),
          assert(
            "args-drifted-not-saved",
            JSON.stringify(drifted?.argsValues) ===
              JSON.stringify([...seededStdioArgs, driftedArgument]),
            drifted?.argsValues,
            [...seededStdioArgs, driftedArgument],
          ),
          assert(
            "test-button-disabled-on-args-drift",
            drifted?.testDisabled === true,
            drifted?.testDisabled,
            true,
          ),
          assert(
            "saved-only-hint-visible-on-drift",
            drifted?.testHintPresent === true &&
              typeof drifted?.testHintText === "string" &&
              drifted.testHintText.includes(testSavedOnlyHint),
            { present: drifted?.testHintPresent, text: drifted?.testHintText },
            `visible hint containing "${testSavedOnlyHint}"`,
          ),
          assert(
            "programmatic-click-zero-reconnect",
            audit.reconnectIpcCalls === 0,
            audit.reconnectIpcCalls,
            0,
          ),
          assert(
            "still-disabled-after-programmatic-click",
            afterClick?.testDisabled === true,
            afterClick?.testDisabled,
            true,
          ),
          assert(
            "args-reverted-to-saved",
            JSON.stringify(reverted?.argsValues) ===
              JSON.stringify(seededStdioArgs) &&
              JSON.stringify(editor.argsValues) ===
                JSON.stringify(seededStdioArgs),
            { reverted: reverted?.argsValues, final: editor.argsValues },
            seededStdioArgs,
          ),
          assert(
            "test-re-enabled-after-revert",
            reverted?.testDisabled === false &&
              editor.testButtonDisabled === false,
            {
              reverted: reverted?.testDisabled,
              final: editor.testButtonDisabled,
            },
            { reverted: false, final: false },
          ),
          assert(
            "hint-gone-after-revert",
            reverted?.testHintPresent === false &&
              editor.testHintPresent === false,
            {
              reverted: reverted?.testHintPresent,
              final: editor.testHintPresent,
            },
            { reverted: false, final: false },
          ),
          assert(
            "no-bearer-marker-in-audit",
            JSON.stringify(audit).includes(syntheticBearerMarker) === false,
            JSON.stringify(audit).includes(syntheticBearerMarker),
            false,
          ),
        ];
      },
      "k-credentials": () => {
        const before = editor.probe?.beforeSave ?? null;
        const after = editor.probe?.afterSave ?? null;
        const capture = editor.consoleCapture ?? null;
        return [
          assert("bearer-input-masked", before?.masked === true, before, {
            masked: true,
          }),
          assert(
            "no-bearer-text-nodes",
            before?.textHits === 0 && after?.textHits === 0,
            { before: before?.textHits, after: after?.textHits },
            { before: 0, after: 0 },
          ),
          assert(
            "no-bearer-foreign-attributes",
            (before?.attributeHitDetails ?? []).every(
              (detail) => detail.maskedCredentialInput === true,
            ) && (after?.attributeHitDetails ?? []).length === 0,
            {
              before: before?.attributeHitDetails ?? null,
              after: after?.attributeHitDetails ?? null,
            },
            "only the masked input's own value attribute, none after save",
          ),
          assert(
            "no-bearer-markup-outside-masked-inputs",
            before?.markupHits === 0 && after?.markupHits === 0,
            { before: before?.markupHits, after: after?.markupHits },
            { before: 0, after: 0 },
          ),
          assert(
            "console-zero-capture",
            Array.isArray(capture?.entries) && capture.entries.length === 0,
            capture?.entries?.length ?? null,
            0,
          ),
          assert(
            "console-zero-credential-mentions",
            capture?.credentialEntries === 0,
            capture?.credentialEntries ?? null,
            0,
          ),
          assert(
            "editor-closed-after-save",
            editor.editorVisible === false,
            editor.editorVisible,
            false,
          ),
          assert(
            "saved-message-shown",
            editor.manageMessageText === savedMessage,
            editor.manageMessageText,
            savedMessage,
          ),
        ];
      },
    };
    // Common assertions (user-data-fresh-start, run-root-purity,
    // seed-stays-offline) are recorded alongside the per-step expectations so
    // every counted assertion appears in the audit JSON.
    // assert() records into `assertions` itself; no outer push needed.
    assert(
      "seed-stays-offline",
      typeof editor.seedRow?.stateText === "string" &&
        editor.seedRow.stateText.startsWith(seedOfflineRowPrefix),
      editor.seedRow ?? null,
      `stateText starting with "${seedOfflineRowPrefix}"`,
    );
    assert(
      "seed-stdio-stays-offline",
      typeof editor.seedStdioRow?.stateText === "string" &&
        editor.seedStdioRow.stateText.startsWith(seedOfflineRowPrefix),
      editor.seedStdioRow ?? null,
      `stateText starting with "${seedOfflineRowPrefix}"`,
    );
    const stepAssertions = [...assertions, ...expectations[id]()];
    const failed = stepAssertions.filter((assertion) => !assertion.pass);
    if (failed.length) {
      throw new Error(`${caseId} assertions failed: ${JSON.stringify(failed)}`);
    }
    // Defense in depth for the evidence itself: the synthetic bearer marker
    // must never appear anywhere in the captured audit payload.
    if (JSON.stringify(audit).includes(syntheticBearerMarker)) {
      throw new Error(
        `${caseId} audit data contains the synthetic bearer marker.`,
      );
    }
    results.push({
      id,
      view,
      theme,
      scenario,
      screenshot: `${id}-${theme}.png`,
      screenshotBytes,
      assertions: stepAssertions,
      aria: {
        heading: editor.heading,
        feedbackAriaBusy: editor.feedbackAriaBusy,
        busyText: editor.busyText,
        validationVisible: editor.validationVisible,
        validationRole: editor.validationRole,
        actionErrorVisible: editor.actionErrorVisible,
        actionErrorRole: editor.actionErrorRole,
        actionErrorText: editor.actionErrorText,
        retryDisabled: editor.retryDisabled,
        testAriaBusy: editor.testAriaBusy,
        testStatusText: editor.testStatusText,
        testFailureText: editor.testFailureText,
        testHintText: editor.testHintText,
        confirmDialog: editor.confirmDialog,
        manageMessageText: editor.manageMessageText,
      },
      manageServerNames: editor.manageServerNames,
      seedRow: editor.seedRow ?? null,
      seedStdioRow: editor.seedStdioRow ?? null,
      busyTrace: editor.busyTrace,
      probe: editor.probe,
      consoleCapture: editor.consoleCapture,
      viewport: {
        requestedWidth: windowWidth,
        windowInnerWidth: audit.windowInnerWidth,
        windowOuterHeight: 920,
      },
    });
    console.log(
      `PASS ${caseId} (${stepAssertions.length} assertions, screenshot ${screenshotBytes} bytes)`,
    );
  }
  const totalAssertions = results.reduce(
    (sum, result) => sum + result.assertions.length,
    0,
  );
  const auditReport = {
    format: "artemis-mcp-editor-smoke",
    version: 1,
    generatedAt: new Date().toISOString(),
    locale,
    windowWidth,
    fixtures: {
      seededServer: {
        id: "artemis-smoke-remote",
        name: seededServerName,
        transport: "streamable-http",
        url: "https://mcp.artemis-smoke.example.test/mcp",
        auth: "bearer (credential intentionally unset)",
        enabled: false,
      },
      seededStdioServer: {
        id: "artemis-smoke-local",
        name: seededStdioServerName,
        transport: "stdio",
        command: seededStdioCommand,
        args: seededStdioArgs,
        env: "(empty)",
        workspace:
          "synthesized by the store inside the isolated user-data directory",
        enabled: false,
      },
      newServer: {
        id: newServerName,
        transport: "stdio",
        command: newServerName,
      },
      note: "Every identity is synthetic: the .test hostname never resolves and the stdio command paths never exist, so no smoke run can reach a real endpoint or spawn a real process. Both seeded servers persist with enabled:false — initializeOptionalCapabilities only auto-connects enabled servers, so the seeds perform zero dial-out at startup, and every case asserts both seeded manage rows render their offline state (seed-stays-offline, seed-stdio-stays-offline).",
    },
    userDataIsolation: {
      directory:
        "user-data/<caseId>-attempt-<attempt> under the throwaway run root",
      note: "Electron user data (including the seeded mcp.json store) never sits directly at the run-root case level; every case x attempt launch gets its own fresh directory (user-data-fresh-start), and run-root-purity proves the run root only ever holds the user-data subtree.",
    },
    evidenceSplit: {
      realChain:
        "The seeded snapshot persists through the real McpConfigStore.upsert, successful saves/removals round-trip the real store inside the isolated user-data directory, and the danger confirmation rides the production App alertdialog chain.",
      intercepted:
        "Only failure injection (one-shot save/remove rejections) and the synthetic reconnect snapshots (busy/success/failed) are intercepted in the main process; the connect step of a successful save is simulated away because the synthetic identity must never spawn or dial anything, and the bearer token is dropped before persistence.",
      componentContract:
        "The jsdom suites lock the component-level contract: mcp-editor-feedback.test.tsx and mcp-server-editor.test.tsx cover the aria-busy wrapper, validation alert, retry affordance, tri-state test control, confirm-deferral behavior, the four-way save/remove/test/confirm mutual exclusion (UI disable plus editor-level handler guards), and the saved-config drift gate on connection testing (HTTP URL in step l, stdio arguments in step m).",
    },
    security: {
      credentials:
        "The bearer credential stays unset in the seeded snapshot. The synthetic bearer typed in step k is asserted absent from every text node and from every element attribute except the masked input's own value attribute (React's controlled-input reflection, gone once the editor closes), absent from markup serialized without password inputs, absent from the console capture, and absent from the audit JSON itself.",
    },
    note: "Window height is fixed at 920 by the shared smoke harness; screenshots capture the resulting viewport.",
    summary: {
      cases: results.length,
      passed: results.length,
      failed: 0,
      assertions: totalAssertions,
    },
    steps: results.map((result) => ({
      id: result.id,
      view: result.view,
      scenario: result.scenario,
      themes: [result.theme],
    })),
    results,
  };
  const auditPath = join(outputDirectory, "audit.json");
  await writeFile(
    auditPath,
    `${JSON.stringify(auditReport, null, 2)}\n`,
    "utf8",
  );
  console.log(
    `MCP editor smoke passed: ${results.length} cases, ${totalAssertions} assertions.`,
  );
  console.log(auditPath);
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true });
}
