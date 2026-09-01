import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import postcss from "postcss";

const root = fileURLToPath(new URL("../", import.meta.url));
const REQUIRED_SKIN_CASES = [
  "anatomy",
  "aria-relations",
  "finite-states",
  "controlled-boundary",
  "ime-enter",
  "callback-order",
  "action-policy",
  "rtl-inheritance",
];
const REQUIRED_SWITCH_CASES = [
  "same-node",
  "same-anatomy",
  "same-aria",
  "value-preserved",
  "selection-preserved",
  "focus-preserved",
];

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
const canonical = (value) => JSON.stringify(value);
const normalizeWhitespace = (value) => value.replace(/\s+/gu, " ").trim();
const normalizeSelector = (value) =>
  normalizeWhitespace(value).replace(/\s*,\s*/gu, ", ");
const normalizeValue = (value) =>
  normalizeWhitespace(value).replace(/\s*,\s*/gu, ", ");

const PROBE = '[data-artemis-component="conformance-probe"]';
const expectedCssRules = new Map([
  [
    `normal|${PROBE}`,
    {
      display: "grid",
      gap: "var(--artemis-space-1)",
      color: "var(--artemis-color-text-primary)",
      "font-family": "var(--artemis-typography-body-family)",
      "font-size": "var(--artemis-typography-body-size)",
    },
  ],
  [
    `normal|${PROBE} [data-part="label"]`,
    {
      color: "var(--artemis-color-text-primary)",
      "font-size": "var(--artemis-typography-label-size)",
    },
  ],
  [
    `normal|${PROBE} [data-part="control"]`,
    {
      "box-sizing": "border-box",
      "min-inline-size": "0",
      padding: "var(--artemis-space-2) var(--artemis-space-3)",
      color: "var(--artemis-color-text-primary)",
      background: "var(--artemis-color-surface-base)",
      border:
        "var(--artemis-border-width-default) solid var(--artemis-color-border-default)",
      "border-radius": "var(--artemis-radius-input)",
      font: "inherit",
      transition:
        "border-color var(--artemis-motion-duration-fast) var(--artemis-motion-easing-standard), background var(--artemis-motion-duration-fast) var(--artemis-motion-easing-standard)",
    },
  ],
  [
    `normal|${PROBE} [data-part="control"]:focus-visible`,
    {
      outline: "2px solid Highlight",
      "outline-offset": "2px",
    },
  ],
  [
    `normal|${PROBE} [data-part="description"], ${PROBE} [data-part="error"]`,
    {
      "min-block-size": "var(--artemis-space-3)",
      margin: "0",
      color: "var(--artemis-color-text-secondary)",
    },
  ],
  [
    `normal|${PROBE} [data-part="error"]`,
    { color: "var(--artemis-color-status-danger)" },
  ],
  [
    `normal|${PROBE}[data-state="disabled"]`,
    { opacity: "var(--artemis-opacity-disabled)" },
  ],
  [`reduced-motion|${PROBE} [data-part="control"]`, { transition: "none" }],
]);

