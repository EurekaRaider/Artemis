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
    join(repositoryRoot, "artifacts", "form-controls"),
);
const electronPath = createRequire(import.meta.url)("electron");
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "artemis-form-controls-"),
);
const locale = "en";
const windowWidth = 1_440;
const themes = ["light", "dark"];
const steps = [
  {
    id: "archive",
    view: "form-controls-archive",
    scenario:
      "Archive renders the public SearchField, accepts a controlled query, and retains a visible focus ring.",
  },
  {
    id: "settings",
    view: "form-controls-settings",
    scenario:
      "Settings Built-in renders the public TextField and Select consumers; searchable Select preserves IME Enter and commits the next keyboard option once.",
  },
  {
    id: "settings-custom",
    view: "form-controls-settings-custom",
    scenario:
      "Settings Custom renders the public Checkbox consumer, performs one controlled toggle, and retains its public focus-visible treatment.",
  },
  {
    id: "resource",
    view: "icon-sizing-resource-manage",
    scenario:
      "Resource Center renders the public Switch against a synthetic disabled MCP fixture without spawning or dialing out.",
  },
  {
    id: "composer",
    view: "form-controls-composer",
    scenario:
      "Composer renders its compact public Select and keyboard-opens an in-viewport, right-aligned menu without remounting.",
  },
  {
    id: "mcp-editor",
    view: "mcp-editor-form-controls",
    scenario:
      "MCP editor renders its comfortable public Select and keyboard-opens an in-viewport menu without remounting.",
  },
  {
    id: "review",
    view: "turn-changes-form-controls",
    scenario:
      "Review renders its compact public Select and keyboard-opens an in-viewport, left-aligned menu without remounting.",
  },
];
const cases = steps.flatMap((step) =>
  themes.map((theme) => ({ ...step, theme, caseId: `${step.id}-${theme}` })),
);

