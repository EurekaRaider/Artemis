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
    join(repositoryRoot, "artifacts", "navigation-controls"),
);
const electronPath = createRequire(import.meta.url)("electron");
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "artemis-navigation-controls-"),
);
const workspaceDirectory = join(temporaryDirectory, "workspace");
const locale = "en";
const windowWidth = 1_440;
const themes = ["light", "dark"];
const steps = [
  {
    component: "tabs",
    context: "token-usage",
    expectedLabel: "Weekly",
    expectedParts: ["root", "tab"],
    expectedSize: "comfortable",
    id: "token-usage",
    scenario:
      "Token Usage renders public Tabs and uses real ArrowRight automatic activation with exact tab/panel relations.",
    view: "navigation-token-usage",
  },
  {
    component: "segmented-control",
    context: "workspace-editor",
    expectedLabel: "Source",
    expectedParts: ["root", "segment"],
    expectedSize: "compact",
    id: "workspace-editor",
    scenario:
      "Workspace Markdown editor renders public SegmentedControl and uses real Space activation exactly once.",
    view: "markdown-editor-navigation-toolbar",
  },
  {
    component: "segmented-control",
    context: "markdown-reader",
    expectedLabel: "Source",
    expectedParts: ["root", "segment"],
    expectedSize: "compact",
    id: "markdown-reader",
    scenario:
      "Markdown reader renders public SegmentedControl and uses real Space activation exactly once.",
    view: "markdown-editor-navigation-preview",
  },
];
const cases = steps.flatMap((step) =>
  themes.map((theme) => ({ ...step, theme, caseId: `${step.id}-${theme}` })),
);

const results = [];
await mkdir(outputDirectory, { recursive: true });
await mkdir(workspaceDirectory, { recursive: true });
await writeFile(
  join(workspaceDirectory, "NOTES.md"),
  [
    "# Artemis navigation smoke",
    "",
    "Synthetic Markdown content for the public rich/source view switch.",
    "",
    "- No provider request",
    "- No external identity",
  ].join("\n"),
  "utf8",
);