function verifyStructuralCss(css, from, componentContract) {
  const parsed = postcss.parse(css, { from });
  const rootNodes = parsed.nodes ?? [];
  if (rootNodes.length !== 2) {
    throw new Error("UI structural CSS must contain exactly two root at-rules");
  }

  const [layerOrder, uiLayer] = rootNodes;
  if (
    layerOrder.type !== "atrule" ||
    layerOrder.name !== "layer" ||
    normalizeWhitespace(layerOrder.params) !==
      "artemis.reset, artemis.theme, artemis.ui" ||
    layerOrder.nodes !== undefined
  ) {
    throw new Error("UI structural CSS layer order is not exact");
  }
  if (
    uiLayer.type !== "atrule" ||
    uiLayer.name !== "layer" ||
    normalizeWhitespace(uiLayer.params) !== "artemis.ui" ||
    uiLayer.nodes === undefined
  ) {
    throw new Error("UI structural CSS must use only @layer artemis.ui");
  }

  let commentCount = 0;
  parsed.walkComments(() => {
    commentCount += 1;
  });
  if (commentCount !== 0) {
    throw new Error("UI structural CSS comments are not allowed");
  }

  const seenRules = new Set();
  const consumedTokens = new Set();
  const verifyRule = (rule, context) => {
    if (rule.type !== "rule") {
      throw new Error("UI structural CSS contains an unexpected nested node");
    }
    const selector = normalizeSelector(rule.selector);
    const key = `${context}|${selector}`;
    const expected = expectedCssRules.get(key);
    if (expected === undefined) {
      throw new Error(`UI structural CSS selector is not allowed: ${selector}`);
    }
    if (seenRules.has(key)) {
      throw new Error(`UI structural CSS rule is duplicated: ${selector}`);
    }
    seenRules.add(key);

    const declarations = new Map();
    for (const node of rule.nodes ?? []) {
      if (node.type !== "decl") {
        throw new Error(
          `UI structural CSS rule contains a non-declaration: ${selector}`,
        );
      }
      if (node.important) {
        throw new Error(
          `UI structural CSS must not use !important: ${node.prop}`,
        );
      }
      if (declarations.has(node.prop)) {
        throw new Error(
          `UI structural CSS declaration is duplicated: ${node.prop}`,
        );
      }
      const value = normalizeValue(node.value);
      declarations.set(node.prop, value);
      for (const match of value.matchAll(
        /var\(\s*(--artemis-[a-z0-9]+(?:-[a-z0-9]+)*)\s*\)/gu,
      )) {
        consumedTokens.add(match[1]);
      }
    }

    const expectedEntries = Object.entries(expected);
    if (declarations.size !== expectedEntries.length) {
      throw new Error(
        `UI structural CSS declarations are not exact for: ${selector}`,
      );
    }
    for (const [property, expectedValue] of expectedEntries) {
      if (declarations.get(property) !== expectedValue) {
        throw new Error(
          `UI structural CSS value is not allowed: ${property}: ${String(declarations.get(property))}`,
        );
      }
    }
  };

  for (const node of uiLayer.nodes) {
    if (node.type === "rule") {
      verifyRule(node, "normal");
      continue;
    }
    if (
      node.type !== "atrule" ||
      node.name !== "media" ||
      normalizeWhitespace(node.params) !== "(prefers-reduced-motion: reduce)" ||
      node.nodes === undefined ||
      node.nodes.length !== 1
    ) {
      throw new Error("UI structural CSS contains an unexpected at-rule");
    }
    verifyRule(node.nodes[0], "reduced-motion");
  }

  if (
    seenRules.size !== expectedCssRules.size ||
    [...expectedCssRules.keys()].some((key) => !seenRules.has(key))
  ) {
    throw new Error("UI structural CSS is missing a required rule");
  }

  const actualTokens = [...consumedTokens].sort();
  const declaredTokens = [...componentContract.theme.mutableTokens].sort();
  if (canonical(actualTokens) !== canonical(declaredTokens)) {
    throw new Error(
      `UI structural CSS tokens differ from ComponentContract: CSS=${canonical(actualTokens)} contract=${canonical(declaredTokens)}`,
    );
  }
}

const ui = await import(
  pathToFileURL(join(root, "packages/ui/dist/index.js")).href
);
const conformance = await import(
  pathToFileURL(join(root, "packages/ui/dist/conformance.js")).href
);
const themeContract = await import(
  pathToFileURL(join(root, "packages/theme-contract/dist/index.js")).href
);
const themeArtemis = await import(
  pathToFileURL(join(root, "packages/theme-artemis/dist/index.js")).href
);
const stress = await import(
  pathToFileURL(join(root, "apps/ui-gallery/src/stress-skin-fixture.mjs")).href
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

const matrixPath =
  cli.matrix ?? join(root, "apps/ui-gallery/src/conformance-matrix.json");
const matrix = JSON.parse(await readFile(resolve(matrixPath), "utf8"));
if (
  matrix === null ||
  Array.isArray(matrix) ||
  typeof matrix !== "object" ||
  canonical(Object.keys(matrix).sort()) !==
    canonical(["component", "schemaVersion", "skins", "switchCases"])
) {
  throw new Error("Conformance matrix top-level fields are not exact");
}
if (matrix.schemaVersion !== 1 || matrix.component !== "conformance-probe") {
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
      join(root, "scripts/verify-skin-package.mjs"),
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

for (const specifier of ["@artemis/ui", "@artemis/ui/conformance"]) {
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
verifyStructuralCss(css, cssPath, candidateContract);

console.log(
  `Skin conformance verification passed (${REQUIRED_SKIN_CASES.length} cases × 2 skins; ${REQUIRED_SWITCH_CASES.length} switch cases; exact public contract/CSS tokens; fixed focus floor survives a valid zero-border/transparent-focus skin)`,
);
