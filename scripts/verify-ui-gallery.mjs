import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import { desktopGalleryImportViolations } from "./verify-ui-boundaries.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const EXPECTED_LAYER_ORDER = ["artemis.reset", "artemis.theme", "artemis.ui"];
const EXPECTED_LAYER_ORDER_TEXT = EXPECTED_LAYER_ORDER.join(" → ");
const GALLERY_SCAFFOLD_RULES = new Map([
  [
    ":root",
    [
      ["color", "var(--artemis-color-text-primary)"],
      ["background", "var(--artemis-color-canvas)"],
      ["font-family", "var(--artemis-typography-body-family)"],
      ["font-size", "var(--artemis-typography-body-size)"],
    ],
  ],
  ["body", [["margin", "0"]]],
  [
    "main",
    [
      ["box-sizing", "border-box"],
      ["max-width", "48rem"],
      ["margin", "0 auto"],
      ["padding", "var(--artemis-space-6)"],
    ],
  ],
  [
    ".gallery-eyebrow",
    [
      ["color", "var(--artemis-color-text-secondary)"],
      ["font-size", "var(--artemis-typography-label-size)"],
    ],
  ],
  [
    ".gallery-skin-toggle",
    [
      ["padding", "var(--artemis-space-2) var(--artemis-space-3)"],
      ["color", "var(--artemis-color-accent-on-primary)"],
      ["background", "var(--artemis-color-accent-primary)"],
      [
        "border",
        "var(--artemis-border-width-default) solid var(--artemis-color-border-strong)",
      ],
      ["border-radius", "var(--artemis-radius-control)"],
      ["font", "inherit"],
    ],
  ],
  [
    ".gallery-probe-section",
    [
      ["display", "grid"],
      ["gap", "var(--artemis-space-3)"],
      ["margin-block-start", "var(--artemis-space-6)"],
    ],
  ],
]);

const normalizeWhitespace = (value) => value.replace(/\s+/gu, " ").trim();

function cssNodeSignature(node) {
  if (node.type === "decl") {
    return ["decl", node.prop, normalizeWhitespace(node.value), node.important];
  }
  if (node.type === "rule") {
    return [
      "rule",
      normalizeWhitespace(node.selector),
      (node.nodes ?? []).map(cssNodeSignature),
    ];
  }
  if (node.type === "atrule") {
    return [
      "atrule",
      node.name,
      normalizeWhitespace(node.params),
      node.nodes?.map(cssNodeSignature),
    ];
  }
  return [node.type, node.toString()];
}

function layerBlockSignature(css, source, layerName) {
  const parsed = postcss.parse(css, { from: source });
  const blocks = (parsed.nodes ?? []).filter(
    (node) =>
      node.type === "atrule" &&
      node.name === "layer" &&
      node.nodes !== undefined &&
      node.params.trim() === layerName,
  );
  if (blocks.length !== 1) {
    throw new Error(
      `${source}: public styles must contain exactly one ${layerName} block; found ${blocks.length}`,
    );
  }
  return JSON.stringify((blocks[0].nodes ?? []).map(cssNodeSignature));
}

function verifyGalleryScaffoldBlock(block, source) {
  const seenSelectors = new Set();
  for (const node of block.nodes ?? []) {
    if (node.type !== "rule") {
      throw new Error(
        `${source}: Gallery scaffold artemis.ui block allows only rules`,
      );
    }
    const selector = normalizeWhitespace(node.selector);
    const expectedDeclarations = GALLERY_SCAFFOLD_RULES.get(selector);
    if (expectedDeclarations === undefined) {
      throw new Error(
        `${source}: Gallery scaffold selector is not allowed: ${selector}`,
      );
    }
    if (seenSelectors.has(selector)) {
      throw new Error(
        `${source}: duplicate Gallery scaffold selector: ${selector}`,
      );
    }
    seenSelectors.add(selector);
    const declarations = (node.nodes ?? []).map((child) => {
      if (child.type !== "decl" || child.important) {
        throw new Error(
          `${source}: Gallery scaffold rule ${selector} allows only ordinary declarations`,
        );
      }
      return [child.prop, normalizeWhitespace(child.value)];
    });
    if (JSON.stringify(declarations) !== JSON.stringify(expectedDeclarations)) {
      throw new Error(
        `${source}: Gallery scaffold rule ${selector} declarations do not match the exact contract`,
      );
    }
  }
  if (seenSelectors.size !== GALLERY_SCAFFOLD_RULES.size) {
    throw new Error(
      `${source}: Gallery scaffold selector set does not match the exact contract`,
    );
  }
}

