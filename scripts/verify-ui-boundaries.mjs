import { readFile, readdir, realpath } from "node:fs/promises";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { API } from "typescript/unstable/sync";
import {
  SyntaxKind,
  isAssertionExpression,
  isCallExpression,
  isElementAccessExpression,
  isExportDeclaration,
  isExternalModuleReference,
  isIdentifier,
  isImportDeclaration,
  isImportEqualsDeclaration,
  isNoSubstitutionTemplateLiteral,
  isNonNullExpression,
  isObjectBindingPattern,
  isParenthesizedExpression,
  isPropertyAccessExpression,
  isSatisfiesExpression,
  isStringLiteral,
  isVariableDeclaration,
} from "typescript/unstable/ast";

const defaultRoot = fileURLToPath(new URL("../", import.meta.url));
const SOURCE_EXTENSIONS = new Set([
  ".css",
  ".js",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx",
]);
const SCRIPT_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const FORBIDDEN_ARTEMIS_PACKAGES = new Set([
  "@artemis/agent-host",
  "@artemis/desktop",
  "@artemis/platform",
  "@artemis/protocol",
]);
const NODE_GLOBAL_NAMES = new Set([
  "Buffer",
  "__dirname",
  "__filename",
  "process",
]);
const DOM_GLOBAL_NAMES = new Set([
  "HTMLElement",
  "document",
  "navigator",
  "window",
]);
const TRUSTED_DESKTOP_COMPUTED_IMPORT =
  "apps/desktop/src/extension/extension-worker.ts";

const AREAS = [
  {
    name: "theme-contract",
    source: "packages/theme-contract/src",
    allowedBare: [],
    pureContract: true,
  },
  {
    name: "ui",
    source: "packages/ui/src",
    allowedBare: ["react", "react-dom"],
  },
  {
    name: "theme-artemis",
    source: "packages/theme-artemis/src",
    allowedBare: ["@artemis/theme-contract"],
  },
  {
    name: "ui-gallery",
    source: "apps/ui-gallery/src",
    allowedBare: [
      "@artemis/theme-artemis",
      "@artemis/theme-contract",
      "@artemis/ui",
      "react",
      "react-dom",
    ],
  },
];

async function filesBelow(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(path)));
    else if (SOURCE_EXTENSIONS.has(extname(entry.name))) files.push(path);
  }
  return files;
}

function stringLiteralText(node) {
  return isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : undefined;
}

