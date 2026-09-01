import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const verifier = join(root, "scripts/verify-skin-conformance.mjs");
const conformance = await import(
  pathToFileURL(join(root, "packages/ui/dist/conformance.js")).href
);
const baseMatrix = JSON.parse(
  await readFile(
    join(root, "apps/ui-gallery/src/conformance-matrix.json"),
    "utf8",
  ),
);
let rejected = 0;
let rejectedCss = 0;

async function rejectContract(name, mutate) {
  const directory = await mkdtemp(
    join(tmpdir(), "artemis-conformance-negative-"),
  );
  try {
    const contract = structuredClone(conformance.CONFORMANCE_PROBE_CONTRACT);
    mutate(contract);
    const path = join(directory, "contract.json");
    await writeFile(path, JSON.stringify(contract), "utf8");
    const result = spawnSync(process.execPath, [verifier, "--contract", path], {
      cwd: root,
      encoding: "utf8",
    });
    if (result.status === 0)
      throw new Error(`${name}: invalid contract passed`);
    rejected += 1;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const baseCss = await readFile(
  join(root, "packages/ui/src/styles.css"),
  "utf8",
);

function replaceRequired(source, search, replacement) {
  if (!source.includes(search)) {
    throw new Error(`CSS negative fixture source was not found: ${search}`);
  }
  return source.replace(search, replacement);
}

async function rejectCss(name, mutate) {
  const directory = await mkdtemp(join(tmpdir(), "artemis-css-negative-"));
  try {
    const css = mutate(baseCss);
    if (css === baseCss) {
      throw new Error(`${name}: CSS negative fixture made no change`);
    }
    const path = join(directory, "styles.css");
    await writeFile(path, css, "utf8");
    const result = spawnSync(process.execPath, [verifier, "--css", path], {
      cwd: root,
      encoding: "utf8",
    });
    if (result.status === 0) throw new Error(`${name}: invalid CSS passed`);
    rejected += 1;
    rejectedCss += 1;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

await rejectContract("missing part", (contract) => contract.parts.pop());
await rejectContract("missing state", (contract) => {
  contract.states = contract.states.filter((state) => state.name !== "busy");
});
await rejectContract("invalid ARIA", (contract) => {
  contract.aria.rootRole = "presentation";
});
await rejectContract("invalid event order", (contract) => {
  contract.callbacks[0].order.reverse();
});

const matrixDirectory = await mkdtemp(
  join(tmpdir(), "artemis-conformance-matrix-"),
);
try {
  const matrix = structuredClone(baseMatrix);
  matrix.skins.stress.pop();
  const path = join(matrixDirectory, "matrix.json");
  await writeFile(path, JSON.stringify(matrix), "utf8");
  const result = spawnSync(process.execPath, [verifier, "--matrix", path], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status === 0) throw new Error("missing behavior case passed");
  rejected += 1;
} finally {
  await rm(matrixDirectory, { recursive: true, force: true });
}

const skinDirectory = await mkdtemp(
  join(tmpdir(), "artemis-conformance-skin-"),
);
try {
  await writeFile(join(skinDirectory, "manifest.json"), "{}\n", "utf8");
  const result = spawnSync(
    process.execPath,
    [verifier, "--skin-package", skinDirectory],
    { cwd: root, encoding: "utf8" },
  );
  if (result.status === 0) throw new Error("invalid skin package passed");
  rejected += 1;
} finally {
  await rm(skinDirectory, { recursive: true, force: true });
}

const surfaceDeclaration = "background: var(--artemis-color-surface-base);";
await rejectCss("raw named color", (css) =>
  replaceRequired(css, surfaceDeclaration, "background: red;"),
);
await rejectCss("raw rgb color", (css) =>
  replaceRequired(css, surfaceDeclaration, "background: rgb(1 2 3);"),
);
await rejectCss("raw hsl color", (css) =>
  replaceRequired(css, surfaceDeclaration, "background: hsl(0 100% 50%);"),
);
await rejectCss("raw transparent color", (css) =>
  replaceRequired(css, surfaceDeclaration, "background: transparent;"),
);
await rejectCss("undeclared token", (css) =>
  replaceRequired(
    css,
    surfaceDeclaration,
    "background: var(--artemis-color-canvas);",
  ),
);
await rejectCss("overridable focus safety", (css) =>
  replaceRequired(
    css,
    "outline: 2px solid Highlight;",
    "outline: var(--artemis-border-width-default) solid var(--artemis-color-focus-ring);",
  ),
);
await rejectCss("skin selector", (css) =>
  replaceRequired(
    css,
    '[data-artemis-component="conformance-probe"] {',
    ':root[data-artemis-skin="com.example.evil"] [data-artemis-component="conformance-probe"] {',
  ),
);

if (rejected !== 13 || rejectedCss !== 7) {
  throw new Error(
    `Conformance negative coverage is incomplete: ${rejected}/13 total, ${rejectedCss}/7 CSS`,
  );
}

console.log(
  `Skin conformance negative verification passed (${rejected}/13 rejected; ${rejectedCss}/7 CSS fixtures)`,
);
