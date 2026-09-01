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
let rejectedCli = 0;

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

function rejectCli(name, args, expectedError) {
  const result = spawnSync(process.execPath, [verifier, ...args], {
    cwd: root,
    encoding: "utf8",
  });
  const output = `${result.stdout}${result.stderr}`;
  if (result.status === 0 || !output.includes(expectedError)) {
    throw new Error(
      `${name}: CLI was not rejected for ${expectedError}\n${output}`,
    );
  }
  rejected += 1;
  rejectedCli += 1;
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

async function rejectMatrix(name, mutate) {
  const directory = await mkdtemp(
    join(tmpdir(), "artemis-conformance-matrix-"),
  );
  try {
    const matrix = structuredClone(baseMatrix);
    mutate(matrix);
    const path = join(directory, "matrix.json");
    await writeFile(path, JSON.stringify(matrix), "utf8");
    const result = spawnSync(process.execPath, [verifier, "--matrix", path], {
      cwd: root,
      encoding: "utf8",
    });
    if (result.status === 0) throw new Error(`${name} passed`);
    rejected += 1;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

await rejectMatrix("missing behavior case", (matrix) =>
  matrix.skins.stress.pop(),
);
for (const axis of [
  "skins",
  "themes",
  "contrasts",
  "directions",
  "zoomFactors",
  "reducedMotion",
]) {
  await rejectMatrix(`missing ${axis} runtime vertex`, (matrix) =>
    matrix.runtimeAxes[axis].pop(),
  );
}
await rejectMatrix("missing fallback case", (matrix) =>
  matrix.fallbackCases.pop(),
);

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

rejectCli(
  "unknown skin package flag",
  ["--skin-pakage", "fixture"],
  "unknown flag",
);
rejectCli(
  "duplicate CSS flag",
  ["--css", "fixture.css", "--css", "fixture.css"],
  "duplicate --css flag",
);
rejectCli("missing matrix value", ["--matrix"], "requires a non-empty path");
rejectCli("empty CSS value", ["--css", ""], "requires a non-empty path");
rejectCli(
  "conformance positional argument",
  ["fixture"],
  "unexpected positional argument",
);

if (rejected !== 25 || rejectedCss !== 7 || rejectedCli !== 5) {
  throw new Error(
    `Conformance negative coverage is incomplete: ${rejected}/25 total, ${rejectedCss}/7 CSS, ${rejectedCli}/5 CLI`,
  );
}

console.log(
  `Skin conformance negative verification passed (${rejected}/25 rejected; ${rejectedCss}/7 CSS fixtures; ${rejectedCli}/5 CLI fixtures)`,
);
