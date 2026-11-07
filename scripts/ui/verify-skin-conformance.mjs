import { verifyStructuralCss } from "./conformance/structural-css.mjs";
import { MIG2_EXPECTED_CSS_RULES } from "./conformance/layout-pattern-rules.mjs";
import { MIG1_EXPECTED_CSS_RULES } from "./conformance/navigation-feedback-rules.mjs";
import { CL4_EXPECTED_CSS_RULES } from "./conformance/action-form-rules.mjs";
import { CL3_EXPECTED_CSS_RULES } from "./conformance/conversation-rules.mjs";
import { expectedCssRules } from "./conformance/core-rules.mjs";
import { canonical } from "./conformance/css-normalization.mjs";
import {
  REQUIRED_SKIN_CASES,
  REQUIRED_SWITCH_CASES,
  REQUIRED_RUNTIME_AXES,
  REQUIRED_FALLBACK_CASES,
} from "./conformance/required-cases.mjs";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

const CLI_FLAGS = new Map([
  ["--contract", "contract"],
  ["--matrix", "matrix"],
  ["--skin-package", "skinPackage"],
  ["--css", "css"],
]);

function parseCli(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const key = CLI_FLAGS.get(argument);
    if (key === undefined) {
      if (argument.startsWith("--")) {
        throw new Error(`CLI error: unknown flag ${argument}`);
      }
      throw new Error(`CLI error: unexpected positional argument ${argument}`);
    }
    if (Object.hasOwn(values, key)) {
      throw new Error(`CLI error: duplicate ${argument} flag`);
    }
    const value = args[index + 1];
    if (
      value === undefined ||
      value.startsWith("--") ||
      value.trim().length === 0
    ) {
      throw new Error(`CLI error: ${argument} requires a non-empty path`);
    }
    values[key] = value;
    index += 1;
  }
  return Object.freeze(values);
}

const cli = parseCli(process.argv.slice(2));
for (const [key, declarations] of CL3_EXPECTED_CSS_RULES) {
  if (expectedCssRules.has(key)) {
    throw new Error(`CL3 UI structural CSS rule duplicates ${key}`);
  }
  expectedCssRules.set(key, declarations);
}
for (const [key, declarations] of CL4_EXPECTED_CSS_RULES) {
  if (expectedCssRules.has(key)) {
    throw new Error(`CL4 UI structural CSS rule duplicates ${key}`);
  }
  expectedCssRules.set(key, declarations);
}
for (const [key, declarations] of MIG1_EXPECTED_CSS_RULES) {
  if (expectedCssRules.has(key)) {
    throw new Error(`MIG1 UI structural CSS rule duplicates ${key}`);
  }
  expectedCssRules.set(key, declarations);
}
for (const [key, declarations] of MIG2_EXPECTED_CSS_RULES) {
  if (expectedCssRules.has(key)) {
    throw new Error(`MIG2 UI structural CSS rule duplicates ${key}`);
  }
  expectedCssRules.set(key, declarations);
}
expectedCssRules.set(
  'compact-width|[data-artemis-component="queued-message-group"]',
  {
    "max-block-size": "min(17.5rem, 18vh)",
  },
);
const MIG3A_EXPECTED_CSS_RULES = JSON.parse(
  await readFile(
    join(root, "scripts/ui/workspace-css-contract.json"),
    "utf8",
  ),
);
for (const [key, declarations] of MIG3A_EXPECTED_CSS_RULES) {
  if (expectedCssRules.has(key)) {
    throw new Error(`MIG3A UI structural CSS rule duplicates ${key}`);
  }
  expectedCssRules.set(key, declarations);
}
const MIG3B_EXPECTED_CSS_RULES = JSON.parse(
  await readFile(
    join(root, "scripts/ui/workflow-css-contract.json"),
    "utf8",
  ),
);
for (const [key, declarations] of MIG3B_EXPECTED_CSS_RULES) {
  if (expectedCssRules.has(key)) {
    throw new Error(`MIG3B UI structural CSS rule duplicates ${key}`);
  }
  expectedCssRules.set(key, declarations);
}
const MIG4_EXPECTED_CSS_RULES = JSON.parse(
  await readFile(
    join(root, "scripts/ui/professional-surfaces-css-contract.json"),
    "utf8",
  ),
);
for (const [key, declarations] of MIG4_EXPECTED_CSS_RULES) {
  if (expectedCssRules.has(key)) {
    throw new Error(`MIG4 UI structural CSS rule duplicates ${key}`);
  }
  expectedCssRules.set(key, declarations);
}
const MIG5A_EXPECTED_CSS_RULES = JSON.parse(
  await readFile(
    join(root, "scripts/ui/management-css-contract.json"),
    "utf8",
  ),
);
for (const [key, declarations] of MIG5A_EXPECTED_CSS_RULES) {
  if (expectedCssRules.has(key)) {
    throw new Error(`MIG5A UI structural CSS rule duplicates ${key}`);
  }
  expectedCssRules.set(key, declarations);
}
const MIG5B_EXPECTED_CSS_RULES = JSON.parse(
  await readFile(join(root, "scripts/ui/data-css-contract.json"), "utf8"),
);
for (const [key, declarations] of MIG5B_EXPECTED_CSS_RULES) {
  if (expectedCssRules.has(key)) {
    throw new Error(`MIG5B UI structural CSS rule duplicates ${key}`);
  }
  expectedCssRules.set(key, declarations);
}

