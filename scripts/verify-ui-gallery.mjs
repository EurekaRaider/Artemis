import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseCssSyntax, walk as walkCssSyntax } from "css-tree";
import postcss from "postcss";
import {
  cssResourceReferences,
  desktopGalleryImportViolations,
  htmlElements,
  htmlInlineResources,
  htmlResourceReferences,
  referenceTargetsGallery,
} from "./verify-ui-boundaries.mjs";

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
      ["max-width", "72rem"],
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
    ".gallery-axis-grid",
    [
      ["display", "flex"],
      ["flex-wrap", "wrap"],
      ["gap", "var(--artemis-space-3)"],
    ],
  ],
  [
    ".gallery-axis-control",
    [
      ["display", "inline-flex"],
      ["gap", "var(--artemis-space-1)"],
      ["margin", "0"],
      ["padding", "var(--artemis-space-1)"],
      [
        "border",
        "var(--artemis-border-width-default) solid var(--artemis-color-border-default)",
      ],
      ["border-radius", "var(--artemis-radius-card)"],
    ],
  ],
  [
    ".gallery-axis-control legend",
    [
      ["padding-inline", "var(--artemis-space-1)"],
      ["color", "var(--artemis-color-text-secondary)"],
    ],
  ],
  [
    ".gallery-axis-control button",
    [
      ["min-block-size", "var(--artemis-size-control-comfortable)"],
      ["padding-inline", "var(--artemis-space-3)"],
      ["color", "var(--artemis-color-text-secondary)"],
      ["background", "var(--artemis-color-surface-sunken)"],
      [
        "border",
        "var(--artemis-border-width-default) solid var(--artemis-color-border-default)",
      ],
      ["border-radius", "var(--artemis-radius-control)"],
      ["font", "inherit"],
    ],
  ],
  [
    '.gallery-axis-control button[aria-pressed="true"]',
    [
      ["color", "var(--artemis-color-accent-on-primary)"],
      ["background", "var(--artemis-color-accent-primary)"],
      ["border-color", "var(--artemis-color-accent-primary)"],
    ],
  ],
  [
    ".gallery-sample-section",
    [
      ["margin-block-start", "var(--artemis-space-6)"],
      ["padding", "var(--artemis-space-4)"],
      ["background", "var(--artemis-color-surface-base)"],
      [
        "border",
        "var(--artemis-border-width-default) solid var(--artemis-color-border-default)",
      ],
      ["border-radius", "var(--artemis-radius-panel)"],
      ["box-shadow", "var(--artemis-shadow-surface)"],
    ],
  ],
  [
    ".gallery-token-grid",
    [
      ["display", "grid"],
      ["grid-template-columns", "repeat(auto-fit, minmax(14rem, 1fr))"],
      ["gap", "var(--artemis-space-2)"],
      ["margin", "0"],
    ],
  ],
  [
    ".gallery-token-grid div",
    [
      ["min-inline-size", "0"],
      ["padding", "var(--artemis-space-2)"],
      ["background", "var(--artemis-color-surface-sunken)"],
      ["border-radius", "var(--artemis-radius-control)"],
    ],
  ],
  [".gallery-token-grid dt, .gallery-token-grid dd", [["margin", "0"]]],
  [
    ".gallery-token-grid dd",
    [
      ["overflow-wrap", "anywhere"],
      ["color", "var(--artemis-color-accent-text)"],
      ["font-family", "var(--artemis-typography-mono-family)"],
    ],
  ],
  [
    ".gallery-surface-grid, .gallery-radius-grid",
    [
      ["display", "grid"],
      ["grid-template-columns", "repeat(auto-fit, minmax(8rem, 1fr))"],
      ["gap", "var(--artemis-space-2)"],
    ],
  ],
  [
    ".gallery-form-grid",
    [
      ["display", "grid"],
      ["grid-template-columns", "repeat(auto-fit, minmax(15rem, 1fr))"],
      ["gap", "var(--artemis-space-4)"],
    ],
  ],
  [
    ".gallery-navigation-grid",
    [
      ["display", "grid"],
      ["grid-template-columns", "repeat(auto-fit, minmax(18rem, 1fr))"],
      ["gap", "var(--artemis-space-4)"],
      ["align-items", "start"],
    ],
  ],
  [".gallery-navigation-grid > *", [["min-inline-size", "0"]]],
  [
    ".gallery-feedback-grid",
    [
      ["display", "grid"],
      ["grid-template-columns", "repeat(auto-fit, minmax(16rem, 1fr))"],
      ["gap", "var(--artemis-space-4)"],
      ["margin-block", "var(--artemis-space-4)"],
    ],
  ],
  [
    ".gallery-pattern-grid",
    [
      ["display", "grid"],
      ["grid-template-columns", "repeat(auto-fit, minmax(18rem, 1fr))"],
      ["gap", "var(--artemis-space-4)"],
      ["align-items", "start"],
    ],
  ],
  [".gallery-pattern-grid > *", [["min-inline-size", "0"]]],
  [
    '.gallery-feedback-grid [data-artemis-component="toast"]',
    [["align-self", "start"]],
  ],
  [
    ".gallery-split-sample",
    [
      ["block-size", "22rem"],
      ["min-inline-size", "0"],
      ["margin-block-start", "var(--artemis-space-4)"],
      ["overflow", "hidden"],
      ["background", "var(--artemis-color-surface-base)"],
      [
        "border",
        "var(--artemis-border-width-default) solid var(--artemis-color-border-default)",
      ],
      ["border-radius", "var(--artemis-radius-card)"],
    ],
  ],
  [
    '.gallery-split-sample > [data-artemis-component="split-pane"]',
    [["block-size", "100%"]],
  ],
  [
    '.gallery-split-sample [data-part="primary"] [role="listbox"]',
    [
      ["display", "grid"],
      ["gap", "var(--artemis-space-1)"],
      ["padding", "var(--artemis-space-2)"],
    ],
  ],
  [
    '.gallery-split-sample [data-part="secondary"]',
    [
      ["display", "grid"],
      ["grid-template-rows", "auto minmax(0, 1fr)"],
    ],
  ],
  [
    ".gallery-split-copy",
    [
      ["margin", "0"],
      ["padding", "var(--artemis-space-4)"],
      ["line-height", "1.6"],
    ],
  ],
  [
    ".gallery-check-grid",
    [
      ["display", "flex"],
      ["flex-wrap", "wrap"],
      ["gap", "var(--artemis-space-4)"],
      ["margin-block-start", "var(--artemis-space-4)"],
    ],
  ],
  [
    ".gallery-surface-sample",
    [
      ["min-block-size", "calc(var(--artemis-size-control-comfortable) * 2)"],
      ["padding", "var(--artemis-space-3)"],
      [
        "border",
        "var(--artemis-border-width-default) solid var(--artemis-color-border-default)",
      ],
      ["border-radius", "var(--artemis-radius-card)"],
    ],
  ],
  [
    ".gallery-surface-base",
    [["background", "var(--artemis-color-surface-base)"]],
  ],
  [
    ".gallery-surface-raised",
    [
      ["background", "var(--artemis-color-surface-raised)"],
      ["box-shadow", "var(--artemis-shadow-surface)"],
    ],
  ],
  [
    ".gallery-surface-sunken",
    [["background", "var(--artemis-color-surface-sunken)"]],
  ],
  [
    ".gallery-surface-composer",
    [
      ["background", "var(--artemis-color-surface-composer)"],
      ["box-shadow", "var(--artemis-shadow-composer)"],
    ],
  ],
  [
    ".gallery-surface-user",
    [["background", "var(--artemis-color-surface-user)"]],
  ],
  [
    ".gallery-type-sample",
    [
      ["margin-block-start", "var(--artemis-space-4)"],
      ["padding", "var(--artemis-space-3)"],
      ["background", "var(--artemis-color-surface-sunken)"],
      ["border-radius", "var(--artemis-radius-card)"],
    ],
  ],
  [".gallery-type-sample p", [["margin", "0"]]],
  [".gallery-type-primary", [["color", "var(--artemis-color-text-primary)"]]],
  [
    ".gallery-type-secondary",
    [["color", "var(--artemis-color-text-secondary)"]],
  ],
  [".gallery-type-tertiary", [["color", "var(--artemis-color-text-tertiary)"]]],
  [
    ".gallery-radius-sample",
    [
      ["padding", "var(--artemis-space-3)"],
      ["background", "var(--artemis-color-accent-subtle)"],
      [
        "border",
        "var(--artemis-border-width-default) solid var(--artemis-color-accent-primary)",
      ],
    ],
  ],
  [
    ".gallery-radius-control",
    [["border-radius", "var(--artemis-radius-control)"]],
  ],
  [".gallery-radius-input", [["border-radius", "var(--artemis-radius-input)"]]],
  [".gallery-radius-card", [["border-radius", "var(--artemis-radius-card)"]]],
  [".gallery-radius-panel", [["border-radius", "var(--artemis-radius-panel)"]]],
  [
    ".gallery-radius-composer",
    [["border-radius", "var(--artemis-radius-composer)"]],
  ],
  [
    ".gallery-motion-sample",
    [
      ["display", "flex"],
      ["align-items", "center"],
      ["gap", "var(--artemis-space-2)"],
      ["margin-block-start", "var(--artemis-space-4)"],
      ["color", "var(--artemis-color-text-secondary)"],
    ],
  ],
  [
    ".gallery-motion-swatch",
    [
      ["inline-size", "var(--artemis-size-control-comfortable)"],
      ["block-size", "var(--artemis-space-2)"],
      ["background", "var(--artemis-color-accent-primary)"],
      ["border-radius", "var(--artemis-radius-pill)"],
      [
        "transition",
        "transform var(--artemis-motion-duration-fast) var(--artemis-motion-easing-standard)",
      ],
    ],
  ],
  [
    ".gallery-motion-sample:hover .gallery-motion-swatch",
    [["transform", "translateX(var(--artemis-space-4))"]],
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
const GALLERY_REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const GALLERY_REDUCED_MOTION_SIGNATURE = JSON.stringify([
  ["rule", ".gallery-motion-swatch", [["decl", "transition", "none", null]]],
  [
    "rule",
    ".gallery-motion-sample:hover .gallery-motion-swatch",
    [["decl", "transform", "none", null]],
  ],
]);
const GALLERY_NARROW_QUERY = "(max-width: 36rem)";
const GALLERY_NARROW_SIGNATURE = JSON.stringify([
  ["rule", ".gallery-split-sample", [["decl", "block-size", "26rem", null]]],
]);
const PRIVATE_GALLERY_CLASSES = new Set([
  "gallery-axis-control",
  "gallery-axis-grid",
  "gallery-eyebrow",
  "gallery-check-grid",
  "gallery-form-grid",
  "gallery-feedback-grid",
  "gallery-motion-sample",
  "gallery-motion-swatch",
  "gallery-navigation-grid",
  "gallery-probe-section",
  "gallery-radius-card",
  "gallery-radius-composer",
  "gallery-radius-control",
  "gallery-radius-grid",
  "gallery-radius-input",
  "gallery-radius-panel",
  "gallery-radius-sample",
  "gallery-sample-section",
  "gallery-surface-base",
  "gallery-surface-composer",
  "gallery-surface-grid",
  "gallery-surface-raised",
  "gallery-surface-sample",
  "gallery-surface-sunken",
  "gallery-surface-user",
  "gallery-split-copy",
  "gallery-split-sample",
  "gallery-token-grid",
  "gallery-type-primary",
  "gallery-type-sample",
  "gallery-type-secondary",
  "gallery-type-tertiary",
]);
const PRIVATE_GALLERY_ATTRIBUTES = new Set([
  "data-gallery-active-contrast",
  "data-gallery-active-skin",
  "data-gallery-active-theme",
  "data-gallery-event-order",
  "data-gallery-stress-skin",
  "data-gallery-token",
  "data-gallery-token-provenance",
]);
const PRIVATE_GALLERY_TEXT_MARKERS = [
  "@artemis/ui-gallery",
  "Artemis UI Gallery",
  "CL4 agent pattern conformance",
  "com.artemis.synthetic-stress",
];

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
  let reducedMotionBlocks = 0;
  let narrowBlocks = 0;
  for (const node of block.nodes ?? []) {
    if (node.type === "atrule") {
      if (
        node.name === "media" &&
        normalizeWhitespace(node.params) === GALLERY_NARROW_QUERY
      ) {
        narrowBlocks += 1;
        if (narrowBlocks > 1) {
          throw new Error(`${source}: duplicate Gallery narrow media block`);
        }
        const signature = JSON.stringify(
          (node.nodes ?? []).map(cssNodeSignature),
        );
        if (signature !== GALLERY_NARROW_SIGNATURE) {
          throw new Error(
            `${source}: Gallery narrow media block does not match the exact contract`,
          );
        }
        continue;
      }
      if (
        node.name !== "media" ||
        normalizeWhitespace(node.params) !== GALLERY_REDUCED_MOTION_QUERY
      ) {
        throw new Error(
          `${source}: Gallery scaffold at-rule is not allowed: @${node.name} ${node.params}`,
        );
      }
      reducedMotionBlocks += 1;
      if (reducedMotionBlocks > 1) {
        throw new Error(
          `${source}: duplicate Gallery reduced-motion media block`,
        );
      }
      const signature = JSON.stringify(
        (node.nodes ?? []).map(cssNodeSignature),
      );
      if (signature !== GALLERY_REDUCED_MOTION_SIGNATURE) {
        throw new Error(
          `${source}: Gallery reduced-motion media block does not match the exact contract`,
        );
      }
      continue;
    }
    if (node.type !== "rule") {
      throw new Error(
        `${source}: Gallery scaffold artemis.ui block allows only rules and the exact reduced-motion media block`,
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
  if (reducedMotionBlocks !== 1) {
    throw new Error(`${source}: Gallery reduced-motion media block is missing`);
  }
  if (narrowBlocks !== 1) {
    throw new Error(`${source}: Gallery narrow media block is missing`);
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

function verifyGalleryHtmlResources(html, source, galleryDist, galleryFiles) {
  const assetFiles = galleryFiles.filter((path) =>
    [".css", ".js"].includes(extname(path)),
  );
  const expected = new Map(
    assetFiles.map((path) => [
      `./${relative(galleryDist, path).split(sep).join("/")}`,
      extname(path) === ".css"
        ? { attribute: "href", tagName: "link" }
        : { attribute: "src", tagName: "script" },
    ]),
  );
  const seen = new Set();
  for (const resource of htmlResourceReferences(html)) {
    const expectedElement = expected.get(resource.reference);
    if (
      resource.attribute === "srcset" ||
      expectedElement === undefined ||
      resource.attribute !== expectedElement.attribute ||
      resource.tagName !== expectedElement.tagName ||
      (resource.tagName === "script" &&
        resource.attributes.type !== "module") ||
      (resource.tagName === "link" && resource.attributes.rel !== "stylesheet")
    ) {
      throw new Error(
        `${source}: Gallery HTML resource is not an expected local build asset: ${resource.tagName}[${resource.attribute}]=${resource.reference}`,
      );
    }
    if (seen.has(resource.reference)) {
      throw new Error(
        `${source}: Gallery HTML resource is duplicated: ${resource.reference}`,
      );
    }
    const target = resolve(galleryDist, resource.reference);
    if (
      !target.startsWith(`${resolve(galleryDist)}${sep}`) ||
      !galleryFiles.includes(target)
    ) {
      throw new Error(
        `${source}: Gallery HTML resource does not resolve to an emitted file: ${resource.reference}`,
      );
    }
    seen.add(resource.reference);
  }
  if (
    seen.size !== expected.size ||
    [...expected.keys()].some((reference) => !seen.has(reference))
  ) {
    throw new Error(
      `${source}: Gallery HTML must reference every expected CSS/JS build asset exactly once`,
    );
  }
}

async function verifyGalleryHtmlArtifacts(
  galleryFiles,
  galleryDist,
  readText = (path) => readFile(path, "utf8"),
) {
  const htmlFiles = galleryFiles.filter((path) => extname(path) === ".html");
  if (
    htmlFiles.length !== 1 ||
    relative(galleryDist, htmlFiles[0]).split(sep).join("/") !== "index.html"
  ) {
    throw new Error(
      `UI Gallery must emit exactly one index.html page; found ${htmlFiles.length} HTML files`,
    );
  }
  const html = await readText(htmlFiles[0]);
  verifyGalleryHtmlResources(
    html,
    relative(root, htmlFiles[0]),
    galleryDist,
    galleryFiles,
  );
  return { html, path: htmlFiles[0] };
}

const galleryDist = join(root, "apps/ui-gallery/dist");
const galleryFiles = await filesBelow(galleryDist);
const { html: galleryIndex } = await verifyGalleryHtmlArtifacts(
  galleryFiles,
  galleryDist,
);
let extraHtmlFailure = "";
try {
  await verifyGalleryHtmlArtifacts(
    [...galleryFiles, join(galleryDist, "help.html")],
    galleryDist,
    async (path) =>
      path === join(galleryDist, "help.html")
        ? "<!doctype html><title>Help</title>"
        : readFile(path, "utf8"),
  );
} catch (error) {
  if (error instanceof Error) extraHtmlFailure = error.message;
}
if (!extraHtmlFailure.includes("exactly one index.html page")) {
  throw new Error(
    `additional HTML page was not rejected by the Gallery single-page gate: ${extraHtmlFailure}`,
  );
}
const htmlNegativeFixtures = [
  {
    name: "external-script",
    html: galleryIndex.replace(
      /src="\.\/assets\/[^"]+\.js"/u,
      'src="https://example.invalid/gallery.js"',
    ),
  },
  {
    name: "protocol-relative-script",
    html: galleryIndex.replace(
      /src="\.\/assets\/[^"]+\.js"/u,
      'src="//example.invalid/gallery.js"',
    ),
  },
  {
    name: "root-absolute-script",
    html: galleryIndex.replace(
      /src="\.\/assets\/[^"]+\.js"/u,
      'src="/assets/gallery.js"',
    ),
  },
  {
    name: "additional-local-script",
    html: galleryIndex.replace(
      "</head>",
      '<script type="module" src="./assets/extra.js"></script></head>',
    ),
  },
  {
    name: "external-stylesheet",
    html: galleryIndex.replace(
      /href="\.\/assets\/[^"]+\.css"/u,
      'href="https://example.invalid/gallery.css"',
    ),
  },
  {
    name: "additional-local-link",
    html: galleryIndex.replace(
      "</head>",
      '<link rel="stylesheet" href="./assets/extra.css"></head>',
    ),
  },
  {
    name: "srcset-resource",
    html: galleryIndex.replace(
      "</body>",
      '<img alt="" srcset="./assets/extra.png 1x, https://example.invalid/extra.png 2x"></body>',
    ),
  },
];
for (const fixture of htmlNegativeFixtures) {
  let failure = "";
  try {
    verifyGalleryHtmlResources(
      fixture.html,
      `${fixture.name}-fixture.html`,
      galleryDist,
      galleryFiles,
    );
  } catch (error) {
    if (error instanceof Error) failure = error.message;
  }
  if (!failure.includes("Gallery HTML resource")) {
    throw new Error(
      `${fixture.name} was not rejected by the Gallery HTML resource gate: ${failure}`,
    );
  }
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
    name: "gallery-missing-reduced-motion",
    css: mutateGalleryUi(galleryCss, (block) => {
      block.nodes
        .find(
          (node) =>
            node.type === "atrule" &&
            node.name === "media" &&
            normalizeWhitespace(node.params) === GALLERY_REDUCED_MOTION_QUERY,
        )
        .remove();
    }),
    error: "Gallery reduced-motion media block is missing",
  },
  {
    name: "gallery-changed-reduced-motion-query",
    css: mutateGalleryUi(galleryCss, (block) => {
      block.nodes.find(
        (node) =>
          node.type === "atrule" &&
          node.name === "media" &&
          normalizeWhitespace(node.params) === GALLERY_REDUCED_MOTION_QUERY,
      ).params = "(prefers-reduced-motion: no-preference)";
    }),
    error: "Gallery scaffold at-rule is not allowed",
  },
  {
    name: "gallery-changed-reduced-motion-value",
    css: mutateGalleryUi(galleryCss, (block) => {
      const media = block.nodes.find(
        (node) =>
          node.type === "atrule" &&
          node.name === "media" &&
          normalizeWhitespace(node.params) === GALLERY_REDUCED_MOTION_QUERY,
      );
      media.nodes[0].nodes[0].value = "transform 1s linear";
    }),
    error:
      "Gallery reduced-motion media block does not match the exact contract",
  },
  {
    name: "gallery-duplicate-reduced-motion",
    css: mutateGalleryUi(galleryCss, (block) => {
      const media = block.nodes.find(
        (node) =>
          node.type === "atrule" &&
          node.name === "media" &&
          normalizeWhitespace(node.params) === GALLERY_REDUCED_MOTION_QUERY,
      );
      block.append(media.clone());
    }),
    error: "duplicate Gallery reduced-motion media block",
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
  "Artemis UI Gallery",
  "CL4 agent pattern conformance",
  "com.artemis.synthetic-stress",
  "data-artemis-component",
  "data-gallery-active-skin",
  "data-gallery-active-theme",
  "data-gallery-active-contrast",
  "data-gallery-token-provenance",
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

function exactPrivateAttribute(name, value) {
  return (
    PRIVATE_GALLERY_ATTRIBUTES.has(name) ||
    (name === "data-artemis-component" && value === "conformance-probe")
  );
}

async function verifyDesktopCssArtifact(source, path) {
  const parsed = postcss.parse(source, { from: path });
  parsed.walkRules((rule) => {
    const selectorAst = parseCssSyntax(rule.selector, {
      context: "selectorList",
    });
    walkCssSyntax(selectorAst, (node) => {
      if (
        node.type === "ClassSelector" &&
        PRIVATE_GALLERY_CLASSES.has(node.name)
      ) {
        throw new Error(
          `${relative(root, path)}: Desktop CSS contains private Gallery selector .${node.name}`,
        );
      }
      if (node.type === "AttributeSelector") {
        const name = node.name?.name;
        const value = node.value?.value;
        if (exactPrivateAttribute(name, value)) {
          throw new Error(
            `${relative(root, path)}: Desktop CSS contains private Gallery attribute selector ${name}`,
          );
        }
      }
    });
  });
  parsed.walkAtRules((rule) => {
    if (rule.name === "layer" && rule.params.trim() === "artemis.gallery") {
      throw new Error(
        `${relative(root, path)}: Desktop CSS contains private Gallery at-rule`,
      );
    }
  });
  for (const reference of cssResourceReferences(source, path)) {
    if (await referenceTargetsGallery(root, path, reference)) {
      throw new Error(
        `${relative(root, path)}: Desktop CSS resource references private Gallery content: ${reference}`,
      );
    }
  }
}

async function verifyDesktopHtmlArtifact(source, path) {
  for (const element of htmlElements(source)) {
    for (const [name, value] of Object.entries(element.attributes)) {
      if (exactPrivateAttribute(name, value)) {
        throw new Error(
          `${relative(root, path)}: Desktop HTML contains private Gallery attribute ${name}`,
        );
      }
      if (
        name === "class" &&
        value
          .split(/\s+/u)
          .some((className) => PRIVATE_GALLERY_CLASSES.has(className))
      ) {
        throw new Error(
          `${relative(root, path)}: Desktop HTML contains a private Gallery class`,
        );
      }
    }
  }
  for (const resource of htmlResourceReferences(source)) {
    if (await referenceTargetsGallery(root, path, resource.reference)) {
      throw new Error(
        `${relative(root, path)}: Desktop HTML resource references private Gallery content: ${resource.reference}`,
      );
    }
  }
  const inline = htmlInlineResources(source, path);
  for (const script of inline.scripts) {
    if (script.computed || script.invalid) {
      throw new Error(
        `${relative(root, path)}: Desktop HTML inline script module references must be static`,
      );
    }
    for (const reference of script.references) {
      if (await referenceTargetsGallery(root, path, reference)) {
        throw new Error(
          `${relative(root, path)}: Desktop HTML inline script references private Gallery content: ${reference}`,
        );
      }
    }
    verifyDesktopScriptArtifact(script.content, path);
  }
  for (const style of inline.styles) {
    await verifyDesktopCssArtifact(style.content, path);
  }
}

function verifyDesktopScriptArtifact(source, path) {
  if (
    source.includes("data-artemis-component") &&
    source.includes("conformance-probe")
  ) {
    throw new Error(
      `${relative(root, path)}: Desktop script contains private ConformanceProbe marker`,
    );
  }
  const exactMarkers = [
    ...PRIVATE_GALLERY_TEXT_MARKERS,
    ...PRIVATE_GALLERY_ATTRIBUTES,
    "@artemis/ui/conformance",
  ];
  for (const marker of exactMarkers) {
    if (source.includes(marker)) {
      throw new Error(
        `${relative(root, path)}: Desktop script contains private Gallery marker: ${marker}`,
      );
    }
  }
}

async function verifyDesktopArtifacts(
  files,
  desktopBase,
  galleryStaticAssets,
  readArtifact = readFile,
) {
  for (const path of files) {
    const extension = extname(path);
    if (extension === ".css") {
      await verifyDesktopCssArtifact(await readArtifact(path, "utf8"), path);
      continue;
    }
    if (extension === ".html") {
      await verifyDesktopHtmlArtifact(await readArtifact(path, "utf8"), path);
      continue;
    }
    if ([".js", ".cjs", ".mjs"].includes(extension)) {
      verifyDesktopScriptArtifact(await readArtifact(path, "utf8"), path);
      continue;
    }
    const content = await readArtifact(path);
    const emittedPath = relative(desktopBase, path).split(sep).join("/");
    for (const asset of galleryStaticAssets) {
      if (
        emittedPath === asset.relativePath &&
        content.length > 0 &&
        content.equals(asset.content)
      ) {
        throw new Error(
          `${relative(root, path)}: Desktop emitted a private Gallery static asset`,
        );
      }
    }
  }
}

async function galleryExclusiveStaticAssets() {
  const publicRoot = join(root, "apps/ui-gallery/public");
  let files;
  try {
    files = await filesBelow(publicRoot);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const assets = [];
  for (const path of files) {
    const relativePath = relative(publicRoot, path).split(sep).join("/");
    if (!/(^|[/_.-])(?:ui-)?gallery([/_.-]|$)/iu.test(relativePath)) continue;
    const content = await readFile(path);
    if (content.length > 0) assets.push({ content, relativePath });
  }
  return assets;
}

const safeDesktopFixtureFiles = [
  join(root, "apps/desktop/dist-renderer/safe.css"),
  join(root, "apps/desktop/dist-renderer/safe.html"),
  join(root, "apps/desktop/dist-renderer/safe.js"),
];
const safeDesktopFixtureContent = new Map([
  [
    safeDesktopFixtureFiles[0],
    '.docs-gallery-example { background: url("https://docs.gallery-example/image.png"); }',
  ],
  [
    safeDesktopFixtureFiles[1],
    '<!doctype html><title>docs.gallery-example</title><p>Example: import("../ui-gallery/src/main.tsx")</p><script type="application/json">{"example":"@artemis/ui/conformance"}</script><a href="https://docs.gallery-example">Docs</a>',
  ],
  [safeDesktopFixtureFiles[2], 'const docs = "https://docs.gallery-example";'],
]);
await verifyDesktopArtifacts(
  safeDesktopFixtureFiles,
  join(root, "apps/desktop/dist-renderer"),
  [],
  async (path) => safeDesktopFixtureContent.get(path),
);

const desktopArtifactNegativeFixtures = [
  {
    name: "private-css-selector",
    path: join(root, "apps/desktop/dist-renderer/assets/private.css"),
    content: ".gallery-eyebrow { display: block; }",
    assets: [],
    error: "private Gallery selector",
  },
  {
    name: "private-css-at-rule",
    path: join(root, "apps/desktop/dist-renderer/assets/private.css"),
    content: "@layer artemis.gallery { .safe { display: block; } }",
    assets: [],
    error: "private Gallery at-rule",
  },
  {
    name: "private-css-resource",
    path: join(root, "apps/desktop/dist-renderer/assets/private.css"),
    content: '@import "../../../ui-gallery/src/gallery.css";',
    assets: [],
    error: "private Gallery content",
  },
  {
    name: "private-html-attribute",
    path: join(root, "apps/desktop/dist-renderer/private.html"),
    content: "<!doctype html><output data-gallery-active-skin></output>",
    assets: [],
    error: "private Gallery attribute",
  },
  {
    name: "private-script-marker",
    path: join(root, "apps/desktop/dist-renderer/private.js"),
    content: 'const marker = "data-gallery-stress-skin";',
    assets: [],
    error: "private Gallery marker",
  },
  {
    name: "private-probe-object-marker",
    path: join(root, "apps/desktop/dist-renderer/private.js"),
    content: 'const props={"data-artemis-component":"conformance-probe"};',
    assets: [],
    error: "private ConformanceProbe marker",
  },
  {
    name: "private-probe-template-marker",
    path: join(root, "apps/desktop/dist-renderer/private.js"),
    content: "const name=`data-artemis-component`,value=`conformance-probe`;",
    assets: [],
    error: "private ConformanceProbe marker",
  },
  {
    name: "private-conformance-subpath-marker",
    path: join(root, "apps/desktop/dist-renderer/private.js"),
    content: 'import("@artemis/ui/conformance");',
    assets: [],
    error: "private Gallery marker",
  },
  {
    name: "private-html-inline-probe-marker",
    path: join(root, "apps/desktop/dist-renderer/private.html"),
    content:
      '<!doctype html><script>const props={"data-artemis-component":"conformance-probe"}</script>',
    assets: [],
    error: "private ConformanceProbe marker",
  },
  {
    name: "private-html-inline-gallery-import",
    path: join(root, "apps/desktop/dist-renderer/private.html"),
    content:
      '<!doctype html><script type="module">import("../../ui-gallery/src/main.tsx")</script>',
    assets: [],
    error: "private Gallery content",
  },
  {
    name: "private-html-inline-legacy-javascript-import",
    path: join(root, "apps/desktop/dist-renderer/private.html"),
    content:
      '<!doctype html><script type=" Application/X-JavaScript ; Charset=UTF-8 ">import("../../ui-gallery/src/main.tsx")</script>',
    assets: [],
    error: "private Gallery content",
  },
  {
    name: "private-html-inline-gallery-style",
    path: join(root, "apps/desktop/dist-renderer/private.html"),
    content:
      '<!doctype html><style>@import "../../ui-gallery/src/gallery.css";</style>',
    assets: [],
    error: "private Gallery content",
  },
  {
    name: "private-html-style-attribute",
    path: join(root, "apps/desktop/dist-renderer/private.html"),
    content:
      '<!doctype html><div style="background:url(../../ui-gallery/src/gallery.css)"></div>',
    assets: [],
    error: "private Gallery content",
  },
  {
    name: "private-static-asset",
    path: join(root, "apps/desktop/dist-renderer/gallery-logo.bin"),
    content: Buffer.from("gallery-only-binary"),
    assets: [
      {
        relativePath: "gallery-logo.bin",
        content: Buffer.from("gallery-only-binary"),
      },
    ],
    error: "private Gallery static asset",
  },
];
for (const fixture of desktopArtifactNegativeFixtures) {
  let failure = "";
  try {
    await verifyDesktopArtifacts(
      [fixture.path],
      join(root, "apps/desktop/dist-renderer"),
      fixture.assets,
      async (_path, encoding) =>
        encoding === "utf8" && Buffer.isBuffer(fixture.content)
          ? fixture.content.toString("utf8")
          : fixture.content,
    );
  } catch (error) {
    if (error instanceof Error) failure = error.message;
  }
  if (!failure.includes(fixture.error)) {
    throw new Error(
      `${fixture.name} was not rejected by the Desktop artifact gate: ${failure}`,
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
const desktopGalleryImports = await desktopGalleryImportViolations(root);
if (desktopGalleryImports.length > 0) {
  throw new Error(desktopGalleryImports.join("\n"));
}

const desktopDist = join(root, "apps/desktop/dist-renderer");
const desktopFiles = await filesBelow(desktopDist);
await verifyDesktopArtifacts(
  desktopFiles,
  desktopDist,
  await galleryExclusiveStaticAssets(),
);

console.log(
  `UI Gallery verification passed (${galleryFiles.length} Gallery files; ${htmlNegativeFixtures.length + 1}/${htmlNegativeFixtures.length + 1} HTML artifact fixtures rejected; exact reset → theme → ui artifact order; ${layerNegativeFixtures.length}/${layerNegativeFixtures.length} layer-order negative fixtures rejected; ${desktopArtifactNegativeFixtures.length}/${desktopArtifactNegativeFixtures.length} Desktop artifact fixtures rejected; ${desktopFiles.length} Desktop renderer files isolated)`,
);