function unwrapExpression(node) {
  let current = node;
  while (
    isParenthesizedExpression(current) ||
    isAssertionExpression(current) ||
    isNonNullExpression(current) ||
    isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function memberName(node) {
  if (isPropertyAccessExpression(node)) return node.name.text;
  if (
    isElementAccessExpression(node) &&
    node.argumentExpression !== undefined
  ) {
    return stringLiteralText(node.argumentExpression);
  }
  return undefined;
}

function windowRoot(node) {
  const root = unwrapExpression(node);
  if (
    isIdentifier(root) &&
    (root.text === "window" ||
      root.text === "globalThis" ||
      root.text === "self")
  ) {
    return root.text;
  }
  if (
    (isPropertyAccessExpression(root) || isElementAccessExpression(root)) &&
    (memberName(root) === "window" || memberName(root) === "self")
  ) {
    const parentRoot = windowRoot(root.expression);
    if (parentRoot !== undefined) return `${parentRoot}.${memberName(root)}`;
  }
  return undefined;
}

function bindingPropertyName(element) {
  const property = element.propertyName ?? element.name;
  return isIdentifier(property) ? property.text : stringLiteralText(property);
}

function identifierCanReferenceGlobal(node) {
  const parent = node.parent;
  return (
    parent === undefined ||
    parent.name !== node ||
    parent.kind === SyntaxKind.ShorthandPropertyAssignment
  );
}

function containsCssImportRule(source) {
  let quote;
  let comment = false;
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (comment) {
      if (current === "*" && next === "/") {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== undefined) {
      if (current === "\\") index += 1;
      else if (current === quote) quote = undefined;
      continue;
    }
    if (current === "/" && next === "*") {
      comment = true;
      index += 1;
      continue;
    }
    if (current === '"' || current === "'") {
      quote = current;
      continue;
    }
    if (current === "@") {
      const identifier = source.slice(index + 1).match(/^[A-Za-z0-9_-]+/u)?.[0];
      if (identifier?.toLowerCase() === "import") return true;
    }
  }
  return false;
}

export function collectTypeScriptReferences(sourceFile) {
  const moduleReferences = [];
  const bridgeAccesses = [];
  const computedDynamicImports = [];
  const globalIdentifiers = [];
  let usesRequire = false;

  const addReference = (node, kind) => {
    const specifier = stringLiteralText(node);
    if (specifier !== undefined)
      moduleReferences.push({ kind, node, specifier });
    return specifier !== undefined;
  };

  const visit = (node) => {
    if (isImportDeclaration(node) && node.moduleSpecifier !== undefined) {
      addReference(node.moduleSpecifier, "import");
    } else if (
      isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined
    ) {
      addReference(node.moduleSpecifier, "export");
    } else if (
      isImportEqualsDeclaration(node) &&
      isExternalModuleReference(node.moduleReference)
    ) {
      usesRequire = true;
      const expression = node.moduleReference.expression;
      if (expression !== undefined) addReference(expression, "import-equals");
    } else if (isCallExpression(node)) {
      if (node.expression.kind === SyntaxKind.ImportKeyword) {
        if (
          node.arguments.length !== 1 ||
          !addReference(node.arguments[0], "dynamic-import")
        ) {
          computedDynamicImports.push({
            argument: node.arguments[0],
            node,
          });
        }
      } else {
        const expression = unwrapExpression(node.expression);
        const directRequire =
          isIdentifier(expression) && expression.text === "require";
        const requireMethod =
          isPropertyAccessExpression(expression) &&
          isIdentifier(unwrapExpression(expression.expression)) &&
          unwrapExpression(expression.expression).text === "require";
        if (directRequire || requireMethod) {
          usesRequire = true;
          if (node.arguments.length === 1) {
            addReference(node.arguments[0], "require");
          }
        }
      }
    }

    if (isPropertyAccessExpression(node)) {
      const root = windowRoot(node.expression);
      if (root !== undefined && node.name.text === "artemis") {
        bridgeAccesses.push(`${root}.artemis`);
      }
    } else if (isElementAccessExpression(node)) {
      const root = windowRoot(node.expression);
      if (
        root !== undefined &&
        node.argumentExpression !== undefined &&
        stringLiteralText(node.argumentExpression) === "artemis"
      ) {
        bridgeAccesses.push(`${root}["artemis"]`);
      }
    } else if (
      isVariableDeclaration(node) &&
      isObjectBindingPattern(node.name) &&
      node.initializer !== undefined
    ) {
      const root = windowRoot(node.initializer);
      if (
        root !== undefined &&
        node.name.elements.some(
          (element) => bindingPropertyName(element) === "artemis",
        )
      ) {
        bridgeAccesses.push(`${root} destructures artemis`);
      }
    }

    if (
      isIdentifier(node) &&
      identifierCanReferenceGlobal(node) &&
      (NODE_GLOBAL_NAMES.has(node.text) || DOM_GLOBAL_NAMES.has(node.text))
    ) {
      globalIdentifiers.push({ name: node.text, node });
    }

    node.forEachChild(visit);
  };
  visit(sourceFile);
  return {
    bridgeAccesses,
    computedDynamicImports,
    globalIdentifiers,
    moduleReferences,
    usesRequire,
  };
}

function createTypeScriptAnalysis(root, files) {
  const api = new API({ cwd: root });
  const snapshot = api.updateSnapshot({ openFiles: files });
  return {
    close() {
      snapshot.dispose();
      api.close();
    },
    file(file) {
      const project = snapshot.getDefaultProjectForFile(file);
      const sourceFile = project?.program.getSourceFile(file);
      if (project === undefined || sourceFile === undefined) {
        throw new Error(`TypeScript could not analyze ${relative(root, file)}`);
      }
      return {
        facts: collectTypeScriptReferences(sourceFile),
        project,
      };
    },
  };
}

function bareImportAllowed(specifier, allowed) {
  return allowed.some(
    (entry) => specifier === entry || specifier.startsWith(`${entry}/`),
  );
}

function identifierIsLocal(project, file, identifier) {
  const symbol = project.checker.getSymbolAtLocation(identifier.node);
  return symbol?.declarations.some(
    (declaration) =>
      resolve(declaration.path).toLowerCase() === resolve(file).toLowerCase(),
  );
}

function inspectSource(area, file, sourceRoot, source, analysisResult) {
  const { facts, project } = analysisResult ?? {};
  const violations = [];
  const add = (message) =>
    violations.push(`${relative(sourceRoot, file)}: ${message}`);

  for (const access of facts?.bridgeAccesses ?? []) {
    add(`${access} is forbidden`);
  }
  for (const identifier of facts?.globalIdentifiers ?? []) {
    if (identifierIsLocal(project, file, identifier)) continue;
    if (NODE_GLOBAL_NAMES.has(identifier.name))
      add("Node globals are forbidden");
    else if (area.pureContract)
      add("theme-contract must not depend on DOM globals or types");
  }
  if (facts?.usesRequire === true) add("CommonJS require is forbidden");
  if (extname(file) === ".css" && containsCssImportRule(source))
    add("CSS @import is forbidden");

  if ((facts?.computedDynamicImports.length ?? 0) > 0) {
    add("computed dynamic import is forbidden");
  }

  for (const { specifier } of facts?.moduleReferences ?? []) {
    const packageName = specifier.startsWith("@")
      ? specifier.split("/").slice(0, 2).join("/")
      : specifier.split("/")[0];
    if (
      FORBIDDEN_ARTEMIS_PACKAGES.has(packageName) ||
      packageName === "electron" ||
      packageName?.startsWith("node:")
    ) {
      add(`forbidden dependency: ${specifier}`);
      continue;
    }
    if (specifier.includes("/src/") || specifier.endsWith("/src")) {
      add(`private source import is forbidden: ${specifier}`);
      continue;
    }
    if (isAbsolute(specifier)) {
      add(`absolute import is forbidden: ${specifier}`);
      continue;
    }
    if (specifier.startsWith(".")) {
      const target = resolve(dirname(file), specifier);
      if (target !== sourceRoot && !target.startsWith(`${sourceRoot}${sep}`)) {
        add(`relative traversal leaves the package source: ${specifier}`);
      }
      continue;
    }
    if (!bareImportAllowed(specifier, area.allowedBare)) {
      add(`bare import is not on the layer allowlist: ${specifier}`);
    }
  }
  return violations;
}

function pathInside(path, directory) {
  const normalizedPath = resolve(path).toLowerCase();
  const normalizedDirectory = resolve(directory).toLowerCase();
  return (
    normalizedPath === normalizedDirectory ||
    normalizedPath.startsWith(`${normalizedDirectory}${sep}`)
  );
}

async function realPathInside(path, directory) {
  try {
    return pathInside(await realpath(path), await realpath(directory));
  } catch {
    return false;
  }
}

function pathPatternCapture(pattern, specifier) {
  const wildcard = pattern.indexOf("*");
  if (wildcard === -1) return pattern === specifier ? "" : undefined;
  const prefix = pattern.slice(0, wildcard);
  const suffix = pattern.slice(wildcard + 1);
  if (
    !specifier.startsWith(prefix) ||
    !specifier.endsWith(suffix) ||
    specifier.length < prefix.length + suffix.length
  ) {
    return undefined;
  }
  return specifier.slice(prefix.length, specifier.length - suffix.length);
}

async function pathsAliasTargetsGallery(project, specifier, galleryRoot) {
  const { baseUrl, paths, pathsBasePath } = project.compilerOptions;
  if (paths === undefined || typeof paths !== "object") return false;
  const bases = [
    pathsBasePath,
    baseUrl,
    dirname(project.configFileName),
  ].filter(
    (base, index, all) =>
      typeof base === "string" && all.indexOf(base) === index,
  );
  for (const [pattern, substitutions] of Object.entries(paths)) {
    const capture = pathPatternCapture(pattern, specifier);
    if (capture === undefined || !Array.isArray(substitutions)) continue;
    for (const substitution of substitutions) {
      if (typeof substitution !== "string") continue;
      const expanded = substitution.replace("*", capture);
      const targets = isAbsolute(expanded)
        ? [expanded]
        : bases.map((base) => resolve(base, expanded));
      for (const target of targets) {
        if (
          pathInside(target, galleryRoot) ||
          (await realPathInside(target, galleryRoot))
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function trustedDesktopComputedImport(root, file, facts, computedImport) {
  return (
    relative(root, file) === TRUSTED_DESKTOP_COMPUTED_IMPORT &&
    facts.computedDynamicImports.length === 1 &&
    computedImport.argument !== undefined &&
    isIdentifier(computedImport.argument) &&
    computedImport.argument.text === "loaderUrl"
  );
}

async function inspectDesktopGalleryImports(root, file, analysis) {
  const violations = [];
  const galleryRoot = join(root, "apps/ui-gallery");
  const { facts, project } = analysis.file(file);
  for (const reference of facts.moduleReferences) {
    const { specifier } = reference;
    const packageName = specifier.startsWith("@")
      ? specifier.split("/").slice(0, 2).join("/")
      : specifier.split("/")[0];
    const relativeTarget = specifier.startsWith(".")
      ? resolve(dirname(file), specifier)
      : undefined;
    const moduleSymbol = project.checker.getSymbolAtLocation(reference.node);
    const aliasTargetsGallery = await pathsAliasTargetsGallery(
      project,
      specifier,
      galleryRoot,
    );
    let resolvedIntoGallery = false;
    for (const declaration of moduleSymbol?.declarations ?? []) {
      if (
        pathInside(declaration.path, galleryRoot) ||
        (await realPathInside(declaration.path, galleryRoot))
      ) {
        resolvedIntoGallery = true;
        break;
      }
    }
    if (
      packageName === "@artemis/ui-gallery" ||
      (relativeTarget !== undefined &&
        pathInside(relativeTarget, galleryRoot)) ||
      aliasTargetsGallery ||
      resolvedIntoGallery === true
    ) {
      violations.push(
        `${relative(root, file)}: Desktop must not import UI Gallery: ${specifier}`,
      );
    }
  }
  for (const computedImport of facts.computedDynamicImports) {
    if (!trustedDesktopComputedImport(root, file, facts, computedImport)) {
      violations.push(
        `${relative(root, file)}: Desktop computed dynamic import is forbidden`,
      );
    }
  }
  return violations;
}

export async function desktopGalleryImportViolations(root = defaultRoot) {
  const desktopRoot = join(root, "apps/desktop/src");
  const files = (await filesBelow(desktopRoot)).filter((file) =>
    SCRIPT_EXTENSIONS.has(extname(file)),
  );
  const analysis = createTypeScriptAnalysis(root, files);
  try {
    const violations = [];
    for (const file of files) {
      violations.push(
        ...(await inspectDesktopGalleryImports(root, file, analysis)),
      );
    }
    return violations;
  } finally {
    analysis.close();
  }
}

async function manifestViolations(root) {
  const readJson = async (path) =>
    JSON.parse(await readFile(join(root, path), "utf8"));
  const violations = [];
  const rootManifest = await readJson("package.json");
  const contract = await readJson("packages/theme-contract/package.json");
  const ui = await readJson("packages/ui/package.json");
  const theme = await readJson("packages/theme-artemis/package.json");
  const gallery = await readJson("apps/ui-gallery/package.json");
  const desktop = await readJson("apps/desktop/package.json");

  if (contract.dependencies !== undefined) {
    violations.push(
      "packages/theme-contract/package.json: runtime dependencies are forbidden",
    );
  }
  for (const [path, manifest] of [
    ["packages/theme-contract/package.json", contract],
    ["packages/ui/package.json", ui],
    ["packages/theme-artemis/package.json", theme],
  ]) {
    if (manifest.private !== true) {
      violations.push(`${path}: public UI workspaces must remain private`);
    }
  }
  if (ui.dependencies !== undefined) {
    violations.push(
      "packages/ui/package.json: bundled runtime dependencies are forbidden",
    );
  }
  if (
    JSON.stringify(Object.keys(ui.peerDependencies ?? {}).sort()) !==
    JSON.stringify(["react", "react-dom"])
  ) {
    violations.push(
      "packages/ui/package.json: React and ReactDOM must be the only peers",
    );
  }
  if (
    JSON.stringify(theme.dependencies ?? {}) !==
    JSON.stringify({ "@artemis/theme-contract": rootManifest.version })
  ) {
    violations.push(
      "packages/theme-artemis/package.json: theme-contract must be the only dependency",
    );
  }
  if (gallery.private !== true) {
    violations.push(
      "apps/ui-gallery/package.json: Gallery must remain private",
    );
  }
  const desktopDependencySections = [
    desktop.dependencies,
    desktop.devDependencies,
    desktop.optionalDependencies,
    desktop.peerDependencies,
  ];
  if (
    desktopDependencySections.some(
      (dependencies) => "@artemis/ui-gallery" in (dependencies ?? {}),
    )
  ) {
    violations.push(
      "apps/desktop/package.json: Desktop must not depend on Gallery",
    );
  }
  return violations;
}

export async function verifyUiBoundaries(root = defaultRoot) {
  const violations = await manifestViolations(root);
  const areaFiles = [];
  for (const area of AREAS) {
    const sourceRoot = join(root, area.source);
    for (const file of await filesBelow(sourceRoot))
      areaFiles.push({ area, file, sourceRoot });
  }
  const desktopRoot = join(root, "apps/desktop/src");
  const desktopFiles = (await filesBelow(desktopRoot)).filter((file) =>
    SCRIPT_EXTENSIONS.has(extname(file)),
  );
  const scriptFiles = [
    ...areaFiles
      .map(({ file }) => file)
      .filter((file) => SCRIPT_EXTENSIONS.has(extname(file))),
    ...desktopFiles,
  ];
  const analysis = createTypeScriptAnalysis(root, scriptFiles);
  try {
    for (const { area, file, sourceRoot } of areaFiles) {
      const source = await readFile(file, "utf8");
      const analysisResult = SCRIPT_EXTENSIONS.has(extname(file))
        ? analysis.file(file)
        : undefined;
      violations.push(
        ...inspectSource(area, file, sourceRoot, source, analysisResult),
      );
    }
    for (const file of desktopFiles) {
      violations.push(
        ...(await inspectDesktopGalleryImports(root, file, analysis)),
      );
    }
  } finally {
    analysis.close();
  }
  return violations;
}

async function main() {
  const rootArgument = process.argv.indexOf("--root");
  const root =
    rootArgument === -1
      ? defaultRoot
      : resolve(process.argv[rootArgument + 1] ?? "");
  const violations = await verifyUiBoundaries(root);
  if (violations.length > 0) {
    console.error(
      ["UI boundary verification failed:", ...violations].join("\n"),
    );
    process.exitCode = 1;
    return;
  }
  console.log("UI boundary verification passed");
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