const LATEST_UI_EXPECTED_CSS_RULES = JSON.parse(
  await readFile(
    join(root, "scripts/ui/desktop-shell-css-contract.json"),
    "utf8",
  ),
);
for (const [key, declarations] of LATEST_UI_EXPECTED_CSS_RULES) {
  if (expectedCssRules.has(key))
    throw new Error(`Latest UI rule duplicates ${key}`);
  expectedCssRules.set(key, declarations);
}

expectedCssRules.set(
  'forced-colors|[data-artemis-component]:focus-visible, [data-artemis-component] :focus-visible, [data-artemis-component="browser-address-form"]:focus-within',
  { "outline-color": "Highlight" },
);

const ui = await import(
  pathToFileURL(join(root, "packages/ui/dist/index.js")).href
);
const conformance = await import(
  pathToFileURL(join(root, "packages/ui/dist/conformance.js")).href
);
const conversation = await import(
  pathToFileURL(join(root, "packages/ui/dist/conversation.js")).href
);
const actions = await import(
  pathToFileURL(join(root, "packages/ui/dist/actions.js")).href
);
const forms = await import(
  pathToFileURL(join(root, "packages/ui/dist/forms.js")).href
);
const navigation = await import(
  pathToFileURL(join(root, "packages/ui/dist/navigation.js")).href
);
const feedback = await import(
  pathToFileURL(join(root, "packages/ui/dist/feedback.js")).href
);
const layout = await import(
  pathToFileURL(join(root, "packages/ui/dist/layout.js")).href
);
const patterns = await import(
  pathToFileURL(join(root, "packages/ui/dist/patterns.js")).href
);
const surfaces = await import(
  pathToFileURL(join(root, "packages/ui/dist/surfaces.js")).href
);
const workspace = await import(
  pathToFileURL(join(root, "packages/ui/dist/workspace.js")).href
);
const professional = await import(
  pathToFileURL(join(root, "packages/ui/dist/professional.js")).href
);
const management = await import(
  pathToFileURL(join(root, "packages/ui/dist/management.js")).href
);
const data = await import(
  pathToFileURL(join(root, "packages/ui/dist/data.js")).href
);
const workflow = await import(
  pathToFileURL(join(root, "packages/ui/dist/workflow.js")).href
);
const themeContract = await import(
  pathToFileURL(join(root, "packages/theme-contract/dist/index.js")).href
);
const themeArtemis = await import(
  pathToFileURL(join(root, "packages/theme-artemis/dist/index.js")).href
);
const stress = await import(
  pathToFileURL(
    join(root, "apps/ui-gallery/src/themes/stress-skin-fixture.mjs"),
  ).href
);

const contractPath = cli.contract;
const candidateContract =
  contractPath === undefined
    ? conformance.CONFORMANCE_PROBE_CONTRACT
    : JSON.parse(await readFile(resolve(contractPath), "utf8"));
