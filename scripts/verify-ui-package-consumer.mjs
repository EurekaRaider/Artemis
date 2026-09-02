import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const consumer = await mkdtemp(join(tmpdir(), "artemis-ui-consumer-"));

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_cache: join(consumer, ".npm-cache"),
    },
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with ${String(result.status)}\n${result.stdout}${result.stderr}`,
    );
  }
  return result.stdout.trim();
}

async function pack(packagePath, auditPublicFiles) {
  const output = run(npm, [
    "pack",
    "--json",
    "--pack-destination",
    consumer,
    join(root, packagePath),
  ]);
  const result = JSON.parse(output)[0];
  if (auditPublicFiles) {
    const paths = result.files.map((entry) => entry.path);
    for (const path of paths) {
      if (path !== "package.json" && !path.startsWith("dist/")) {
        throw new Error(
          `${packagePath} tarball contains a non-artifact file: ${path}`,
        );
      }
      if (/(^|\/)(?:src|test|tests)(\/|$)|\.env(?:\.|$)/u.test(path)) {
        throw new Error(
          `${packagePath} tarball leaks source/test/secret path: ${path}`,
        );
      }
    }
    for (const expected of auditPublicFiles) {
      if (!paths.includes(expected)) {
        throw new Error(`${packagePath} tarball is missing ${expected}`);
      }
    }
  }
  return join(consumer, result.filename);
}

async function textFilesBelow(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await textFilesBelow(path)));
    else if (/\.(?:css|d\.ts|js|json|map)$/u.test(entry.name)) files.push(path);
  }
  return files;
}

try {
  const tarballs = [
    await pack("packages/theme-contract", [
      "dist/index.js",
      "dist/index.d.ts",
      "dist/schema/manifest.schema.json",
      "dist/schema/tokens.schema.json",
      "dist/schema/integrity.schema.json",
    ]),
    await pack("packages/ui", [
      "dist/index.js",
      "dist/index.d.ts",
      "dist/conformance.js",
      "dist/conformance.d.ts",
      "dist/actions.js",
      "dist/actions.d.ts",
      "dist/forms.js",
      "dist/forms.d.ts",
      "dist/feedback.js",
      "dist/feedback.d.ts",
      "dist/layout.js",
      "dist/layout.d.ts",
      "dist/navigation.js",
      "dist/navigation.d.ts",
      "dist/patterns.js",
      "dist/patterns.d.ts",
      "dist/styles.css",
    ]),
    await pack("packages/theme-artemis", [
      "dist/index.js",
      "dist/index.d.ts",
      "dist/manifest.json",
      "dist/tokens.light.json",
      "dist/tokens.dark.json",
      "dist/tokens.contrast.json",
      "dist/integrity.json",
      "dist/theme.css",
    ]),
    await pack("node_modules/react"),
    await pack("node_modules/react-dom"),
    await pack("node_modules/scheduler"),
  ];

  await writeFile(
    join(consumer, "package.json"),
    `${JSON.stringify({ name: "artemis-ui-consumer", private: true, type: "module" }, null, 2)}\n`,
    "utf8",
  );
  run(
    npm,
    [
      "install",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      ...tarballs,
    ],
    consumer,
  );

  await writeFile(
    join(consumer, "consumer.ts"),
    `import { UI_CONTRACT_VERSION, validateComponentContract, type ArtemisUiRootAttributes, type ComponentContract } from "@artemis/ui";\nimport { ACTION_COMPONENT_CONTRACTS, Button, IconButton, type ActionIconSize, type ActionTone } from "@artemis/ui/actions";\nimport { CONFORMANCE_PROBE_CONTRACT, ConformanceProbe } from "@artemis/ui/conformance";\nimport { FEEDBACK_COMPONENT_CONTRACTS, InlineNotice, Toast, type FeedbackTone } from "@artemis/ui/feedback";\nimport { FORM_COMPONENT_CONTRACTS, Checkbox, SearchField, Select, Switch, TextField, type FormControlSize, type SelectOption } from "@artemis/ui/forms";\nimport { LAYOUT_COMPONENT_CONTRACTS, PanelHeader, SplitPane, type LayoutState } from "@artemis/ui/layout";\nimport { NAVIGATION_COMPONENT_CONTRACTS, SegmentedControl, Tabs, type NavigationControlSize, type TabOption } from "@artemis/ui/navigation";\nimport { PATTERN_COMPONENT_CONTRACTS, ApprovalCard, TaskPlan, ToolActivity, type PatternState } from "@artemis/ui/patterns";\nimport { validateSkinManifest, type SkinManifest } from "@artemis/theme-contract";\nimport { artemisThemeManifest } from "@artemis/theme-artemis";\nconst attributes: ArtemisUiRootAttributes = {\n  "data-artemis-skin": "com.artemis.default",\n  "data-artemis-theme": "light",\n  "data-artemis-contrast": "normal",\n};\nconst manifest: SkinManifest = artemisThemeManifest;\nconst contract: ComponentContract = CONFORMANCE_PROBE_CONTRACT;\nconst iconSize: ActionIconSize = "xl";\nconst tone: ActionTone = "success";\nconst feedbackTone: FeedbackTone = "warning";\nconst layoutState: LayoutState = "ready";\nconst patternState: PatternState = "pending";\nconst formSize: FormControlSize = "comfortable";\nconst navigationSize: NavigationControlSize = "compact";\nconst option: SelectOption<"one"> = { value: "one", label: "One" };\nconst tabOption: TabOption<"one"> = { id: "one-tab", panelId: "one-panel", value: "one", label: "One" };\nvoid ConformanceProbe;\nvoid Button;\nvoid IconButton;\nvoid InlineNotice;\nvoid Toast;\nvoid PanelHeader;\nvoid SplitPane;\nvoid ApprovalCard;\nvoid TaskPlan;\nvoid ToolActivity;\nvoid Checkbox;\nvoid SearchField;\nvoid Select;\nvoid Switch;\nvoid TextField;\nvoid SegmentedControl;\nvoid Tabs;\nif (UI_CONTRACT_VERSION !== 1 || !validateSkinManifest(manifest).valid || !validateComponentContract(contract).valid || attributes["data-artemis-theme"] !== "light" || ACTION_COMPONENT_CONTRACTS.icon.sizes.at(-1) !== iconSize || ACTION_COMPONENT_CONTRACTS.status.tones?.at(2) !== tone || FEEDBACK_COMPONENT_CONTRACTS.toast.tones?.at(3) !== feedbackTone || LAYOUT_COMPONENT_CONTRACTS.toolbar.states.at(0) !== layoutState || PATTERN_COMPONENT_CONTRACTS.approvalCard.states.at(0) !== patternState || FORM_COMPONENT_CONTRACTS.textField.sizes.at(-1) !== formSize || NAVIGATION_COMPONENT_CONTRACTS.tabs.sizes.at(0) !== navigationSize || option.value !== "one" || tabOption.value !== "one") throw new Error("invalid contract");\n`,
    "utf8",
  );
  await writeFile(
    join(consumer, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: "ES2024",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          skipLibCheck: true,
          noEmit: true,
        },
        include: ["consumer.ts"],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  run(join(root, "node_modules/.bin/tsc"), ["-p", "tsconfig.json"], consumer);

  await writeFile(
    join(consumer, "consumer.mjs"),
    `import { createHash } from "node:crypto";\nimport { readFile } from "node:fs/promises";\nimport { fileURLToPath } from "node:url";\nimport { createElement } from "react";\nimport { renderToStaticMarkup } from "react-dom/server";\nimport { UI_CONTRACT_VERSION, validateComponentContract } from "@artemis/ui";\nimport { ACTION_COMPONENT_CONTRACTS, Badge, Button, IconButton, Status } from "@artemis/ui/actions";\nimport { CONFORMANCE_PROBE_CONTRACT, ConformanceProbe } from "@artemis/ui/conformance";\nimport { FORM_COMPONENT_CONTRACTS, Checkbox, SearchField, Select, Switch, TextField } from "@artemis/ui/forms";\nimport { validateSkinIntegrity, validateSkinPackage } from "@artemis/theme-contract";\nimport { artemisThemeManifest, artemisTokenDocuments } from "@artemis/theme-artemis";\nconst publicPaths = [\n  "@artemis/ui/styles.css",\n  "@artemis/theme-contract/schema/manifest.json",\n  "@artemis/theme-contract/schema/tokens.json",\n  "@artemis/theme-contract/schema/integrity.json",\n  "@artemis/theme-artemis/manifest.json",\n  "@artemis/theme-artemis/tokens.light.json",\n  "@artemis/theme-artemis/tokens.dark.json",\n  "@artemis/theme-artemis/tokens.contrast.json",\n  "@artemis/theme-artemis/integrity.json",\n  "@artemis/theme-artemis/theme.css",\n];\nfor (const path of publicPaths) {\n  const content = await readFile(fileURLToPath(import.meta.resolve(path)), "utf8");\n  if (content.length === 0) throw new Error(\`empty public export: \${path}\`);\n}\nif (!validateSkinPackage({ manifest: artemisThemeManifest, tokenDocuments: artemisTokenDocuments }).valid) throw new Error("skin validation failed");\nconst integrity = JSON.parse(await readFile(fileURLToPath(import.meta.resolve("@artemis/theme-artemis/integrity.json")), "utf8"));\nif (!validateSkinIntegrity(integrity, artemisThemeManifest).valid) throw new Error("integrity validation failed");\nfor (const [file, expectedHash] of Object.entries(integrity.files)) {\n  const content = await readFile(fileURLToPath(import.meta.resolve("@artemis/theme-artemis/" + file)));\n  const actualHash = createHash("sha256").update(content).digest("hex");\n  if (actualHash !== expectedHash) throw new Error("integrity hash mismatch: " + file);\n}\nconst probeMarkup = renderToStaticMarkup(createElement(ConformanceProbe, { label: "Outside probe", defaultValue: "peer-ok" }));\nconst actionMarkup = [\n  renderToStaticMarkup(createElement(Button, { label: "Button outside" }, "Button")),\n  renderToStaticMarkup(createElement(IconButton, { label: "Outside icon button", icon: createElement("svg") })),\n  renderToStaticMarkup(createElement(Badge, { tone: "success" }, "Complete")),\n  renderToStaticMarkup(createElement(Status, { live: "polite" }, "Running")),\n].join("");\nconst formMarkup = [\n  renderToStaticMarkup(createElement(TextField, { label: "Outside field", defaultValue: "value" })),\n  renderToStaticMarkup(createElement(SearchField, { label: "Outside search", defaultValue: "query" })),\n  renderToStaticMarkup(createElement(Select, { label: "Outside select", value: "one", options: [{ value: "one", label: "One" }], onValueChange() {} })),\n  renderToStaticMarkup(createElement(Checkbox, { label: "Outside checkbox", defaultChecked: true })),\n  renderToStaticMarkup(createElement(Switch, { label: "Outside switch", defaultChecked: true })),\n].join("");\nif (UI_CONTRACT_VERSION !== 1 || !validateComponentContract(CONFORMANCE_PROBE_CONTRACT).valid || !Object.isFrozen(ACTION_COMPONENT_CONTRACTS) || !Object.isFrozen(FORM_COMPONENT_CONTRACTS) || !probeMarkup.includes('data-artemis-component="conformance-probe"') || !probeMarkup.includes('data-part="control"') || !actionMarkup.includes('data-artemis-component="button"') || !actionMarkup.includes('data-artemis-component="icon-button"') || !actionMarkup.includes('data-artemis-component="badge"') || !actionMarkup.includes('data-artemis-component="status"') || !formMarkup.includes('data-artemis-component="text-field"') || !formMarkup.includes('data-artemis-component="search-field"') || !formMarkup.includes('data-artemis-component="select"') || !formMarkup.includes('data-artemis-component="checkbox"') || !formMarkup.includes('data-artemis-component="switch"')) throw new Error("peer/component resolution failed");\nconsole.log("outside consumer resolved JS, types, actions/conformance/forms subpaths, CSS, schema, integrity, token data, and React peers");\n`,
    "utf8",
  );
  run(process.execPath, ["consumer.mjs"], consumer);
  await writeFile(
    join(consumer, "navigation-consumer.mjs"),
    `import { createElement } from "react";\nimport { renderToStaticMarkup } from "react-dom/server";\nimport { NAVIGATION_COMPONENT_CONTRACTS, SegmentedControl, Tabs } from "@artemis/ui/navigation";\nconst tabs = renderToStaticMarkup(createElement(Tabs, { label: "Outside tabs", value: "one", onValueChange() {}, options: [{ id: "outside-tab", panelId: "outside-panel", value: "one", label: "One" }] }));\nconst segmented = renderToStaticMarkup(createElement(SegmentedControl, { label: "Outside segmented", value: "one", onValueChange() {}, options: [{ value: "one", label: "One" }] }));\nif (!Object.isFrozen(NAVIGATION_COMPONENT_CONTRACTS) || !tabs.includes('data-artemis-component="tabs"') || !tabs.includes('aria-controls="outside-panel"') || !segmented.includes('data-artemis-component="segmented-control"') || !segmented.includes('aria-pressed="true"')) throw new Error("navigation peer/component resolution failed");\n`,
    "utf8",
  );
  run(process.execPath, ["navigation-consumer.mjs"], consumer);
  await writeFile(
    join(consumer, "feedback-layout-consumer.mjs"),
    `import { createElement } from "react";\nimport { renderToStaticMarkup } from "react-dom/server";\nimport { FEEDBACK_COMPONENT_CONTRACTS, EmptyState, InlineNotice, LoadingState, Toast } from "@artemis/ui/feedback";\nimport { LAYOUT_COMPONENT_CONTRACTS, ListRow, PanelHeader, ScrollArea, SplitPane, Toolbar } from "@artemis/ui/layout";\nconst feedback = [\n  renderToStaticMarkup(createElement(InlineNotice, { tone: "success" }, "Connected")),\n  renderToStaticMarkup(createElement(Toast, { tone: "warning" }, "Review required")),\n  renderToStaticMarkup(createElement(EmptyState, { title: "No tasks", description: "Create one" })),\n  renderToStaticMarkup(createElement(LoadingState, { label: "Loading" })),\n].join("");\nconst layout = [\n  renderToStaticMarkup(createElement(Toolbar, { label: "Outside toolbar", actions: createElement("button", null, "Run") }, "Workspace")),\n  renderToStaticMarkup(createElement(ListRow, { label: "Outside row", selected: true })),\n  renderToStaticMarkup(createElement(PanelHeader, { title: "Outside panel" })),\n  renderToStaticMarkup(createElement(ScrollArea, { label: "Outside scroll" }, "Content")),\n  renderToStaticMarkup(createElement(SplitPane, { label: "Outside resize", minimumSize: 120, maximumSize: 360, size: 200, onSizeChange() {}, primary: "One", secondary: "Two" })),\n].join("");\nif (!Object.isFrozen(FEEDBACK_COMPONENT_CONTRACTS) || !Object.isFrozen(LAYOUT_COMPONENT_CONTRACTS) || !feedback.includes('data-artemis-component="inline-notice"') || !feedback.includes('data-artemis-component="toast"') || !feedback.includes('data-artemis-component="empty-state"') || !feedback.includes('data-artemis-component="loading-state"') || !layout.includes('data-artemis-component="toolbar"') || !layout.includes('data-artemis-component="list-row"') || !layout.includes('data-artemis-component="panel-header"') || !layout.includes('data-artemis-component="scroll-area"') || !layout.includes('role="separator"')) throw new Error("feedback/layout peer/component resolution failed");\n`,
    "utf8",
  );
  run(process.execPath, ["feedback-layout-consumer.mjs"], consumer);
  await writeFile(
    join(consumer, "patterns-consumer.mjs"),
    `import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PATTERN_COMPONENT_CONTRACTS, ApprovalCard, ContextUsage, ResultDisclosure, RunModeControl, TaskPlan, ToolActivity, TurnStatus, UserInput } from "@artemis/ui/patterns";
const approval = renderToStaticMarkup(createElement(ApprovalCard, { actions: createElement("button", null, "Approve"), label: "Approval", state: "pending", statusLabel: "Pending", title: "Run command" }));
const tool = renderToStaticMarkup(createElement(ToolActivity, { collapseLabel: "Collapse", expandLabel: "Expand", label: "Tool", state: "completed", statusLabel: "Completed", summary: "Read files" }, "Details"));
const plan = renderToStaticMarkup(createElement(TaskPlan, { collapseLabel: "Collapse", currentStepId: "one", expandLabel: "Expand", label: "Step 1", progressLabel: "Step 1", state: "active", statusLabel: "In progress", steps: [{ id: "one", label: "Inspect", status: "pending", statusLabel: "Not started" }], stepsLabel: "Task steps" }));
const other = [
  renderToStaticMarkup(createElement(RunModeControl, { label: "Mode", onValueChange() {}, options: [{ accessibleLabel: "Plan", label: "Plan", value: "plan" }], statusLabel: "Ready", value: "plan" })),
  renderToStaticMarkup(createElement(ContextUsage, { label: "Context", percent: 25, statusLabel: "Ready", valueLabel: "25%" })),
  renderToStaticMarkup(createElement(UserInput, { label: "Input", onOptionSelect() {}, options: [{ accessibleLabel: "One", id: "one", label: "One" }], question: "Choose", state: "pending", statusLabel: "Pending" })),
  renderToStaticMarkup(createElement(TurnStatus, { label: "Turn", state: "running", statusLabel: "Working" })),
  renderToStaticMarkup(createElement(ResultDisclosure, { collapseLabel: "Collapse", expandLabel: "Expand", label: "Result", state: "completed", statusLabel: "Completed", summary: "Complete" }, "Result")),
].join("");
if (!Object.isFrozen(PATTERN_COMPONENT_CONTRACTS) || !approval.includes('data-artemis-component="approval-card"') || !tool.includes('data-artemis-component="tool-activity"') || !plan.includes('data-artemis-component="task-plan"') || !other.includes('data-artemis-component="run-mode-control"') || !other.includes('data-artemis-component="context-usage"') || !other.includes('data-artemis-component="user-input"') || !other.includes('data-artemis-component="turn-status"') || !other.includes('data-artemis-component="result-disclosure"')) throw new Error("pattern peer/component resolution failed");
`,
    "utf8",
  );
  run(process.execPath, ["patterns-consumer.mjs"], consumer);
  run(npm, ["ls", "--all", "react", "react-dom"], consumer);

  await writeFile(
    join(consumer, "tree-shake.ts"),
    `import { createElement } from "react";\nimport { Button } from "@artemis/ui/actions";\nexport const TreeShakeButton = () => createElement(Button, { label: "Action tree-shaken" }, "Action");\n`,
    "utf8",
  );
  run(
    join(root, "node_modules/.bin/esbuild"),
    [
      "tree-shake.ts",
      "--bundle",
      "--format=esm",
      "--minify",
      "--platform=browser",
      "--external:react",
      "--external:react/*",
      "--outfile=tree-shake.js",
    ],
    consumer,
  );
  const treeShaken = await readFile(join(consumer, "tree-shake.js"), "utf8");
  const retainedUnusedMarkers = ["icon-button", "badge", "status"].filter(
    (marker) => treeShaken.includes(marker),
  );
  if (
    !treeShaken.includes("data-artemis-component") ||
    !treeShaken.includes("button") ||
    retainedUnusedMarkers.length > 0
  ) {
    throw new Error(
      `Button-only bundle retained unused action markers: ${retainedUnusedMarkers
        .map((marker) => {
          const index = treeShaken.indexOf(marker);
          return `${marker} (${treeShaken.slice(Math.max(0, index - 40), index + marker.length + 40)})`;
        })
        .join(", ")}`,
    );
  }

  await writeFile(
    join(consumer, "form-tree-shake.ts"),
    `import { createElement } from "react";\nimport { TextField } from "@artemis/ui/forms";\nexport const TreeShakeTextField = () => createElement(TextField, { label: "Form tree-shaken", defaultValue: "value" });\n`,
    "utf8",
  );
  run(
    join(root, "node_modules/.bin/esbuild"),
    [
      "form-tree-shake.ts",
      "--bundle",
      "--format=esm",
      "--minify",
      "--platform=browser",
      "--external:react",
      "--external:react/*",
      "--outfile=form-tree-shake.js",
    ],
    consumer,
  );
  const formTreeShaken = await readFile(
    join(consumer, "form-tree-shake.js"),
    "utf8",
  );
  const retainedUnusedFormMarkers = [
    "search-field",
    "select",
    "checkbox",
    "switch",
  ].filter((marker) => formTreeShaken.includes(marker));
  if (
    !formTreeShaken.includes("data-artemis-component") ||
    !formTreeShaken.includes("text-field") ||
    retainedUnusedFormMarkers.length > 0
  ) {
    throw new Error(
      `TextField-only bundle retained unused form markers: ${retainedUnusedFormMarkers.join(", ")}`,
    );
  }

  await writeFile(
    join(consumer, "navigation-tree-shake.ts"),
    `import { createElement } from "react";\nimport { Tabs } from "@artemis/ui/navigation";\nexport const TreeShakeTabs = () => createElement(Tabs, { label: "Navigation tree-shaken", value: "one", onValueChange() {}, options: [{ id: "one-tab", panelId: "one-panel", value: "one", label: "One" }] });\n`,
    "utf8",
  );
  run(
    join(root, "node_modules/.bin/esbuild"),
    [
      "navigation-tree-shake.ts",
      "--bundle",
      "--format=esm",
      "--minify",
      "--platform=browser",
      "--external:react",
      "--external:react/*",
      "--outfile=navigation-tree-shake.js",
    ],
    consumer,
  );
  const navigationTreeShaken = await readFile(
    join(consumer, "navigation-tree-shake.js"),
    "utf8",
  );
  if (
    !navigationTreeShaken.includes("data-artemis-component") ||
    !navigationTreeShaken.includes("tabs") ||
    navigationTreeShaken.includes("segmented-control")
  ) {
    throw new Error("Tabs-only bundle retained unused segmented-control JS");
  }

  await writeFile(
    join(consumer, "feedback-tree-shake.ts"),
    `import { createElement } from "react";\nimport { InlineNotice } from "@artemis/ui/feedback";\nexport const TreeShakeNotice = () => createElement(InlineNotice, null, "Notice");\n`,
    "utf8",
  );
  run(
    join(root, "node_modules/.bin/esbuild"),
    [
      "feedback-tree-shake.ts",
      "--bundle",
      "--format=esm",
      "--minify",
      "--platform=browser",
      "--external:react",
      "--external:react/*",
      "--external:react-dom",
      "--external:react-dom/*",
      "--outfile=feedback-tree-shake.js",
    ],
    consumer,
  );
  const feedbackTreeShaken = await readFile(
    join(consumer, "feedback-tree-shake.js"),
    "utf8",
  );
  if (
    !feedbackTreeShaken.includes("inline-notice") ||
    ["confirmation", "loading-state", "error-state"].some((marker) =>
      feedbackTreeShaken.includes(marker),
    )
  ) {
    throw new Error("InlineNotice-only bundle retained unused feedback JS");
  }

  await writeFile(
    join(consumer, "layout-tree-shake.ts"),
    `import { createElement } from "react";\nimport { PanelHeader } from "@artemis/ui/layout";\nexport const TreeShakePanelHeader = () => createElement(PanelHeader, { title: "Panel" });\n`,
    "utf8",
  );
  run(
    join(root, "node_modules/.bin/esbuild"),
    [
      "layout-tree-shake.ts",
      "--bundle",
      "--format=esm",
      "--minify",
      "--platform=browser",
      "--external:react",
      "--external:react/*",
      "--outfile=layout-tree-shake.js",
    ],
    consumer,
  );
  const layoutTreeShaken = await readFile(
    join(consumer, "layout-tree-shake.js"),
    "utf8",
  );
  if (
    !layoutTreeShaken.includes("panel-header") ||
    ["list-row", "scroll-area", "split-pane"].some((marker) =>
      layoutTreeShaken.includes(marker),
    )
  ) {
    throw new Error("PanelHeader-only bundle retained unused layout JS");
  }

  await writeFile(
    join(consumer, "pattern-tree-shake.ts"),
    `import { createElement } from "react";\nimport { TurnStatus } from "@artemis/ui/patterns";\nexport const TreeShakeTurnStatus = () => createElement(TurnStatus, { label: "Turn", state: "running", statusLabel: "Working" });\n`,
    "utf8",
  );
  run(
    join(root, "node_modules/.bin/esbuild"),
    [
      "pattern-tree-shake.ts",
      "--bundle",
      "--format=esm",
      "--minify",
      "--platform=browser",
      "--external:react",
      "--external:react/*",
      "--outfile=pattern-tree-shake.js",
    ],
    consumer,
  );
  const patternTreeShaken = await readFile(
    join(consumer, "pattern-tree-shake.js"),
    "utf8",
  );
  if (
    !patternTreeShaken.includes("turn-status") ||
    ["approval-card", "tool-activity", "task-plan", "user-input"].some(
      (marker) => patternTreeShaken.includes(marker),
    )
  ) {
    throw new Error("TurnStatus-only bundle retained unused pattern JS");
  }

  const installedRoots = [
    join(consumer, "node_modules/@artemis/theme-contract"),
    join(consumer, "node_modules/@artemis/ui"),
    join(consumer, "node_modules/@artemis/theme-artemis"),
  ];
  for (const installedRoot of installedRoots) {
    for (const file of await textFilesBelow(installedRoot)) {
      const content = await readFile(file, "utf8");
      if (
        content.includes(root) ||
        /\/Users\/[^/]+|BEGIN (?:RSA |EC )?PRIVATE KEY|AKIA[0-9A-Z]{16}/u.test(
          content,
        )
      ) {
        throw new Error(
          `installed tarball leaks an absolute path or secret: ${relative(consumer, file)}`,
        );
      }
    }
  }

  console.log(
    `UI package consumer verification passed outside the repository (${basename(consumer)}; 3 public tarballs; unused action/form/navigation/feedback/layout/pattern JS tree-shaken)`,
  );
} finally {
  await rm(consumer, { recursive: true, force: true });
}