try {
  for (const testCase of cases) {
    const {
      caseId,
      component: expectedComponent,
      context,
      expectedLabel,
      expectedParts,
      expectedSize,
      id,
      scenario,
      theme,
      view,
    } = testCase;
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
      ...(view.startsWith("markdown-editor")
        ? { ARTEMIS_SMOKE_WORKSPACE: workspaceDirectory }
        : {}),
    };
    delete environment.ARTEMIS_DEV_SERVER_URL;
    delete environment.ELECTRON_RUN_AS_NODE;
    const userDataDirectory = join(
      temporaryDirectory,
      "user-data",
      `${caseId}-attempt-0`,
    );
    const userDataPreexisting = existsSync(userDataDirectory);
    const electronArguments = [
      appDirectory,
      `--user-data-dir=${userDataDirectory}`,
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
      timeout: 90_000,
    });
    if (launchResult.error || launchResult.status !== 0) {
      throw new Error(
        [
          `Navigation controls smoke case ${caseId} failed.`,
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
    const navigation = audit.navigationControls;
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
      !userDataPreexisting,
      userDataPreexisting,
      false,
    );
    assert(
      "renderer-sandbox-enabled",
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
      workspaceDirectory,
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
      "public-navigation-audit-present",
      Array.isArray(navigation?.components) && navigation.components.length > 0,
      navigation?.components?.length ?? null,
      "> 0",
    );
    assert(
      "semantic-root-tokens-resolve",
      Boolean(navigation?.rootTokens?.surfaceBase) &&
        Boolean(navigation?.rootTokens?.textPrimary),
      navigation?.rootTokens ?? null,
      "non-empty semantic tokens",
    );
    const found = navigation.components.find(
      (candidate) =>
        candidate.component === expectedComponent &&
        candidate.context === context,
    );
    assert("expected-consumer-present", Boolean(found), found ?? null, {
      component: expectedComponent,
      context,
    });
    assert(
      "required-anatomy",
      expectedParts.every((part) => found.parts.includes(part)),
      found.parts,
      expectedParts,
    );
    assert(
      "finite-size",
      found.size === expectedSize,
      found.size,
      expectedSize,
    );
    assert(
      "positive-root-geometry",
      found.geometry.width > 0 && found.geometry.height > 0,
      found.geometry,
      "positive width and height",
    );
    assert(
      "flex-root",
      ["flex", "inline-flex"].includes(found.computed.display),
      found.computed.display,
      "flex or inline-flex after flex-item blockification",
    );
    assert("no-portal", found.portalCount === 0, found.portalCount, 0);
    assert(
      "named-root-role",
      Boolean(found.groupLabel) &&
        found.role === (expectedComponent === "tabs" ? "tablist" : "group"),
      { groupLabel: found.groupLabel, role: found.role },
      {
        groupLabel: "non-empty",
        role: expectedComponent === "tabs" ? "tablist" : "group",
      },
    );
    assert(
      "positive-button-geometry",
      found.buttons.length >= 2 &&
        found.buttons.every(
          (button) => button.geometry.width > 0 && button.geometry.height > 0,
        ),
      found.buttons.map((button) => button.geometry),
      "at least two positive button rectangles",
    );
    const selected = found.buttons.filter(
      (button) =>
        button.ariaSelected === "true" || button.ariaPressed === "true",
    );
    assert(
      "single-selected-button",
      selected.length === 1,
      selected,
      "one selected button",
    );
    assert(
      "expected-selection",
      selected[0]?.label === expectedLabel,
      selected[0]?.label ?? null,
      expectedLabel,
    );
    assert(
      "selected-state-redundant",
      selected[0]?.state === "selected" &&
        selected[0]?.computed.fontWeight !==
          found.buttons.find((button) => button !== selected[0])?.computed
            .fontWeight,
      {
        selectedState: selected[0]?.state,
        selectedWeight: selected[0]?.computed.fontWeight,
        peerWeight: found.buttons.find((button) => button !== selected[0])
          ?.computed.fontWeight,
      },
      "selected data-state and distinct font weight",
    );
    assert(
      "active-focus-visible",
      navigation.documentHasFocus === true &&
        selected[0]?.documentActive === true &&
        selected[0]?.computed.outlineStyle !== "none" &&
        selected[0]?.computed.outlineWidth !== "0px",
      {
        documentHasFocus: navigation.documentHasFocus,
        documentActive: selected[0]?.documentActive,
        outlineStyle: selected[0]?.computed.outlineStyle,
        outlineWidth: selected[0]?.computed.outlineWidth,
      },
      "selected button active with visible outline",
    );
    assert(
      "native-button-semantics",
      found.buttons.every((button) => button.disabled === false),
      found.buttons.map((button) => ({
        label: button.label,
        disabled: button.disabled,
      })),
      "all visible smoke buttons enabled",
    );
    if (expectedComponent === "tabs") {
      assert(
        "tab-relations",
        found.buttons.every(
          (button) =>
            button.role === "tab" &&
            Boolean(button.id) &&
            Boolean(button.ariaControls),
        ),
        found.buttons,
        "tab role with unique id and aria-controls",
      );
      assert(
        "roving-tabindex",
        found.buttons.filter((button) => button.tabIndex === 0).length === 1 &&
          selected[0]?.tabIndex === 0,
        found.buttons.map((button) => ({
          label: button.label,
          tabIndex: button.tabIndex,
        })),
        "only selected tab at tabindex 0",
      );
    } else {
      assert(
        "pressed-native-tab-order",
        found.buttons.every(
          (button) =>
            button.role === null &&
            button.tabIndex === 0 &&
            ["true", "false"].includes(button.ariaPressed),
        ),
        found.buttons,
        "native buttons in Tab order with aria-pressed",
      );
    }
    const interaction = navigation.interaction;
    assert(
      "interaction-root-stable",
      interaction?.rootStable === true,
      interaction,
      true,
    );
    assert(
      "interaction-selection-and-focus",
      interaction?.selectedText === expectedLabel &&
        interaction?.activeText === expectedLabel,
      interaction,
      expectedLabel,
    );
    if (expectedComponent === "tabs") {
      assert(
        "tabpanel-relation",
        interaction?.panelId === "token-usage-weekly-panel" &&
          interaction?.panelLabelledBy === "token-usage-weekly-tab",
        interaction,
        {
          panelId: "token-usage-weekly-panel",
          panelLabelledBy: "token-usage-weekly-tab",
        },
      );
    } else {
      assert(
        "space-click-once",
        interaction?.clickCount === 1,
        interaction?.clickCount,
        1,
      );
      assert(
        "source-surface-present",
        interaction?.sourceSurfacePresent === true,
        interaction?.sourceSurfacePresent,
        true,
      );
    }

    results.push({
      id,
      view,
      theme,
      scenario,
      screenshot: `${caseId}.png`,
      screenshotBytes,
      rendererSandboxEnabled: true,
      assertions,
      component: {
        component: found.component,
        context: found.context,
        className: found.className,
        state: found.state,
      },
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
    format: "artemis-navigation-controls-smoke",
    version: 1,
    generatedAt: new Date().toISOString(),
    locale,
    windowWidth,
    fixtures: {
      tokenUsage:
        "Synthetic local usage events only; no provider request or external identity.",
      markdown:
        "Synthetic throwaway NOTES.md workspace only; no provider request, spawn, or dial-out.",
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
    `Navigation controls smoke passed: ${results.length} cases, ${totalAssertions} assertions.`,
  );
  console.log(reportPath);
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true });
}