const report = ui.validateComponentContract(candidateContract);
if (!report.valid) {
  throw new Error(
    `ComponentContract failed validation: ${JSON.stringify(report.issues)}`,
  );
}
if (
  canonical(candidateContract) !==
  canonical(conformance.CONFORMANCE_PROBE_CONTRACT)
) {
  throw new Error(
    "ConformanceProbe contract differs from the frozen public contract",
  );
}
for (const [label, candidate, validate] of [
  [
    "conversation",
    conversation.CONVERSATION_COMPONENT_CONTRACTS,
    conversation.validateConversationComponentContracts,
  ],
  [
    "feedback",
    feedback.FEEDBACK_COMPONENT_CONTRACTS,
    feedback.validateFeedbackComponentContracts,
  ],
  [
    "layout",
    layout.LAYOUT_COMPONENT_CONTRACTS,
    layout.validateLayoutComponentContracts,
  ],
  [
    "patterns",
    patterns.PATTERN_COMPONENT_CONTRACTS,
    patterns.validatePatternComponentContracts,
  ],
  [
    "surfaces",
    surfaces.SURFACE_COMPONENT_CONTRACTS,
    surfaces.validateSurfaceComponentContracts,
  ],
  [
    "workspace",
    workspace.WORKSPACE_COMPONENT_CONTRACTS,
    workspace.validateWorkspaceComponentContracts,
  ],
  [
    "professional",
    professional.PROFESSIONAL_COMPONENT_CONTRACTS,
    professional.validateProfessionalComponentContracts,
  ],
  [
    "management",
    management.MANAGEMENT_COMPONENT_CONTRACTS,
    management.validateManagementComponentContracts,
  ],
  ["data", data.DATA_COMPONENT_CONTRACTS, data.validateDataComponentContracts],
  [
    "workflow",
    workflow.WORKFLOW_COMPONENT_CONTRACTS,
    workflow.validateWorkflowComponentContracts,
  ],
]) {
  const candidateReport = validate(candidate);
  if (!candidateReport.valid) {
    throw new Error(
      `${label} component contracts failed validation: ${JSON.stringify(candidateReport.errors)}`,
    );
  }
}

const matrixPath =
  cli.matrix ??
  join(root, "apps/ui-gallery/src/conformance/conformance-matrix.json");
const matrix = JSON.parse(await readFile(resolve(matrixPath), "utf8"));
if (
  matrix === null ||
  Array.isArray(matrix) ||
  typeof matrix !== "object" ||
  canonical(Object.keys(matrix).sort()) !==
    canonical(
      [
        "component",
        "fallbackCases",
        "runtimeAxes",
        "schemaVersion",
        "skins",
        "switchCases",
      ].sort(),
    )
) {
  throw new Error("Conformance matrix top-level fields are not exact");
}
if (matrix.schemaVersion !== 2 || matrix.component !== "conformance-probe") {
  throw new Error("Conformance matrix version or component is invalid");
}
if (
  matrix.skins === null ||
  Array.isArray(matrix.skins) ||
  typeof matrix.skins !== "object" ||
  canonical(Object.keys(matrix.skins).sort()) !==
    canonical(["default", "stress"])
) {
  throw new Error(
    "Conformance matrix must contain exactly default and stress skins",
  );
}
if (
  matrix.runtimeAxes === null ||
  Array.isArray(matrix.runtimeAxes) ||
  typeof matrix.runtimeAxes !== "object" ||
  canonical(Object.keys(matrix.runtimeAxes).sort()) !==
    canonical(Object.keys(REQUIRED_RUNTIME_AXES).sort())
) {
  throw new Error("Runtime conformance axes are not exact");
}
for (const [axis, expectedValues] of Object.entries(REQUIRED_RUNTIME_AXES)) {
  const values = matrix.runtimeAxes[axis];
  if (
    !Array.isArray(values) ||
    values.length !== expectedValues.length ||
    new Set(values).size !== values.length ||
    canonical(values) !== canonical(expectedValues)
  ) {
    throw new Error(`Runtime conformance axis ${axis} is incomplete`);
  }
}
if (
  !Array.isArray(matrix.fallbackCases) ||
  matrix.fallbackCases.length !== REQUIRED_FALLBACK_CASES.length ||
  new Set(matrix.fallbackCases).size !== matrix.fallbackCases.length ||
  canonical(matrix.fallbackCases) !== canonical(REQUIRED_FALLBACK_CASES)
) {
  throw new Error("Runtime fallback cases are incomplete");
}
for (const skin of ["default", "stress"]) {
  const cases = matrix.skins[skin];
  if (
    !Array.isArray(cases) ||
    cases.length !== REQUIRED_SKIN_CASES.length ||
    new Set(cases).size !== cases.length ||
    REQUIRED_SKIN_CASES.some((required) => !cases.includes(required))
  ) {
    throw new Error(`${skin} skin conformance cases are missing or duplicated`);
  }
}
if (
  !Array.isArray(matrix.switchCases) ||
  matrix.switchCases.length !== REQUIRED_SWITCH_CASES.length ||
  new Set(matrix.switchCases).size !== matrix.switchCases.length ||
  REQUIRED_SWITCH_CASES.some(
    (required) => !matrix.switchCases.includes(required),
  )
) {
  throw new Error(
    "Skin-switch identity/state preservation cases are incomplete",
  );
}