const results = [];
await mkdir(outputDirectory, { recursive: true });
try {
  for (const testCase of cases) {
    const { id, view, theme, caseId, scenario } = testCase;
    const screenshotPath = join(outputDirectory, `${caseId}.png`);
    const accessibilityPath = join(outputDirectory, `${caseId}.a11y.json`);
    await rm(screenshotPath, { force: true });
    await rm(accessibilityPath, { force: true });
    const environment = {
      ...process.env,
      ARTEMIS_SMOKE_ACCESSIBILITY: accessibilityPath,
      ARTEMIS_SMOKE_LOCALE: locale,
      ARTEMIS_SMOKE_SCREENSHOT: screenshotPath,
      ARTEMIS_SMOKE_SETTLE_DELAY: "500",
      ARTEMIS_SMOKE_THEME: theme,
      ARTEMIS_SMOKE_VIEW: view,
      ARTEMIS_SMOKE_WINDOW_WIDTH: String(windowWidth),
    };
    delete environment.ARTEMIS_DEV_SERVER_URL;
    delete environment.ELECTRON_RUN_AS_NODE;
    const userDataDirectory = (attempt) =>
      join(
        temporaryDirectory,
        "user-data",
        "form-controls",
        `${caseId}-attempt-${attempt}`,
      );
    const launch = (attempt) => {
      const userDataPreexisting = existsSync(userDataDirectory(attempt));
      const electronArguments = [
        appDirectory,
        `--user-data-dir=${userDataDirectory(attempt)}`,
        "--disable-gpu",
        "--disable-gpu-compositing",
        "--disable-gpu-sandbox",
        "--use-angle=swiftshader",
      ];
      const result = spawnSync(electronPath, electronArguments, {
        cwd: appDirectory,
        encoding: "utf8",
        env: environment,
        maxBuffer: 2 * 1024 * 1024,
        timeout: 90_000,
      });
      return {
        result,
        rendererSandboxEnabled: !electronArguments.includes("--no-sandbox"),
        userDataPreexisting,
      };
    };
    const launchOutcome = launch(0);
    const launchResult = launchOutcome.result;
    if (launchResult.error || launchResult.status !== 0) {
      throw new Error(
        [
          `Form controls smoke case ${caseId} failed.`,
          `status=${String(launchResult.status)} signal=${String(launchResult.signal)}`,
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
    const formControls = audit.formControls;
    const assertions = [];
    const assert = (name, pass, actual, expected) => {
      const assertion = { name, pass, actual, expected };
      assertions.push(assertion);
      if (!pass) {
        throw new Error(
          `${caseId} assertion failed: ${name}; actual ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}.`,
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
      "renderer-sandbox-enabled",
      launchOutcome.rendererSandboxEnabled === true,
      launchOutcome.rendererSandboxEnabled,
      true,
    );
    assert(
      "screenshot-not-empty",
      screenshotBytes > 10_000,
      screenshotBytes,
      "> 10000 bytes",
    );
    assert(
      "window-width-applied",
      typeof audit.windowInnerWidth === "number" &&
        audit.windowInnerWidth >= 1_400,
      audit.windowInnerWidth,
      ">= 1400",
    );
    assert(
      "document-identity",
      audit.title === "Artemis" && audit.documentLanguage === locale,
      { title: audit.title, language: audit.documentLanguage },
      { title: "Artemis", language: locale },
    );
    assert(
      "audit-issues-empty",
      Array.isArray(audit.issues) && audit.issues.length === 0,
      audit.issues,
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
      "public-form-audit-present",
      Array.isArray(formControls?.components) &&
        formControls.components.length > 0,
      formControls?.components?.length ?? null,
      "> 0",
    );
    assert(
      "semantic-root-tokens-resolve",
      Boolean(formControls.rootTokens.surfaceBase) &&
        Boolean(formControls.rootTokens.textPrimary),
      formControls.rootTokens,
      "non-empty semantic tokens",
    );

    const component = (name, className, context) =>
      formControls.components.find(
        (candidate) =>
          candidate.component === name &&
          (!context || candidate.context === context) &&
          (!className ||
            candidate.className?.split(/\s+/u).includes(className)),
      );
    const verifyComponent = (name, expectedParts, className, context) => {
      const found = component(name, className, context);
      assert(`${name}-present`, Boolean(found), found ?? null, "present");
      assert(
        `${name}-required-anatomy`,
        expectedParts.every((part) => found.parts.includes(part)),
        found.parts,
        expectedParts,
      );
      assert(
        `${name}-positive-geometry`,
        found.geometry.width > 0 && found.geometry.height > 0,
        found.geometry,
        "positive width and height",
      );
      assert(
        `${name}-no-portal`,
        found.portalCount === 0,
        found.portalCount,
        0,
      );
      assert(
        `${name}-semantic-styles-resolve`,
        Boolean(found.computed?.backgroundColor) &&
          Boolean(found.computed?.color),
        found.computed,
        "resolved computed colors",
      );
      return found;
    };
    const verifyOpenMenu = (prefix, menu) => {
      assert(
        `${prefix}-menu-positive-geometry`,
        menu?.geometry.width > 0 && menu?.geometry.height > 0,
        menu?.geometry ?? null,
        "positive width and height",
      );
      assert(
        `${prefix}-menu-within-viewport`,
        menu?.withinViewport === true,
        menu ?? null,
        true,
      );
      assert(
        `${prefix}-menu-layering`,
        Number(menu?.zIndex) >= 80,
        menu?.zIndex ?? null,
        ">= 80",
      );
      assert(
        `${prefix}-menu-overflow-contract`,
        menu?.overflowX === "hidden" &&
          menu?.overflowY === "hidden" &&
          menu?.listboxOverflowY === "auto",
        menu ?? null,
        { overflowX: "hidden", overflowY: "hidden", listboxOverflowY: "auto" },
      );
      assert(
        `${prefix}-menu-styles-resolve`,
        Boolean(menu?.backgroundColor) &&
          menu?.borderStyle === "solid" &&
          menu?.borderWidth !== "0px",
        menu ?? null,
        "resolved background and non-zero solid border",
      );
    };
    const verifyFocusEvidence = (prefix, found, visual = false) => {
      const outlineStyle = visual
        ? found.focus.visualOutlineStyle
        : found.focus.outlineStyle;
      const outlineWidth = visual
        ? found.focus.visualOutlineWidth
        : found.focus.outlineWidth;
      const activeVisible =
        formControls.documentHasFocus === true &&
        found.control.documentActive === true &&
        outlineStyle !== "none" &&
        outlineWidth !== "0px";
      const foregroundUnavailable =
        audit.windowFocused === false &&
        formControls.documentHasFocus === false &&
        found.control.tabIndex >= 0;
      assert(
        `${prefix}-focus-evidence`,
        activeVisible || foregroundUnavailable,
        {
          windowFocused: audit.windowFocused,
          documentHasFocus: formControls.documentHasFocus,
          documentActive: found.control.documentActive,
          tabIndex: found.control.tabIndex,
          outlineStyle,
          outlineWidth,
        },
        "active target with visible outline, or an explicitly inactive OS foreground with a focusable target",
      );
    };

    if (id === "archive") {
      const search = verifyComponent(
        "search-field",
        ["root", "label", "icon", "control"],
        "archive-search",
        "archive",
      );
      assert(
        "archive-native-search",
        search.control.type === "search",
        search.control,
        {
          type: "search",
        },
      );
      assert(
        "archive-controlled-value",
        formControls.interaction?.searchValue === "synthetic archive query" &&
          search.control.value === "synthetic archive query",
        {
          interaction: formControls.interaction,
          controlValue: search.control.value,
        },
        "synthetic archive query",
      );
      assert(
        "archive-root-stable",
        formControls.interaction?.rootStable === true,
        formControls.interaction,
        true,
      );
      verifyFocusEvidence("archive", search);
    } else if (id === "settings") {
      const field = verifyComponent(
        "text-field",
        ["root", "label", "control"],
        "settings-field",
        "settings",
      );
      const select = verifyComponent(
        "select",
        ["root", "label", "trigger"],
        "codex-select",
        "settings",
      );
      assert(
        "settings-number-field",
        field.control.type === "number",
        field.control,
        {
          type: "number",
        },
      );
      verifyFocusEvidence("settings-field", field);
      assert(
        "settings-select-semantics",
        select.control.tagName === "button" &&
          select.control.ariaExpanded === "false",
        select.control,
        { tagName: "button", ariaExpanded: "false" },
      );
      const interaction = formControls.interaction;
      assert(
        "settings-ime-enter-preserved",
        interaction?.optionCount > 1 &&
          interaction?.composedMenuOpen === true &&
          interaction?.beforeText === interaction?.composedText,
        interaction,
        "more than one option, menu open, selection unchanged during composition",
      );
      assert(
        "settings-keyboard-commit-once",
        interaction?.committedMenuClosed === true &&
          interaction?.committedText !== interaction?.beforeText &&
          interaction?.selectRootStable === true,
        interaction,
        "menu closed, next option committed, root stable",
      );
      verifyOpenMenu("settings", interaction?.openedMenu);
    } else if (id === "settings-custom") {
      const checkbox = verifyComponent(
        "checkbox",
        ["root", "control", "indicator", "label"],
        undefined,
        "settings",
      );
      assert(
        "settings-checkbox-native",
        checkbox.control.tagName === "input" &&
          checkbox.control.type === "checkbox",
        checkbox.control,
        { tagName: "input", type: "checkbox" },
      );
      assert(
        "settings-checkbox-controlled-toggle",
        formControls.interaction?.beforeChecked === false &&
          formControls.interaction?.afterChecked === true &&
          formControls.interaction?.checkboxRootStable === true &&
          checkbox.control.checked === true,
        { interaction: formControls.interaction, control: checkbox.control },
        "false to true once with a stable root",
      );
      verifyFocusEvidence("settings-checkbox", checkbox, true);
    } else if (id === "resource") {
      const toggle = verifyComponent(
        "switch",
        ["root", "control", "track", "thumb", "label"],
        "resource-switch",
        "resource",
      );
      assert(
        "resource-native-switch",
        toggle.control.tagName === "input" &&
          toggle.control.type === "checkbox" &&
          toggle.control.role === "switch",
        toggle.control,
        { tagName: "input", type: "checkbox", role: "switch" },
      );
    } else {
      const context =
        id === "composer"
          ? "composer"
          : id === "mcp-editor"
            ? "mcp-editor"
            : "review";
      const select = verifyComponent(
        "select",
        ["root", "label", "trigger", "value", "indicator", "menu", "listbox"],
        "codex-select",
        context,
      );
      const expectedSize = id === "mcp-editor" ? "comfortable" : "compact";
      assert(
        `${id}-size-contract`,
        select.size === expectedSize,
        select.size,
        expectedSize,
      );
      assert(
        `${id}-keyboard-open-stable`,
        formControls.interaction?.keyboardOpened === true &&
          formControls.interaction?.menuOpen === true &&
          formControls.interaction?.rootStable === true &&
          select.control.ariaExpanded === "true",
        {
          interaction: formControls.interaction,
          ariaExpanded: select.control.ariaExpanded,
        },
        "keyboard opened, menu open, root stable, aria-expanded true",
      );
      verifyOpenMenu(id, select.menu);
      if (id === "composer") {
        assert(
          "composer-menu-right-aligned",
          select.menu?.inlineEndDelta <= 1,
          select.menu?.inlineEndDelta ?? null,
          "<= 1px",
        );
      }
      if (id === "review") {
        assert(
          "review-menu-left-aligned",
          select.menu?.inlineStartDelta <= 1,
          select.menu?.inlineStartDelta ?? null,
          "<= 1px",
        );
      }
    }

    results.push({
      id,
      view,
      theme,
      scenario,
      screenshot: `${caseId}.png`,
      screenshotBytes,
      rendererSandboxEnabled: launchOutcome.rendererSandboxEnabled,
      focusEnvironment: {
        windowFocused: audit.windowFocused,
        documentHasFocus: formControls.documentHasFocus,
      },
      assertions,
      components: formControls.components.map(
        ({ component, context, className, state }) => ({
          component,
          context,
          className,
          state,
        }),
      ),
    });
    console.log(
      `PASS ${caseId} (${assertions.length} assertions, screenshot ${screenshotBytes} bytes)`,
    );
  }

  const totalAssertions = results.reduce(
    (sum, result) => sum + result.assertions.length,
    0,
  );
  const report = {
    format: "artemis-form-controls-smoke",
    version: 1,
    generatedAt: new Date().toISOString(),
    locale,
    windowWidth,
    fixtures: {
      archive: "Fresh empty local store; query identity is synthetic.",
      settings:
        "Fresh bundled model catalog; selecting a model performs no provider request.",
      resource:
        "Synthetic disabled MCP server with an impossible stdio command; zero spawn and zero dial-out.",
      composer:
        "Synthetic local Artemis project and completed thread; no agent or provider request.",
      mcpEditor:
        "Synthetic disabled MCP fixtures; zero spawn and zero dial-out.",
      review:
        "Synthetic local Artemis project and completed turn-change fixture; no agent or provider request.",
    },
    summary: {
      cases: results.length,
      passed: results.length,
      failed: 0,
      assertions: totalAssertions,
    },
    results,
  };
  const reportPath = join(outputDirectory, "report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(
    `Form controls smoke passed: ${results.length} cases, ${totalAssertions} assertions.`,
  );
  console.log(reportPath);
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true });
}
