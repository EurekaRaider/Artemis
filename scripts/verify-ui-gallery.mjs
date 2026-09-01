import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import { desktopGalleryImportViolations } from "./verify-ui-boundaries.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const EXPECTED_LAYER_ORDER = ["artemis.reset", "artemis.theme", "artemis.ui"];

function verifyGalleryLayerOrder(css, source) {
  const parsed = postcss.parse(css, { from: source });
  const layerNodes = [];
  parsed.walkAtRules("layer", (rule) => {
    if (rule.parent !== parsed) {
      throw new Error(`${source}: nested @layer rules are not allowed`);
    }
    layerNodes.push(rule);
  });
  if (layerNodes.length === 0) {
    throw new Error(`${source}: final Gallery CSS has no cascade layers`);
  }

  const firstEncounters = [];
  const encountered = new Set();
  let orderStatementIndex = -1;
  let themeBlockIndex = -1;
  let uiBlockIndex = -1;

  for (const [index, rule] of layerNodes.entries()) {
    const names = rule.params
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
    if (
      names.length === 0 ||
      names.some((name) => !EXPECTED_LAYER_ORDER.includes(name))
    ) {
      throw new Error(`${source}: final Gallery CSS has an unknown layer`);
    }
    if (rule.nodes !== undefined && names.length !== 1) {
      throw new Error(`${source}: a layer block must name exactly one layer`);
    }
    if (
      rule.nodes === undefined &&
      orderStatementIndex === -1 &&
      names.includes("artemis.reset")
    ) {
      orderStatementIndex = index;
    }
    if (rule.nodes !== undefined && names[0] === "artemis.theme") {
      themeBlockIndex = themeBlockIndex === -1 ? index : themeBlockIndex;
    }
    if (rule.nodes !== undefined && names[0] === "artemis.ui") {
      uiBlockIndex = uiBlockIndex === -1 ? index : uiBlockIndex;
    }
    for (const name of names) {
      if (!encountered.has(name)) {
        encountered.add(name);
        firstEncounters.push(name);
      }
    }
  }

  if (
    JSON.stringify(firstEncounters) !== JSON.stringify(EXPECTED_LAYER_ORDER)
  ) {
    throw new Error(
      `${source}: cascade layer encounter order must be reset → theme → ui; got ${firstEncounters.join(" → ")}`,
    );
  }
  if (
    orderStatementIndex === -1 ||
    themeBlockIndex === -1 ||
    uiBlockIndex === -1 ||
    orderStatementIndex > themeBlockIndex ||
    orderStatementIndex > uiBlockIndex
  ) {
    throw new Error(
      `${source}: the layer order statement must precede theme and UI blocks`,
    );
  }
}

async function filesBelow(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(path)));
    else files.push(path);
  }
  return files;
}

const galleryDist = join(root, "apps/ui-gallery/dist");
const galleryFiles = await filesBelow(galleryDist);
const galleryIndexPath = galleryFiles.find((path) =>
  path.endsWith("index.html"),
);
if (galleryIndexPath === undefined) {
  throw new Error("UI Gallery build is missing index.html");
}
const galleryIndex = await readFile(galleryIndexPath, "utf8");
if (
  !galleryIndex.includes('src="./assets/') ||
  !galleryIndex.includes('href="./assets/')
) {
  throw new Error("UI Gallery build assets are not offline-relative");
}
const galleryCssFiles = galleryFiles.filter((path) => extname(path) === ".css");
if (galleryCssFiles.length !== 1) {
  throw new Error(
    `UI Gallery build must emit one auditable CSS artifact; found ${galleryCssFiles.length}`,
  );
}
const galleryCss = await readFile(galleryCssFiles[0], "utf8");
verifyGalleryLayerOrder(galleryCss, relative(root, galleryCssFiles[0]));

let legacyLayerOrderError = "";
try {
  verifyGalleryLayerOrder(
    "@layer artemis.theme{:root{--fixture:1}}@layer artemis.reset, artemis.theme, artemis.ui;@layer artemis.ui{.fixture{display:block}}",
    "legacy-theme-first-fixture.css",
  );
} catch (error) {
  if (error instanceof Error) legacyLayerOrderError = error.message;
}
if (!legacyLayerOrderError.includes("cascade layer encounter order")) {
  throw new Error(
    `Legacy theme-first cascade order was not rejected for its encounter order: ${legacyLayerOrderError}`,
  );
}
const galleryText = (
  await Promise.all(
    galleryFiles
      .filter((path) => [".css", ".html", ".js"].includes(extname(path)))
      .map((path) => readFile(path, "utf8")),
  )
).join("\n");
for (const marker of [
  "Artemis UI Gallery scaffold",
  "CL0B component contract harness",
  "com.artemis.synthetic-stress",
  "data-artemis-component",
  "data-gallery-active-skin",
  "--artemis-color-canvas",
  "data-artemis-skin",
  "data-artemis-theme",
]) {
  if (!galleryText.includes(marker)) {
    throw new Error(
      `UI Gallery bundle did not consume public artifact marker: ${marker}`,
    );
  }
}

const desktopManifest = JSON.parse(
  await readFile(join(root, "apps/desktop/package.json"), "utf8"),
);
const desktopDependencySections = [
  desktopManifest.dependencies,
  desktopManifest.devDependencies,
  desktopManifest.optionalDependencies,
  desktopManifest.peerDependencies,
];
if (
  desktopDependencySections.some(
    (dependencies) => "@artemis/ui-gallery" in (dependencies ?? {}),
  )
) {
  throw new Error("Desktop manifest depends on the private UI Gallery");
}
if (JSON.stringify(desktopManifest.build ?? {}).includes("ui-gallery")) {
  throw new Error("Desktop packaging manifest includes the UI Gallery");
}
const desktopGalleryImports = await desktopGalleryImportViolations(root);
if (desktopGalleryImports.length > 0) {
  throw new Error(desktopGalleryImports.join("\n"));
}

const desktopDist = join(root, "apps/desktop/dist-renderer");
const desktopFiles = await filesBelow(desktopDist);
const desktopText = (
  await Promise.all(
    desktopFiles
      .filter((path) => [".css", ".html", ".js"].includes(extname(path)))
      .map((path) => readFile(path, "utf8")),
  )
).join("\n");
for (const forbidden of [
  "@artemis/ui-gallery",
  "Artemis UI Gallery scaffold",
  "com.artemis.synthetic-stress",
  "data-gallery-active-skin",
]) {
  if (desktopText.includes(forbidden)) {
    throw new Error(
      `Desktop renderer bundle contains Gallery marker: ${forbidden}`,
    );
  }
}

console.log(
  `UI Gallery verification passed (${galleryFiles.length} Gallery files; reset → theme → ui artifact order; legacy theme-first fixture rejected; ${desktopFiles.length} Desktop renderer files isolated)`,
);