for (const [label, skinPackage] of [
  [
    "bundled Artemis",
    {
      manifest: themeArtemis.artemisThemeManifest,
      tokenDocuments: themeArtemis.artemisTokenDocuments,
    },
  ],
  ["synthetic stress", stress.stressSkinPackage],
]) {
  const skinReport = themeContract.validateSkinPackage(skinPackage);
  if (!skinReport.valid) {
    throw new Error(
      `${label} skin is invalid: ${JSON.stringify(skinReport.issues)}`,
    );
  }
}

const hostileFocusSkin = structuredClone(stress.stressSkinPackage);
for (const tokenDocument of Object.values(hostileFocusSkin.tokenDocuments)) {
  for (const mode of tokenDocument.modes) {
    mode.tokens["border.width.default"] = {
      kind: "length",
      value: 0,
      unit: "px",
    };
    mode.tokens["color.focus.ring"] = {
      kind: "color",
      value: "#00000000",
    };
  }
}
const hostileFocusReport = themeContract.validateSkinPackage(hostileFocusSkin);
if (!hostileFocusReport.valid) {
  throw new Error(
    `Focus-floor skin fixture must remain schema-valid: ${JSON.stringify(hostileFocusReport.issues)}`,
  );
}

const externalSkin = cli.skinPackage;
if (externalSkin !== undefined) {
  const result = spawnSync(
    process.execPath,
    [
      join(root, "scripts/ui/verify-skin-package.mjs"),
      "--package",
      resolve(externalSkin),
    ],
    { cwd: root, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      `External skin failed package validation:\n${result.stdout}${result.stderr}`,
    );
  }
}

