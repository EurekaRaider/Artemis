import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
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
  process.argv[2] ?? join(repositoryRoot, "artifacts", "markdown-editor"),
);
const electronPath = createRequire(import.meta.url)("electron");
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "artemis-markdown-editor-"),
);

function runGit(arguments_) {
  const result = spawnSync("git", arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Markdown editor verifier could not run git ${arguments_.join(" ")}: ${result.error?.message ?? result.stderr}`,
    );
  }
  return result.stdout.trim();
}

const candidateHead = runGit(["rev-parse", "HEAD"]);
const expectedHead = process.env.ARTEMIS_EXPECTED_HEAD?.trim() || candidateHead;
if (!/^[0-9a-f]{40}$/u.test(candidateHead) || expectedHead !== candidateHead) {
  throw new Error(
    `Markdown editor verifier expected HEAD ${expectedHead} does not match candidate ${candidateHead}.`,
  );
}
const initialStatus = runGit(["status", "--porcelain"]);
if (initialStatus !== "") {
  throw new Error(
    `Markdown editor verification requires a clean exact-head worktree:\n${initialStatus}`,
  );
}
const windowWidth = 1_440;
const locale = "en";
const markdownFileName = "NOTES.md";
const binaryFileName = "cover.png";
const largeFileName = "LARGE.ts";
const binaryPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const originalMarkdown = [
  "# Markdown editor smoke",
  "",
  "Shared toolbar contract evidence for the workspace markdown editor.",
  "",
  "## Checklist",
  "",
  "- Open a markdown file from the workspace tree",
  "- Edit the draft in source view",
  "- Save with the Meta+S chord",
  "",
  "![Render check](missing-reference.png)",
  "",
  "The image above intentionally fails so the accessible placeholder renders.",
].join("\n");
const editSuffix = "\n\nEdited line appended by the markdown editor smoke run.";
const editedMarkdown = originalMarkdown + editSuffix;
const largeSource = "const workspaceValue = 1;\n".repeat(10_001);
const savingLabel = "Saving…";
const savedLabel = "Saved";
const unsavedLabel = "Unsaved";
const saveLabel = "Save";
const binaryMessage = "Binary files cannot be previewed.";
const saveFailureDetail = "Simulated workspace file save failure.";

// The harness keeps the whole fixture on disk: ARTEMIS_SMOKE_WORKSPACE points
// the seeded synthetic project at a throwaway directory, so the production
// list/read/write/image IPC handlers all exercise real files. Only the
// save-error view is intercepted in the main process; every other state --
// including the missing-image rejection -- arises from the real chain.
const steps = [
  {
    id: "a-open",
    view: "markdown-editor-open",
    scenario:
      "Open NOTES.md from the workspace tree; the shared toolbar renders path, status region, and a disabled Save.",
  },
  {
    id: "b-dirty",
    view: "markdown-editor-dirty",
    scenario:
      "Switch to Source and edit; the status shows the dirty label and Save becomes enabled.",
  },
  {
    id: "c-save-shortcut",
    view: "markdown-editor-save",
    scenario:
      "Submit with Meta+S; the status flows Saving… -> Saved, the draft round-trips, and the file persists on disk.",
  },
  {
    id: "d-save-error",
    view: "markdown-editor-save-error",
    scenario:
      "Inject a writeWorkspaceFile rejection; the alert region appears, the draft is retained, Save stays retriggerable, and the disk file is unchanged.",
  },
  {
    id: "e-binary",
    view: "markdown-editor-binary",
    scenario:
      "Open the binary cover.png; the production read-only gate renders the binary notice with no Save, status region, or editing surface.",
  },
  {
    id: "f-image-failure",
    view: "markdown-editor-image-failure",
    scenario:
      "The failing workspace image reference is replaced by the visible role=img placeholder whose label contains the failure text.",
  },
  {
    id: "g-toggle",
    view: "markdown-editor-toggle",
    scenario:
      "Toggle Rich text / Source; aria-pressed stays unique and the editing surface switches both ways.",
  },
  {
    id: "h-large-file",
    view: "markdown-editor-large-file",
    scenario:
      "Open a source file larger than the 250,000-character highlighting threshold; the editable source remains available without the expensive highlight layer.",
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
    const caseWorkspace = join(temporaryDirectory, caseId);
    await mkdir(caseWorkspace, { recursive: true });
    await writeFile(join(caseWorkspace, markdownFileName), originalMarkdown, {
      encoding: "utf8",
    });
    await writeFile(
      join(caseWorkspace, binaryFileName),
      Buffer.from(binaryPngBase64, "base64"),
    );
    await writeFile(join(caseWorkspace, largeFileName), largeSource, "utf8");
    const environment = {
      ...process.env,
      ARTEMIS_SMOKE_SCREENSHOT: screenshotPath,
      ARTEMIS_SMOKE_ACCESSIBILITY: accessibilityPath,
      ARTEMIS_SMOKE_LOCALE: locale,
      ARTEMIS_SMOKE_SETTLE_DELAY: "250",
      ARTEMIS_SMOKE_THEME: theme,
      ARTEMIS_SMOKE_VIEW: view,
      ARTEMIS_SMOKE_WINDOW_WIDTH: String(windowWidth),
      ARTEMIS_SMOKE_WORKSPACE: caseWorkspace,
    };
    // Never inherit a live dev server: the smoke must exercise the built
    // production renderer from this checkout, not whatever serves 127.0.0.1.
    delete environment.ELECTRON_RUN_AS_NODE;
    delete environment.ARTEMIS_DEV_SERVER_URL;
    const electronArguments = [
      appDirectory,
      `--user-data-dir=${join(temporaryDirectory, "user-data", caseId)}`,
      "--disable-gpu",
      "--disable-gpu-compositing",
      "--disable-gpu-sandbox",
      "--use-angle=swiftshader",
    ];
    const launchResult = spawnSync(electronPath, electronArguments, {
      cwd: appDirectory,
      encoding: "utf8",
      env: environment,
      maxBuffer: 2 * 1024 * 1024,
      timeout: 60_000,
    });
    if (launchResult.error || launchResult.status !== 0) {
      throw new Error(
        [
          `Markdown editor smoke case ${caseId} failed.`,
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
    const editor = audit.markdownEditor;
    if (screenshotBytes < 10_000) {
      throw new Error(`${caseId} screenshot is unexpectedly small.`);
    }
    if (audit.issues?.length) {
      throw new Error(
        `${caseId} accessibility audit failed: ${JSON.stringify(audit.issues)}`,
      );
    }
    if (!editor) {
      throw new Error(`${caseId} did not expose markdownEditor audit data.`);
    }
    const assertions = [];
    const assert = (name, pass, actual, expected) => {
      const record = { name, pass, actual, expected };
      assertions.push(record);
      return record;
    };
    const expectedPath =
      id === "e-binary"
        ? binaryFileName
        : id === "h-large-file"
          ? largeFileName
          : markdownFileName;
    const commonPass = [
      assert(
        "files-panel-open",
        editor.panelOpen === true,
        editor.panelOpen,
        true,
      ),
      assert(
        "path-shown",
        editor.path === expectedPath,
        editor.path,
        expectedPath,
      ),
      assert(
        "renderer-sandbox-launch-flag",
        !electronArguments.includes("--no-sandbox"),
        electronArguments,
        "no --no-sandbox",
      ),
      assert(
        "document-identity",
        audit.title === "Artemis" && audit.documentLanguage === locale,
        { title: audit.title, language: audit.documentLanguage },
        { title: "Artemis", language: locale },
      ),
      assert(
        "renderer-runtime-security",
        audit.runtimeSecurity?.sandbox === true &&
          audit.runtimeSecurity?.contextIsolation === true &&
          audit.runtimeSecurity?.nodeIntegration === false,
        audit.runtimeSecurity ?? null,
        { sandbox: true, contextIsolation: true, nodeIntegration: false },
      ),
      assert(
        "renderer-console-clean",
        Array.isArray(audit.rendererConsoleEntries) &&
          audit.rendererConsoleEntries.length === 0,
        audit.rendererConsoleEntries ?? null,
        [],
      ),
    ].every((assertion) => assertion.pass);
    if (!commonPass) {
      throw new Error(
        `${caseId} did not render the files panel: ${JSON.stringify(editor)}`,
      );
    }
    // The fixture workspace must stay pure: Electron user data (Cache,
    // Local Storage, Partitions, artemis.sqlite, ...) lives in a separate
    // per-case per-attempt directory, so nothing beyond the seeded fixtures
    // may ever appear at the workspace top level.
    const expectedWorkspaceEntries = [
      binaryFileName,
      largeFileName,
      markdownFileName,
    ];
    const workspaceEntries = (await readdir(caseWorkspace)).sort();
    const unexpectedEntries = workspaceEntries.filter(
      (entry) => !expectedWorkspaceEntries.includes(entry),
    );
    if (
      !assert(
        "workspace-purity",
        unexpectedEntries.length === 0,
        unexpectedEntries,
        [],
      ).pass
    ) {
      throw new Error(
        `${caseId} workspace is not pure: unexpected top-level entries ${JSON.stringify(
          unexpectedEntries,
        )}. Electron user data must stay out of the fixture workspace.`,
      );
    }
    const placeholder = editor.imagePlaceholders?.[0] ?? null;
    const diskContent = await readFile(
      join(caseWorkspace, markdownFileName),
      "utf8",
    );
    const expectations = {
      "a-open": () => [
        assert(
          "toolbar-rendered",
          editor.toolbarVisible === true,
          editor.toolbarVisible,
          true,
        ),
        assert(
          "status-role",
          editor.statusRole === "status",
          editor.statusRole,
          "status",
        ),
        assert(
          "status-live-polite",
          editor.statusLive === "polite",
          editor.statusLive,
          "polite",
        ),
        assert(
          "status-empty-when-clean",
          editor.statusText === "",
          editor.statusText,
          "",
        ),
        assert(
          "save-disabled-when-clean",
          editor.savePresent === true && editor.saveDisabled === true,
          { present: editor.savePresent, disabled: editor.saveDisabled },
          { present: true, disabled: true },
        ),
        assert(
          "rich-view-default",
          editor.previewVisible === true && editor.sourceVisible === false,
          { preview: editor.previewVisible, source: editor.sourceVisible },
          { preview: true, source: false },
        ),
        assert(
          "preview-heading",
          editor.previewHeading === "Markdown editor smoke",
          editor.previewHeading,
          "Markdown editor smoke",
        ),
        assert(
          "mode-toggle-group",
          editor.modeToggleRole === "group",
          editor.modeToggleRole,
          "group",
        ),
        assert(
          "aria-pressed-default",
          editor.richPressed === "true" && editor.sourcePressed === "false",
          { rich: editor.richPressed, source: editor.sourcePressed },
          { rich: "true", source: "false" },
        ),
        assert(
          "image-placeholder-present",
          editor.imagePlaceholders?.length === 1,
          editor.imagePlaceholders?.length ?? null,
          1,
        ),
        assert(
          "image-placeholder-role-img",
          placeholder?.role === "img",
          placeholder?.role ?? null,
          "img",
        ),
        assert(
          "image-placeholder-label-failed",
          typeof placeholder?.ariaLabel === "string" &&
            placeholder.ariaLabel.includes("failed") &&
            placeholder.ariaLabel.includes("Render check"),
          placeholder?.ariaLabel ?? null,
          'contains "failed" and "Render check"',
        ),
        assert(
          "image-placeholder-visible",
          placeholder?.visible === true,
          placeholder?.visible ?? null,
          true,
        ),
      ],
      "b-dirty": () => [
        assert(
          "source-view-active",
          editor.sourceVisible === true &&
            editor.previewVisible === false &&
            editor.sourcePressed === "true" &&
            editor.richPressed === "false",
          {
            source: editor.sourceVisible,
            preview: editor.previewVisible,
            sourcePressed: editor.sourcePressed,
            richPressed: editor.richPressed,
          },
          {
            source: true,
            preview: false,
            sourcePressed: "true",
            richPressed: "false",
          },
        ),
        assert(
          "source-value-edited",
          editor.sourceValue === editedMarkdown,
          editor.sourceValue,
          editedMarkdown,
        ),
        assert(
          "dirty-status-text",
          editor.statusText === unsavedLabel,
          editor.statusText,
          unsavedLabel,
        ),
        assert(
          "dirty-status-class",
          editor.statusDirty === true,
          editor.statusDirty,
          true,
        ),
        assert(
          "save-enabled-when-dirty",
          editor.saveDisabled === false,
          editor.saveDisabled,
          false,
        ),
        assert(
          "no-alert-while-editing",
          editor.alertVisible === false,
          editor.alertVisible,
          false,
        ),
      ],
      "c-save-shortcut": () => [
        assert(
          "status-saved",
          editor.statusText === savedLabel,
          editor.statusText,
          savedLabel,
        ),
        assert(
          "save-disabled-after-save",
          editor.saveDisabled === true,
          editor.saveDisabled,
          true,
        ),
        assert(
          "content-round-tripped",
          editor.sourceValue === editedMarkdown,
          editor.sourceValue,
          editedMarkdown,
        ),
        assert(
          "status-trace-through-saving",
          Array.isArray(editor.statusTrace) &&
            editor.statusTrace.includes(savingLabel),
          editor.statusTrace,
          `includes "${savingLabel}"`,
        ),
        assert(
          "status-trace-final-saved",
          Array.isArray(editor.statusTrace) &&
            editor.statusTrace.at(-1) === savedLabel,
          editor.statusTrace,
          `ends with "${savedLabel}"`,
        ),
        assert(
          "no-alert-on-success",
          editor.alertVisible === false,
          editor.alertVisible,
          false,
        ),
        assert(
          "focus-stays-on-textarea",
          editor.focusTag === "TEXTAREA",
          editor.focusTag,
          "TEXTAREA",
        ),
        assert(
          "file-persisted-on-disk",
          diskContent === editedMarkdown,
          diskContent,
          editedMarkdown,
        ),
      ],
      "d-save-error": () => [
        assert(
          "alert-visible",
          editor.alertVisible === true,
          editor.alertVisible,
          true,
        ),
        assert(
          "alert-text",
          typeof editor.alertText === "string" &&
            editor.alertText.includes(saveFailureDetail),
          editor.alertText,
          `contains "${saveFailureDetail}"`,
        ),
        assert(
          "draft-retained",
          editor.sourceValue === editedMarkdown,
          editor.sourceValue,
          editedMarkdown,
        ),
        assert(
          "status-dirty-after-failure",
          editor.statusText === unsavedLabel,
          editor.statusText,
          unsavedLabel,
        ),
        assert(
          "save-retriggerable",
          editor.saveDisabled === false,
          editor.saveDisabled,
          false,
        ),
        assert(
          "disk-unchanged-after-failure",
          diskContent === originalMarkdown,
          diskContent,
          originalMarkdown,
        ),
      ],
      "e-binary": () => [
        assert(
          "preview-empty-visible",
          editor.readOnlyBinary.previewEmptyVisible === true,
          editor.readOnlyBinary.previewEmptyVisible,
          true,
        ),
        assert(
          "binary-message-shown",
          editor.readOnlyBinary.previewEmptyText === binaryMessage,
          editor.readOnlyBinary.previewEmptyText,
          binaryMessage,
        ),
        assert(
          "save-absent",
          editor.readOnlyBinary.saveAbsent === true,
          editor.readOnlyBinary.saveAbsent,
          true,
        ),
        assert(
          "status-region-absent",
          editor.readOnlyBinary.statusAbsent === true,
          editor.readOnlyBinary.statusAbsent,
          true,
        ),
        assert(
          "editing-surface-absent",
          editor.readOnlyBinary.editorAbsent === true,
          editor.readOnlyBinary.editorAbsent,
          true,
        ),
        assert(
          "markdown-editor-not-rendered",
          editor.editorVisible === false,
          editor.editorVisible,
          false,
        ),
      ],
      "f-image-failure": () => [
        assert(
          "placeholder-visible",
          placeholder?.visible === true,
          placeholder?.visible ?? null,
          true,
        ),
        assert(
          "placeholder-role-img",
          placeholder?.role === "img",
          placeholder?.role ?? null,
          "img",
        ),
        assert(
          "placeholder-label-contains-failed",
          typeof placeholder?.ariaLabel === "string" &&
            placeholder.ariaLabel.includes("failed"),
          placeholder?.ariaLabel ?? null,
          'contains "failed"',
        ),
        assert(
          "placeholder-text-matches-label",
          placeholder?.text === placeholder?.ariaLabel,
          placeholder?.text ?? null,
          placeholder?.ariaLabel ?? null,
        ),
        assert(
          "no-bare-broken-img-remains",
          editor.previewImageCount === 0,
          editor.previewImageCount,
          0,
        ),
        assert(
          "preview-still-rendered",
          editor.previewVisible === true,
          editor.previewVisible,
          true,
        ),
      ],
      "g-toggle": () => {
        const probe = editor.toggleProbe ?? {};
        return [
          assert(
            "probe-after-source",
            probe.afterSource?.sourcePressed === "true" &&
              probe.afterSource?.richPressed === "false" &&
              probe.afterSource?.textareaPresent === true,
            probe.afterSource ?? null,
            {
              sourcePressed: "true",
              richPressed: "false",
              textareaPresent: true,
            },
          ),
          assert(
            "probe-after-rich",
            probe.afterRich?.richPressed === "true" &&
              probe.afterRich?.sourcePressed === "false" &&
              probe.afterRich?.previewPresent === true,
            probe.afterRich ?? null,
            {
              richPressed: "true",
              sourcePressed: "false",
              previewPresent: true,
            },
          ),
          assert(
            "aria-pressed-unique-final",
            editor.sourcePressed === "true" && editor.richPressed === "false",
            { rich: editor.richPressed, source: editor.sourcePressed },
            { rich: "false", source: "true" },
          ),
          assert(
            "editing-surface-switched",
            editor.sourceVisible === true && editor.previewVisible === false,
            { source: editor.sourceVisible, preview: editor.previewVisible },
            { source: true, preview: false },
          ),
        ];
      },
      "h-large-file": () => [
        assert(
          "large-source-visible",
          editor.sourceVisible === true,
          editor.sourceVisible,
          true,
        ),
        assert(
          "large-source-complete",
          editor.sourceValueLength === largeSource.length,
          editor.sourceValueLength,
          largeSource.length,
        ),
        assert(
          "large-source-language",
          editor.sourceLanguage === "typescript" &&
            editor.sourceState === "ready",
          {
            language: editor.sourceLanguage,
            state: editor.sourceState,
          },
          { language: "typescript", state: "ready" },
        ),
        assert(
          "large-source-highlight-disabled",
          editor.sourceHighlightPresent === false,
          editor.sourceHighlightPresent,
          false,
        ),
        assert(
          "large-source-save-clean",
          editor.savePresent === true && editor.saveDisabled === true,
          { present: editor.savePresent, disabled: editor.saveDisabled },
          { present: true, disabled: true },
        ),
      ],
    };
    // Common assertions (files-panel-open, path-shown, workspace-purity) are
    // recorded alongside the per-step expectations so every counted
    // assertion appears in the audit JSON.
    const stepAssertions = [...assertions, ...(await expectations[id]())];
    const failed = stepAssertions.filter((assertion) => !assertion.pass);
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
      assertions: stepAssertions,
      focus: {
        tag: editor.focusTag,
      },
      aria: {
        statusRole: editor.statusRole,
        statusLive: editor.statusLive,
        statusText: editor.statusText,
        alertRole: editor.alertVisible ? "alert" : null,
        alertText: editor.alertText,
        saveDisabled: editor.saveDisabled,
        modeToggleRole: editor.modeToggleRole,
        richPressed: editor.richPressed,
        sourcePressed: editor.sourcePressed,
        imagePlaceholder: placeholder
          ? {
              role: placeholder.role,
              ariaLabel: placeholder.ariaLabel,
              visible: placeholder.visible,
            }
          : null,
        readOnlyBinary: editor.readOnlyBinary,
      },
      statusTrace: editor.statusTrace ?? null,
      toggleProbe: editor.toggleProbe ?? null,
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
    format: "artemis-markdown-editor-smoke",
    version: 1,
    generatedAt: new Date().toISOString(),
    candidateHead,
    expectedHead,
    launch: {
      rendererSandbox: true,
      noSandboxFlag: false,
      mode: "single-attempt-built-production-renderer",
    },
    locale,
    windowWidth,
    fixtures: {
      markdown: markdownFileName,
      binary: binaryFileName,
      largeSource: largeFileName,
      failingImageHref: "missing-reference.png",
      note: "Fixtures live in a throwaway workspace directory; only the save-error view intercepts writeWorkspaceFile in the main process.",
    },
    userDataIsolation: {
      directory: "user-data/<caseId> under the throwaway run root",
      note: "Electron user data never shares a path with the fixture workspace. The workspace-purity assertion on every case proves the workspace top level only ever holds the seeded fixtures.",
    },
    evidenceSplit: {
      productionReadOnly:
        "The production read-only gate is the binary determination: cover.png renders the binary notice with no Save button, status region, or editing surface (step e).",
      componentReadOnly:
        "The component-level readOnly contract (Save disabled, chord blocked, textarea disabled) is locked by the jsdom suites: workspace-editor-toolbar.test.tsx 'disables Save when readOnly even when dirty (read-only)', 'prevents the chord default when readOnly but never calls onSave (read-only)', 'disables the mode toggle buttons when readOnly (read-only)'; workspace-markdown-editor.test.tsx 'blocks saving and the source textarea when readOnly'; workspace-file-editor.test.tsx 'blocks saving and disables the editing surface when readOnly'.",
    },
    note: "Window height is fixed at 920 by the shared smoke harness; screenshots capture the resulting viewport. Save doubles as the retry affordance in the error state per the frozen toolbar contract (no separate Retry button).",
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
  const finalStatus = runGit(["status", "--porcelain"]);
  if (finalStatus !== initialStatus) {
    throw new Error(
      `Markdown editor verification changed tracked worktree state:\n${finalStatus}`,
    );
  }
  await writeFile(
    auditPath,
    `${JSON.stringify(auditReport, null, 2)}\n`,
    "utf8",
  );
  console.log(
    `Markdown editor smoke passed: ${results.length} cases, ${totalAssertions} assertions; exact HEAD ${candidateHead}.`,
  );
  console.log(auditPath);
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true });
}
