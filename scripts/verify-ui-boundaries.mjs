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
import { parse as parseCssValue, walk as walkCssValue } from "css-tree";
import { parse as parseHtml } from "parse5";
import postcss from "postcss";
import { API } from "typescript/unstable/sync";
import {
  NodeFlags,
  SyntaxKind,
  isAssertionExpression,
  isCallExpression,
  isComputedPropertyName,
  isElementAccessExpression,
  isExportDeclaration,
  isExternalModuleReference,
  isIdentifier,
  isImportDeclaration,
  isImportEqualsDeclaration,
  isImportSpecifier,
  isMetaProperty,
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
  ".html",
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
const VITE_PATH_PROPERTY_NAMES = new Set([
  "assetsDir",
  "cacheDir",
  "envDir",
  "input",
  "outDir",
  "publicDir",
  "replacement",
  "root",
]);

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
  if (isComputedPropertyName(property)) {
    return stringLiteralText(unwrapExpression(property.expression));
  }
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
  const configPathLiterals = [];
  const globalIdentifiers = [];
  const pathResolveCalls = [];
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
      const called = unwrapExpression(node.expression);
      if (isIdentifier(called) && called.text === "resolve") {
        pathResolveCalls.push(node);
      }
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

    if (node.kind === SyntaxKind.PropertyAssignment) {
      const name = isIdentifier(node.name)
        ? node.name.text
        : stringLiteralText(node.name);
      const value = stringLiteralText(unwrapExpression(node.initializer));
      if (
        name !== undefined &&
        value !== undefined &&
        VITE_PATH_PROPERTY_NAMES.has(name)
      ) {
        configPathLiterals.push({ name, value });
      }
    }

    if (isPropertyAccessExpression(node)) {
      const root = windowRoot(node.expression);
      if (
        root !== undefined &&
        (node.name.text === "artemis" || NODE_GLOBAL_NAMES.has(node.name.text))
      ) {
        bridgeAccesses.push(`${root}.${node.name.text}`);
      }
    } else if (isElementAccessExpression(node)) {
      const root = windowRoot(node.expression);
      const property =
        node.argumentExpression === undefined
          ? undefined
          : stringLiteralText(unwrapExpression(node.argumentExpression));
      if (
        root !== undefined &&
        property !== undefined &&
        (property === "artemis" || NODE_GLOBAL_NAMES.has(property))
      ) {
        bridgeAccesses.push(`${root}[${JSON.stringify(property)}]`);
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
    configPathLiterals,
    computedDynamicImports,
    globalIdentifiers,
    moduleReferences,
    pathResolveCalls,
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

export function htmlResourceReferences(source) {
  const document = parseHtml(source);
  const references = [];
  const visit = (node) => {
    if (Array.isArray(node.attrs)) {
      for (const attribute of node.attrs) {
        if (attribute.name === "src" || attribute.name === "href") {
          references.push({
            attribute: attribute.name,
            attributes: Object.fromEntries(
              node.attrs.map((entry) => [entry.name, entry.value]),
            ),
            reference: attribute.value,
            tagName: node.tagName,
          });
        } else if (attribute.name === "srcset") {
          for (const candidate of attribute.value.split(",")) {
            const reference = candidate.trim().split(/\s+/u)[0];
            if (reference !== undefined && reference.length > 0) {
              references.push({
                attribute: attribute.name,
                attributes: Object.fromEntries(
                  node.attrs.map((entry) => [entry.name, entry.value]),
                ),
                reference,
                tagName: node.tagName,
              });
            }
          }
        }
      }
    }
    for (const child of node.childNodes ?? []) visit(child);
    if (node.content !== undefined) visit(node.content);
  };
  visit(document);
  return references;
}

function cssValueReferences(value, includeStrings) {
  const references = [];
  const ast = parseCssValue(value, { context: "value" });
  walkCssValue(ast, {
    enter(node) {
      if (node.type === "Url" || (includeStrings && node.type === "String")) {
        references.push(node.value);
      }
    },
  });
  return references;
}

function cssResourceReferences(source, from) {
  const parsed = postcss.parse(source, { from });
  const references = [];
  parsed.walkAtRules("import", (rule) => {
    references.push(...cssValueReferences(rule.params, true));
  });
  parsed.walkDecls((declaration) => {
    references.push(...cssValueReferences(declaration.value, false));
  });
  return references;
}

function localReferenceTarget(root, from, reference) {
  const trimmed = reference.trim();
  if (
    trimmed.length === 0 ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/iu.test(trimmed)
  ) {
    return undefined;
  }
  const withoutQuery = trimmed.split(/[?#]/u)[0];
  if (withoutQuery === undefined || withoutQuery.length === 0) return undefined;
  return withoutQuery.startsWith("/")
    ? resolve(root, "apps/desktop", `.${withoutQuery}`)
    : resolve(dirname(from), withoutQuery);
}

async function referenceTargetsGallery(root, from, reference) {
  const target = localReferenceTarget(root, from, reference);
  if (target === undefined) return false;
  const galleryRoot = join(root, "apps/ui-gallery");
  return (
    pathInside(target, galleryRoot) ||
    (await realPathInside(target, galleryRoot))
  );
}

async function inspectDesktopResourceFile(root, file) {
  const source = await readFile(file, "utf8");
  const references =
    extname(file) === ".css"
      ? cssResourceReferences(source, file).map((reference) => ({
          attribute: "CSS reference",
          reference,
        }))
      : htmlResourceReferences(source);
  const violations = [];
  for (const { attribute, reference } of references) {
    if (await referenceTargetsGallery(root, file, reference)) {
      violations.push(
        `${relative(root, file)}: Desktop ${attribute} must not reference UI Gallery: ${reference}`,
      );
    }
  }
  return violations;
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
  const base =
    typeof pathsBasePath === "string"
      ? pathsBasePath
      : typeof baseUrl === "string"
        ? baseUrl
        : dirname(project.configFileName);
  for (const [pattern, substitutions] of Object.entries(paths)) {
    const capture = pathPatternCapture(pattern, specifier);
    if (capture === undefined || !Array.isArray(substitutions)) continue;
    for (const substitution of substitutions) {
      if (typeof substitution !== "string") continue;
      const expanded = substitution.replace("*", capture);
      const target = isAbsolute(expanded) ? expanded : resolve(base, expanded);
      if (
        pathInside(target, galleryRoot) ||
        (await realPathInside(target, galleryRoot))
      ) {
        return true;
      }
    }
  }
  return false;
}

function uniqueConstVariableDeclaration(project, file, identifier) {
  if (!isIdentifier(identifier)) return undefined;
  const symbol = project.checker.getSymbolAtLocation(identifier);
  if (symbol?.declarations.length !== 1) return undefined;
  const handle = symbol.declarations[0];
  if (resolve(handle.path).toLowerCase() !== resolve(file).toLowerCase()) {
    return undefined;
  }
  const declaration = handle.resolve(project);
  if (
    declaration === undefined ||
    !isVariableDeclaration(declaration) ||
    (declaration.parent.flags & NodeFlags.Const) === 0
  ) {
    return undefined;
  }
  return declaration;
}

function importDeclarationFor(node) {
  let current = node;
  while (current !== undefined && !isImportDeclaration(current)) {
    current = current.parent;
  }
  return current;
}

function identifierIsNamedImport(
  project,
  identifier,
  importedName,
  moduleName,
) {
  if (!isIdentifier(identifier)) return false;
  const symbol = project.checker.getSymbolAtLocation(identifier);
  if (symbol?.declarations.length !== 1) return false;
  const declaration = symbol.declarations[0].resolve(project);
  if (declaration === undefined || !isImportSpecifier(declaration))
    return false;
  const imported = declaration.propertyName?.text ?? declaration.name.text;
  const importDeclaration = importDeclarationFor(declaration);
  return (
    imported === importedName &&
    importDeclaration !== undefined &&
    stringLiteralText(importDeclaration.moduleSpecifier) === moduleName
  );
}

function importedCall(node, project, importedName, moduleName) {
  const expression = unwrapExpression(node);
  if (
    !isCallExpression(expression) ||
    !identifierIsNamedImport(
      project,
      unwrapExpression(expression.expression),
      importedName,
      moduleName,
    )
  ) {
    return undefined;
  }
  return expression;
}

function identifierDeclares(project, file, identifier, declaration) {
  return (
    uniqueConstVariableDeclaration(project, file, identifier)?.id ===
    declaration.id
  );
}

function isImportMetaResolveCall(node) {
  const call = unwrapExpression(node);
  if (!isCallExpression(call)) return undefined;
  const expression = unwrapExpression(call.expression);
  if (
    !isPropertyAccessExpression(expression) ||
    expression.name.text !== "resolve"
  ) {
    return undefined;
  }
  const target = unwrapExpression(expression.expression);
  return isMetaProperty(target) &&
    target.keywordToken === SyntaxKind.ImportKeyword &&
    target.name.text === "meta"
    ? call
    : undefined;
}

function isImportMetaDirname(node) {
  const expression = unwrapExpression(node);
  if (
    !isPropertyAccessExpression(expression) ||
    expression.name.text !== "dirname"
  ) {
    return false;
  }
  const target = unwrapExpression(expression.expression);
  return (
    isMetaProperty(target) &&
    target.keywordToken === SyntaxKind.ImportKeyword &&
    target.name.text === "meta"
  );
}

function trustedDesktopComputedImport(
  root,
  file,
  facts,
  project,
  computedImport,
) {
  if (
    relative(root, file) !== TRUSTED_DESKTOP_COMPUTED_IMPORT ||
    facts.computedDynamicImports.length !== 1 ||
    computedImport.argument === undefined
  ) {
    return false;
  }
  const loaderDeclaration = uniqueConstVariableDeclaration(
    project,
    file,
    computedImport.argument,
  );
  const loaderInitializer =
    loaderDeclaration?.initializer === undefined
      ? undefined
      : unwrapExpression(loaderDeclaration.initializer);
  if (
    loaderInitializer === undefined ||
    !isPropertyAccessExpression(loaderInitializer) ||
    loaderInitializer.name.text !== "href"
  ) {
    return false;
  }
  const pathToFileUrlCall = importedCall(
    loaderInitializer.expression,
    project,
    "pathToFileURL",
    "node:url",
  );
  const resolveCall =
    pathToFileUrlCall?.arguments.length === 1
      ? importedCall(
          pathToFileUrlCall.arguments[0],
          project,
          "resolve",
          "node:path",
        )
      : undefined;
  if (
    resolveCall?.arguments.length !== 4 ||
    stringLiteralText(resolveCall.arguments[1]) !== "core" ||
    stringLiteralText(resolveCall.arguments[2]) !== "extensions" ||
    stringLiteralText(resolveCall.arguments[3]) !== "loader.js"
  ) {
    return false;
  }
  const dirnameCall = importedCall(
    resolveCall.arguments[0],
    project,
    "dirname",
    "node:path",
  );
  if (dirnameCall?.arguments.length !== 1) return false;
  const piDeclaration = uniqueConstVariableDeclaration(
    project,
    file,
    dirnameCall.arguments[0],
  );
  if (
    piDeclaration === undefined ||
    !identifierDeclares(
      project,
      file,
      dirnameCall.arguments[0],
      piDeclaration,
    ) ||
    piDeclaration.initializer === undefined
  ) {
    return false;
  }
  const fileUrlToPathCall = importedCall(
    piDeclaration.initializer,
    project,
    "fileURLToPath",
    "node:url",
  );
  const importMetaResolveCall =
    fileUrlToPathCall?.arguments.length === 1
      ? isImportMetaResolveCall(fileUrlToPathCall.arguments[0])
      : undefined;
  return (
    importMetaResolveCall?.arguments.length === 1 &&
    stringLiteralText(importMetaResolveCall.arguments[0]) ===
      "@earendil-works/pi-coding-agent"
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
    if (
      !trustedDesktopComputedImport(root, file, facts, project, computedImport)
    ) {
      violations.push(
        `${relative(root, file)}: Desktop computed dynamic import is forbidden`,
      );
    }
  }
  for (const candidate of facts.pathResolveCalls) {
    const call = importedCall(candidate, project, "resolve", "node:path");
    if (
      call === undefined ||
      call.arguments.length < 2 ||
      !isImportMetaDirname(call.arguments[0])
    ) {
      continue;
    }
    const segments = call.arguments
      .slice(1)
      .map((argument) => stringLiteralText(unwrapExpression(argument)));
    if (segments.some((segment) => segment === undefined)) continue;
    const target = resolve(dirname(file), ...segments);
    const galleryRoot = join(root, "apps/ui-gallery");
    if (
      pathInside(target, galleryRoot) ||
      (await realPathInside(target, galleryRoot))
    ) {
      violations.push(
        `${relative(root, file)}: Desktop config path must not resolve into UI Gallery`,
      );
    }
  }
  if (relative(root, file) === "apps/desktop/vite.config.ts") {
    for (const { name, value } of facts.configPathLiterals) {
      if (await referenceTargetsGallery(root, file, value)) {
        violations.push(
          `${relative(root, file)}: Desktop Vite ${name} path must not reference UI Gallery: ${value}`,
        );
      }
    }
  }
  return violations;
}

export async function desktopGalleryImportViolations(root = defaultRoot) {
  const desktopRoot = join(root, "apps/desktop/src");
  const desktopSourceFiles = await filesBelow(desktopRoot);
  const configFile = join(root, "apps/desktop/vite.config.ts");
  const htmlFile = join(root, "apps/desktop/index.html");
  const files = [...desktopSourceFiles, configFile].filter((file) =>
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
    for (const file of [
      ...desktopSourceFiles.filter((file) => extname(file) === ".css"),
      htmlFile,
    ]) {
      violations.push(...(await inspectDesktopResourceFile(root, file)));
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
  const desktopRoot = join(root, "apps/desktop");
  const pathReferences = [
    ...(desktop.build?.files ?? []),
    ...(desktop.build?.asarUnpack ?? []),
    ...(desktop.build?.extraResources ?? []).map((entry) => entry?.from),
    desktop.build?.directories?.output,
    desktop.build?.directories?.buildResources,
  ].filter((value) => typeof value === "string");
  for (const reference of pathReferences) {
    const normalized = reference.replace(/^!/u, "").split(/[?*[{]/u)[0];
    if (
      normalized.length > 0 &&
      (await referenceTargetsGallery(
        root,
        join(desktopRoot, "package.json"),
        normalized,
      ))
    ) {
      violations.push(
        `apps/desktop/package.json: Desktop build path must not reference Gallery: ${reference}`,
      );
    }
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
  const desktopFiles = [
    ...(await filesBelow(desktopRoot)).filter((file) =>
      SCRIPT_EXTENSIONS.has(extname(file)),
    ),
    join(root, "apps/desktop/vite.config.ts"),
  ];
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
    for (const file of [
      ...(await filesBelow(desktopRoot)).filter(
        (file) => extname(file) === ".css",
      ),
      join(root, "apps/desktop/index.html"),
    ]) {
      violations.push(...(await inspectDesktopResourceFile(root, file)));
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