function verifyGalleryLayerOrder(
  css,
  source,
  expectedPublicUiSignature,
  expectedThemeSignature,
) {
  const parsed = postcss.parse(css, { from: source });
  for (const node of parsed.nodes ?? []) {
    if (node.type !== "atrule" || node.name !== "layer") {
      throw new Error(
        `${source}: unlayered root node is forbidden in final Gallery CSS`,
      );
    }
  }
  let importantDeclaration = "";
  parsed.walkDecls((declaration) => {
    if (declaration.important && importantDeclaration.length === 0) {
      importantDeclaration = declaration.prop;
    }
  });
  if (importantDeclaration.length > 0) {
    throw new Error(
      `${source}: !important is forbidden in final Gallery CSS: ${importantDeclaration}`,
    );
  }

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
  const blockCounts = new Map(EXPECTED_LAYER_ORDER.map((name) => [name, 0]));
  let orderStatementCount = 0;
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
    if (rule.nodes === undefined) {
      if (JSON.stringify(names) !== JSON.stringify(EXPECTED_LAYER_ORDER)) {
        throw new Error(
          `${source}: layer order statement params must be exactly ${EXPECTED_LAYER_ORDER_TEXT}`,
        );
      }
      orderStatementCount += 1;
      if (orderStatementIndex === -1) orderStatementIndex = index;
    } else {
      blockCounts.set(names[0], (blockCounts.get(names[0]) ?? 0) + 1);
      if (names[0] === "artemis.theme" && themeBlockIndex === -1) {
        themeBlockIndex = index;
      }
      if (names[0] === "artemis.ui" && uiBlockIndex === -1) {
        uiBlockIndex = index;
      }
    }
    for (const name of names) {
      if (!encountered.has(name)) {
        encountered.add(name);
        firstEncounters.push(name);
      }
    }
  }

  if (orderStatementCount === 0) {
    throw new Error(`${source}: layer order statement is missing`);
  }
  if (orderStatementCount > 1) {
    throw new Error(
      `${source}: duplicate layer order statement; expected exactly one, found ${orderStatementCount}`,
    );
  }
  for (const [name, expectedCount] of [
    ["artemis.theme", 1],
    ["artemis.ui", 2],
  ]) {
    const count = blockCounts.get(name) ?? 0;
    if (count === 0) {
      throw new Error(`${source}: ${name} layer block is missing`);
    }
    if (count > expectedCount) {
      throw new Error(
        `${source}: duplicate ${name} layer block; expected exactly ${expectedCount}, found ${count}`,
      );
    }
    if (count !== expectedCount) {
      throw new Error(
        `${source}: ${name} layer block count must be ${expectedCount}; found ${count}`,
      );
    }
  }
  if ((blockCounts.get("artemis.reset") ?? 0) !== 0) {
    throw new Error(`${source}: artemis.reset layer blocks are forbidden`);
  }
  if (
    JSON.stringify(firstEncounters) !== JSON.stringify(EXPECTED_LAYER_ORDER)
  ) {
    throw new Error(
      `${source}: cascade layer encounter order must be ${EXPECTED_LAYER_ORDER_TEXT}; got ${firstEncounters.join(" → ")}`,
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

  const uiBlocks = layerNodes.filter(
    (rule) => rule.nodes !== undefined && rule.params.trim() === "artemis.ui",
  );
  const actualPublicUiSignature = JSON.stringify(
    (uiBlocks[0].nodes ?? []).map(cssNodeSignature),
  );
  if (actualPublicUiSignature !== expectedPublicUiSignature) {
    throw new Error(
      `${source}: public artemis.ui block drifted from @artemis/ui styles.css`,
    );
  }
  const themeBlock = layerNodes.find(
    (rule) =>
      rule.nodes !== undefined && rule.params.trim() === "artemis.theme",
  );
  const actualThemeSignature = JSON.stringify(
    (themeBlock.nodes ?? []).map(cssNodeSignature),
  );
  if (actualThemeSignature !== expectedThemeSignature) {
    throw new Error(
      `${source}: artemis.theme block drifted from @artemis/theme-artemis theme.css`,
    );
  }
  verifyGalleryScaffoldBlock(uiBlocks[1], source);
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
const uiCssPath = join(root, "packages/ui/dist/styles.css");
const expectedPublicUiSignature = layerBlockSignature(
  await readFile(uiCssPath, "utf8"),
  relative(root, uiCssPath),
  "artemis.ui",
);
const themeCssPath = join(root, "packages/theme-artemis/dist/theme.css");
const expectedThemeSignature = layerBlockSignature(
  await readFile(themeCssPath, "utf8"),
  relative(root, themeCssPath),
  "artemis.theme",
);
verifyGalleryLayerOrder(
  galleryCss,
  relative(root, galleryCssFiles[0]),
  expectedPublicUiSignature,
  expectedThemeSignature,
);

function mutateUiBlock(css, blockIndex, mutate) {
  const parsed = postcss.parse(css);
  const blocks = (parsed.nodes ?? []).filter(
    (node) =>
      node.type === "atrule" &&
      node.name === "layer" &&
      node.nodes !== undefined &&
      node.params.trim() === "artemis.ui",
  );
  mutate(blocks[blockIndex]);
  return parsed.toString();
}

const mutateGalleryUi = (css, mutate) => mutateUiBlock(css, 1, mutate);

function mutateTheme(css, mutate) {
  const parsed = postcss.parse(css);
  const block = (parsed.nodes ?? []).find(
    (node) =>
      node.type === "atrule" &&
      node.name === "layer" &&
      node.nodes !== undefined &&
      node.params.trim() === "artemis.theme",
  );
  mutate(block);
  return parsed.toString();
}

const layerNegativeFixtures = [
  {
    name: "legacy-theme-first",
    css: "@layer artemis.theme{:root{--fixture:1}}@layer artemis.reset, artemis.theme, artemis.ui;@layer artemis.ui{.fixture{display:block}}@layer artemis.ui{.gallery{display:grid}}",
    error: "cascade layer encounter order",
  },
  {
    name: "duplicate-theme-block",
    css: `${galleryCss}@layer artemis.theme{.duplicate{display:block}}`,
    error: "duplicate artemis.theme layer block",
  },
  {
    name: "duplicate-ui-block",
    css: `${galleryCss}@layer artemis.ui{.duplicate{display:block}}`,
    error: "duplicate artemis.ui layer block",
  },
  {
    name: "duplicate-order-statement",
    css: `${galleryCss}@layer artemis.reset, artemis.theme, artemis.ui;`,
    error: "duplicate layer order statement",
  },
  {
    name: "nested-layer",
    css: "@layer artemis.reset, artemis.theme, artemis.ui;@layer artemis.theme{:root{--fixture:1}}@layer artemis.ui{@layer artemis.ui{.fixture{display:block}}}@layer artemis.ui{.gallery{display:grid}}",
    error: "nested @layer rules are not allowed",
  },
  {
    name: "unknown-layer",
    css: `${galleryCss}@layer artemis.unknown{.fixture{display:block}}`,
    error: "unknown layer",
  },
  {
    name: "wrong-order-params",
    css: galleryCss.replace(
      "@layer artemis.reset, artemis.theme, artemis.ui;",
      "@layer artemis.theme, artemis.reset, artemis.ui;",
    ),
    error: "params must be exactly",
  },
  {
    name: "unlayered-probe-focus-override",
    css: `${galleryCss}[data-artemis-component="conformance-probe"] [data-part="control"]:focus-visible{outline:0!important}`,
    error: "unlayered root node is forbidden",
  },
  {
    name: "unlayered-generic-focus-override",
    css: `${galleryCss}input:focus-visible{outline:0}`,
    error: "unlayered root node is forbidden",
  },
  {
    name: "unlayered-gallery-rule",
    css: `${galleryCss}.gallery-probe-section{display:none}`,
    error: "unlayered root node is forbidden",
  },
  {
    name: "layered-important",
    css: galleryCss.replace("display: grid;", "display: grid !important;"),
    error: "!important is forbidden",
  },
  {
    name: "layered-probe-focus-override",
    css: mutateGalleryUi(galleryCss, (block) => {
      block.append(
        postcss.rule({
          selector:
            '[data-artemis-component="conformance-probe"] [data-part="control"]:focus-visible',
          nodes: [postcss.decl({ prop: "outline", value: "0" })],
        }),
      );
    }),
    error: "Gallery scaffold selector is not allowed",
  },
  {
    name: "layered-generic-focus-override",
    css: mutateGalleryUi(galleryCss, (block) => {
      block.append(
        postcss.rule({
          selector: "input:focus-visible",
          nodes: [postcss.decl({ prop: "outline", value: "0" })],
        }),
      );
    }),
    error: "Gallery scaffold selector is not allowed",
  },
  {
    name: "gallery-extra-declaration",
    css: mutateGalleryUi(galleryCss, (block) => {
      block.nodes
        .find((node) => node.type === "rule" && node.selector === ":root")
        .append(postcss.decl({ prop: "display", value: "block" }));
    }),
    error: "declarations do not match the exact contract",
  },
  {
    name: "gallery-changed-value",
    css: mutateGalleryUi(galleryCss, (block) => {
      const body = block.nodes.find(
        (node) => node.type === "rule" && node.selector === "body",
      );
      body.nodes.find((node) => node.type === "decl").value = "1px";
    }),
    error: "declarations do not match the exact contract",
  },
  {
    name: "gallery-duplicate-selector",
    css: mutateGalleryUi(galleryCss, (block) => {
      block.append(
        postcss.rule({
          selector: "body",
          nodes: [postcss.decl({ prop: "margin", value: "0" })],
        }),
      );
    }),
    error: "duplicate Gallery scaffold selector",
  },
  {
    name: "public-ui-structural-drift",
    css: mutateUiBlock(galleryCss, 0, (block) => {
      block.append(
        postcss.rule({
          selector: ".public-drift",
          nodes: [postcss.decl({ prop: "display", value: "block" })],
        }),
      );
    }),
    error: "public artemis.ui block drifted",
  },
  {
    name: "unknown-root-at-rule",
    css: `${galleryCss}@import url("evil.css");`,
    error: "unlayered root node is forbidden",
  },
  {
    name: "gallery-missing-selector",
    css: mutateGalleryUi(galleryCss, (block) => {
      block.nodes
        .find(
          (node) =>
            node.type === "rule" && node.selector === ".gallery-probe-section",
        )
        .remove();
    }),
    error: "selector set does not match the exact contract",
  },
  {
    name: "gallery-duplicate-declaration",
    css: mutateGalleryUi(galleryCss, (block) => {
      block.nodes
        .find((node) => node.type === "rule" && node.selector === "body")
        .append(postcss.decl({ prop: "margin", value: "0" }));
    }),
    error: "declarations do not match the exact contract",
  },
  {
    name: "theme-block-structural-drift",
    css: mutateTheme(galleryCss, (block) => {
      block.append(
        postcss.rule({
          selector: "input",
          nodes: [postcss.decl({ prop: "display", value: "none" })],
        }),
      );
    }),
    error: "artemis.theme block drifted",
  },
];
for (const fixture of layerNegativeFixtures) {
  let failure = "";
  try {
    verifyGalleryLayerOrder(
      fixture.css,
      `${fixture.name}-fixture.css`,
      expectedPublicUiSignature,
      expectedThemeSignature,
    );
  } catch (error) {
    if (error instanceof Error) failure = error.message;
  }
  if (!failure.includes(fixture.error)) {
    throw new Error(
      `${fixture.name} was not rejected for ${fixture.error}: ${failure}`,
    );
  }
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
  `UI Gallery verification passed (${galleryFiles.length} Gallery files; exact reset → theme → ui artifact order; ${layerNegativeFixtures.length}/${layerNegativeFixtures.length} layer-order negative fixtures rejected; ${desktopFiles.length} Desktop renderer files isolated)`,
);
