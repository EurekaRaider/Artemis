import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
};
const canonical = (value) => JSON.stringify(value);

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

const contractPath = valueAfter("--contract");
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
  valueAfter("--matrix") ??
  join(root, "apps/ui-gallery/src/conformance-matrix.json");
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

const externalSkin = valueAfter("--skin-package");
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
const css = await readFile(join(root, "packages/ui/dist/styles.css"), "utf8");
for (const marker of [
  '[data-artemis-component="conformance-probe"]',
  '[data-part="control"]',
  'data-state="disabled"',
  "--artemis-color-focus-ring",
  "prefers-reduced-motion: reduce",
]) {
  if (!css.includes(marker))
    throw new Error(`UI CSS is missing conformance marker: ${marker}`);
}
if (/data-artemis-skin|#[0-9a-f]{3,8}\b|url\s*\(|@import/iu.test(css)) {
  throw new Error(
    "UI structural CSS contains a skin selector, raw brand value, URL, or import",
  );
}

console.log(
  `Skin conformance verification passed (${REQUIRED_SKIN_CASES.length} cases × 2 skins; ${REQUIRED_SWITCH_CASES.length} switch cases; exact public contract)`,
);