for (const specifier of [
  "@artemis/ui",
  "@artemis/ui/actions",
  "@artemis/ui/conformance",
  "@artemis/ui/conversation",
  "@artemis/ui/data",
  "@artemis/ui/forms",
  "@artemis/ui/navigation",
  "@artemis/ui/feedback",
  "@artemis/ui/layout",
  "@artemis/ui/management",
  "@artemis/ui/patterns",
  "@artemis/ui/professional",
  "@artemis/ui/surfaces",
  "@artemis/ui/workspace",
  "@artemis/ui/workflow",
]) {
  const resolved = import.meta.resolve(specifier);
  const expectedRoot = pathToFileURL(join(root, "packages/ui/dist/")).href;
  if (!resolved.startsWith(expectedRoot)) {
    throw new Error(
      `Public UI import did not resolve through the package: ${specifier}`,
    );
  }
}
const cssPath = resolve(cli.css ?? join(root, "packages/ui/dist/styles.css"));
const css = await readFile(cssPath, "utf8");
verifyStructuralCss(css, cssPath, [
  {
    label: "conformance",
    components: [candidateContract.name],
    mutableTokens: candidateContract.theme.mutableTokens,
  },
  {
    label: "action",
    components: Object.values(actions.ACTION_COMPONENT_CONTRACTS).map(
      (contract) => contract.name,
    ),
    mutableTokens: actions.ACTION_COMPONENT_MUTABLE_TOKENS,
  },
  {
    label: "form",
    components: Object.values(forms.FORM_COMPONENT_CONTRACTS).map(
      (contract) => contract.name,
    ),
    extraMarkers: ['[data-artemis-component][data-label-visibility="hidden"]'],
    mutableTokens: forms.FORM_COMPONENT_MUTABLE_TOKENS,
  },
  {
    label: "navigation",
    components: Object.values(navigation.NAVIGATION_COMPONENT_CONTRACTS).map(
      (contract) => contract.name,
    ),
    mutableTokens: navigation.NAVIGATION_COMPONENT_MUTABLE_TOKENS,
  },
  {
    label: "conversation",
    components: Object.values(
      conversation.CONVERSATION_COMPONENT_CONTRACTS,
    ).map((contract) => contract.name),
    mutableTokens: conversation.CONVERSATION_COMPONENT_MUTABLE_TOKENS,
  },
  {
    label: "feedback",
    components: Object.values(feedback.FEEDBACK_COMPONENT_CONTRACTS).map(
      (contract) => contract.name,
    ),
    extraMarkers: [
      '[data-artemis-component="tooltip-anchor"]',
      "[data-artemis-toast-viewport]",
    ],
    mutableTokens: feedback.FEEDBACK_COMPONENT_MUTABLE_TOKENS,
  },
  {
    label: "layout",
    components: Object.values(layout.LAYOUT_COMPONENT_CONTRACTS).map(
      (contract) => contract.name,
    ),
    mutableTokens: layout.LAYOUT_COMPONENT_MUTABLE_TOKENS,
  },
  {
    label: "pattern",
    components: Object.values(patterns.PATTERN_COMPONENT_CONTRACTS).map(
      (contract) => contract.name,
    ),
    mutableTokens: patterns.PATTERN_COMPONENT_MUTABLE_TOKENS,
  },
  {
    label: "surface",
    components: Object.values(surfaces.SURFACE_COMPONENT_CONTRACTS).map(
      (contract) => contract.name,
    ),
    mutableTokens: surfaces.SURFACE_COMPONENT_MUTABLE_TOKENS,
  },
  {
    label: "workspace",
    components: Object.values(workspace.WORKSPACE_COMPONENT_CONTRACTS).map(
      (contract) => contract.name,
    ),
    mutableTokens: workspace.WORKSPACE_COMPONENT_MUTABLE_TOKENS,
  },
  {
    label: "professional",
    components: Object.values(
      professional.PROFESSIONAL_COMPONENT_CONTRACTS,
    ).map((contract) => contract.name),
    mutableTokens: professional.PROFESSIONAL_COMPONENT_MUTABLE_TOKENS,
  },
  {
    label: "management",
    components: Object.values(management.MANAGEMENT_COMPONENT_CONTRACTS).map(
      (contract) => contract.name,
    ),
    mutableTokens: management.MANAGEMENT_COMPONENT_MUTABLE_TOKENS,
  },
  {
    label: "data",
    components: Object.values(data.DATA_COMPONENT_CONTRACTS).map(
      (contract) => contract.name,
    ),
    mutableTokens: data.DATA_COMPONENT_MUTABLE_TOKENS,
  },
  {
    label: "workflow",
    components: Object.values(workflow.WORKFLOW_COMPONENT_CONTRACTS).map(
      (contract) => contract.name,
    ),
    mutableTokens: workflow.WORKFLOW_COMPONENT_MUTABLE_TOKENS,
  },
]);

console.log(
  `Skin conformance verification passed (${REQUIRED_SKIN_CASES.length} cases × 2 skins; ${REQUIRED_SWITCH_CASES.length} switch cases; 64 runtime vertices; ${REQUIRED_FALLBACK_CASES.length} fallback cases; exact public and per-family contract/CSS tokens; fixed focus floor survives a valid zero-border/transparent-focus skin)`,
);
