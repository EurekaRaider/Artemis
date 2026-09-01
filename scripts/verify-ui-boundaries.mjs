import { readFile, readdir, realpath } from "node:fs/promises";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseCssValue, walk as walkCssValue } from "css-tree";
import { parse as parseHtml } from "parse5";
import postcss from "postcss";
import { Minimatch } from "minimatch";
import { sanitizeFileName } from "builder-util/out/filename.js";
import { API } from "typescript/unstable/sync";
import {
  NodeFlags,
  SyntaxKind,
  isArrayLiteralExpression,
  isAssertionExpression,
  isCallExpression,
  isComputedPropertyName,
  isElementAccessExpression,
  isExportAssignment,
  isExportDeclaration,
  isExternalModuleReference,
  isIdentifier,
  isImportDeclaration,
  isImportEqualsDeclaration,
  isImportSpecifier,
  isMetaProperty,
  isNoSubstitutionTemplateLiteral,
  isNonNullExpression,
  isObjectLiteralExpression,
  isObjectBindingPattern,
  isParenthesizedExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isSatisfiesExpression,
  isShorthandPropertyAssignment,
  isSpreadAssignment,
  isStringLiteral,
  isVariableDeclaration,
  createScanner,
} from "typescript/unstable/ast";

const defaultRoot = fileURLToPath(new URL("../", import.meta.url));
const SOURCE_EXTENSIONS = new Set([
  ".css",
  ".cjs",
  ".cts",
  ".html",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);
const SCRIPT_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);
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
  const constInitializers = new Map();
  const globalIdentifiers = [];
  let usesRequire = false;

  const addReference = (node, kind) => {
    const specifier = stringLiteralText(node);
    if (specifier !== undefined)
      moduleReferences.push({ kind, node, specifier });
    return specifier !== undefined;
  };

  const visit = (node) => {
    if (
      isVariableDeclaration(node) &&
      isIdentifier(node.name) &&
      node.initializer !== undefined &&
      (node.parent.flags & NodeFlags.Const) !== 0
    ) {
      constInitializers.set(
        node.name.text,
        constInitializers.has(node.name.text) ? undefined : node.initializer,
      );
    }
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
    constInitializers,
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
        sourceFile,
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

export function htmlElements(source) {
  const document = parseHtml(source);
  const elements = [];
  const visit = (node) => {
    if (Array.isArray(node.attrs)) {
      elements.push({
        attributes: Object.fromEntries(
          node.attrs.map((entry) => [entry.name, entry.value]),
        ),
        content: (node.childNodes ?? [])
          .filter((child) => child.nodeName === "#text")
          .map((child) => child.value ?? "")
          .join(""),
        tagName: node.tagName,
      });
    }
    for (const child of node.childNodes ?? []) visit(child);
    if (node.content !== undefined) visit(node.content);
  };
  visit(document);
  return elements;
}

function scriptTokens(source) {
  const scanner = createScanner(true, undefined, source);
  const tokens = [];
  const templateBraceDepth = [];
  for (
    let kind = scanner.scan();
    kind !== SyntaxKind.EndOfFile;
    kind = scanner.scan()
  ) {
    if (kind === SyntaxKind.CloseBraceToken && templateBraceDepth.length > 0) {
      const templateIndex = templateBraceDepth.length - 1;
      if (templateBraceDepth[templateIndex] === 0) {
        kind = scanner.reScanTemplateToken(false);
        if (kind === SyntaxKind.TemplateTail) templateBraceDepth.pop();
      } else {
        templateBraceDepth[templateIndex] -= 1;
      }
    } else if (
      kind === SyntaxKind.OpenBraceToken &&
      templateBraceDepth.length > 0
    ) {
      templateBraceDepth[templateBraceDepth.length - 1] += 1;
    } else if (kind === SyntaxKind.TemplateHead) {
      templateBraceDepth.push(0);
    }
    tokens.push({
      kind,
      value: scanner.getTokenValue(),
    });
    if (scanner.isUnterminated()) {
      return { invalid: true, tokens };
    }
  }
  return { invalid: false, tokens };
}

function staticScriptString(token) {
  return token?.kind === SyntaxKind.StringLiteral ||
    token?.kind === SyntaxKind.NoSubstitutionTemplateLiteral
    ? token.value
    : undefined;
}

export function scriptModuleReferences(source) {
  const result = scriptTokens(source);
  const references = [];
  let computed = false;
  const { tokens } = result;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind === SyntaxKind.ImportKeyword) {
      if (tokens[index + 1]?.kind === SyntaxKind.DotToken) continue;
      if (tokens[index + 1]?.kind === SyntaxKind.OpenParenToken) {
        const reference = staticScriptString(tokens[index + 2]);
        if (
          reference === undefined ||
          tokens[index + 3]?.kind !== SyntaxKind.CloseParenToken
        ) {
          computed = true;
        } else {
          references.push(reference);
        }
        continue;
      }
      for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
        if (tokens[cursor].kind === SyntaxKind.SemicolonToken) break;
        const reference = staticScriptString(tokens[cursor]);
        if (reference !== undefined) {
          references.push(reference);
          break;
        }
      }
      continue;
    }
    if (token.kind === SyntaxKind.ExportKeyword) {
      for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
        if (tokens[cursor].kind === SyntaxKind.SemicolonToken) break;
        if (tokens[cursor].kind !== SyntaxKind.FromKeyword) continue;
        const reference = staticScriptString(tokens[cursor + 1]);
        if (reference === undefined) computed = true;
        else references.push(reference);
        break;
      }
      continue;
    }
    if (
      token.kind === SyntaxKind.RequireKeyword &&
      tokens[index + 1]?.kind === SyntaxKind.OpenParenToken
    ) {
      const reference = staticScriptString(tokens[index + 2]);
      if (
        reference === undefined ||
        tokens[index + 3]?.kind !== SyntaxKind.CloseParenToken
      ) {
        computed = true;
      } else {
        references.push(reference);
      }
    }
  }
  return { computed, invalid: result.invalid, references };
}

function scriptIsExecutable(attributes) {
  const type = attributes.type?.trim().toLowerCase();
  return (
    type === undefined ||
    type === "" ||
    type === "module" ||
    type === "text/javascript" ||
    type === "application/javascript" ||
    type === "text/ecmascript" ||
    type === "application/ecmascript"
  );
}

export function htmlInlineResources(source, from) {
  const scripts = [];
  const styles = [];
  for (const element of htmlElements(source)) {
    if (
      element.tagName === "script" &&
      element.attributes.src === undefined &&
      scriptIsExecutable(element.attributes) &&
      element.content.length > 0
    ) {
      scripts.push({
        content: element.content,
        ...scriptModuleReferences(element.content),
      });
    }
    if (
      element.tagName === "style" &&
      (element.attributes.type === undefined ||
        element.attributes.type.trim().toLowerCase() === "text/css") &&
      element.content.length > 0
    ) {
      styles.push({
        content: element.content,
        references: cssResourceReferences(element.content, from),
      });
    }
    const styleAttribute = element.attributes.style;
    if (styleAttribute !== undefined) {
      const content = `.artemis-inline-style { ${styleAttribute} }`;
      styles.push({
        content,
        references: cssResourceReferences(content, from),
      });
    }
  }
  return { scripts, styles };
}

export function htmlResourceReferences(source) {
  const references = [];
  for (const element of htmlElements(source)) {
    for (const [name, value] of Object.entries(element.attributes)) {
      const attribute = { name, value };
      if (attribute.name === "src" || attribute.name === "href") {
        references.push({
          attribute: attribute.name,
          attributes: element.attributes,
          reference: attribute.value,
          tagName: element.tagName,
        });
      } else if (attribute.name === "srcset") {
        for (const candidate of attribute.value.split(",")) {
          const reference = candidate.trim().split(/\s+/u)[0];
          if (reference !== undefined && reference.length > 0) {
            references.push({
              attribute: attribute.name,
              attributes: element.attributes,
              reference,
              tagName: element.tagName,
            });
          }
        }
      }
    }
  }
  return references;
}

function cssValueReferences(value, includeStrings) {
  const references = [];
  const ast = parseCssValue(value, { context: "value" });
  walkCssValue(ast, {
    enter(node) {
      const containingFunction = this.function?.name?.toLowerCase();
      const imageSetString =
        node.type === "String" &&
        (containingFunction === "image-set" ||
          containingFunction === "-webkit-image-set");
      if (
        node.type === "Url" ||
        (node.type === "String" && includeStrings) ||
        imageSetString
      ) {
        references.push(node.value);
      }
    },
  });
  return references;
}

export function cssResourceReferences(source, from) {
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

export async function referenceTargetsGallery(root, from, reference) {
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
  const isCss = extname(file) === ".css";
  const inline = isCss ? undefined : htmlInlineResources(source, file);
  const references = isCss
    ? cssResourceReferences(source, file).map((reference) => ({
        attribute: "CSS reference",
        reference,
      }))
    : [
        ...htmlResourceReferences(source),
        ...(inline?.styles ?? []).flatMap((style) =>
          style.references.map((reference) => ({
            attribute: "inline CSS reference",
            reference,
          })),
        ),
        ...(inline?.scripts ?? []).flatMap((script) =>
          script.references.map((reference) => ({
            attribute: "inline script module reference",
            reference,
          })),
        ),
      ];
  const violations = [];
  if (
    inline?.scripts.some((script) => script.computed || script.invalid) === true
  ) {
    violations.push(
      `${relative(root, file)}: Desktop inline script module references must be static`,
    );
  }
  for (const { attribute, reference } of references) {
    if (
      reference === "@artemis/ui/conformance" ||
      (await referenceTargetsGallery(root, file, reference))
    ) {
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

function evaluateStaticConfigPath(
  node,
  project,
  file,
  constInitializers,
  seen = new Set(),
) {
  const expression = unwrapExpression(node);
  const literal = stringLiteralText(expression);
  if (literal !== undefined) return literal;
  if (expression.kind === SyntaxKind.FalseKeyword) return false;
  if (isIdentifier(expression)) {
    const initializer = constInitializers.get(expression.text);
    if (initializer === undefined || seen.has(expression.text)) {
      return undefined;
    }
    const nextSeen = new Set(seen);
    nextSeen.add(expression.text);
    return evaluateStaticConfigPath(
      initializer,
      project,
      file,
      constInitializers,
      nextSeen,
    );
  }
  const call = importedCall(expression, project, "resolve", "node:path");
  if (
    call === undefined ||
    call.arguments.length < 2 ||
    !isImportMetaDirname(call.arguments[0])
  ) {
    return undefined;
  }
  const segments = call.arguments
    .slice(1)
    .map((argument) =>
      evaluateStaticConfigPath(
        argument,
        project,
        file,
        constInitializers,
        new Set(seen),
      ),
    );
  if (segments.some((segment) => typeof segment !== "string")) {
    return undefined;
  }
  return resolve(dirname(file), ...segments);
}

function staticConfigObject(
  node,
  project,
  file,
  constInitializers,
  seen = new Set(),
) {
  const expression = unwrapExpression(node);
  if (isObjectLiteralExpression(expression)) return expression;
  if (isIdentifier(expression)) {
    const initializer = constInitializers.get(expression.text);
    if (initializer === undefined || seen.has(expression.text))
      return undefined;
    const nextSeen = new Set(seen);
    nextSeen.add(expression.text);
    return staticConfigObject(
      initializer,
      project,
      file,
      constInitializers,
      nextSeen,
    );
  }
  const defineConfig = importedCall(
    expression,
    project,
    "defineConfig",
    "vite",
  );
  return defineConfig?.arguments.length === 1
    ? staticConfigObject(
        defineConfig.arguments[0],
        project,
        file,
        constInitializers,
        seen,
      )
    : undefined;
}

function staticConfigArray(node, constInitializers, seen = new Set()) {
  const expression = unwrapExpression(node);
  if (isArrayLiteralExpression(expression)) return expression;
  if (!isIdentifier(expression)) return undefined;
  const initializer = constInitializers.get(expression.text);
  if (initializer === undefined || seen.has(expression.text)) return undefined;
  const nextSeen = new Set(seen);
  nextSeen.add(expression.text);
  return staticConfigArray(initializer, constInitializers, nextSeen);
}

function staticObjectProperty(object, name) {
  let initializer;
  let count = 0;
  let hasSpread = false;
  for (const property of object.properties) {
    if (isSpreadAssignment(property)) {
      hasSpread = true;
      continue;
    }
    if (
      !isPropertyAssignment(property) &&
      !isShorthandPropertyAssignment(property)
    ) {
      continue;
    }
    const propertyName = isIdentifier(property.name)
      ? property.name.text
      : stringLiteralText(property.name);
    if (propertyName !== name) continue;
    count += 1;
    initializer = isPropertyAssignment(property)
      ? property.initializer
      : property.name;
  }
  return { count, hasSpread, initializer };
}

function nestedStaticConfigObject(
  parent,
  name,
  project,
  file,
  constInitializers,
) {
  const property = staticObjectProperty(parent, name);
  if (property.hasSpread || property.count > 1) return { invalid: true };
  if (property.count === 0) return { object: undefined };
  const object = staticConfigObject(
    property.initializer,
    project,
    file,
    constInitializers,
  );
  return object === undefined ? { invalid: true } : { object };
}

function staticPathList(
  node,
  project,
  file,
  constInitializers,
  seen = new Set(),
) {
  const expression = unwrapExpression(node);
  const direct = evaluateStaticConfigPath(
    expression,
    project,
    file,
    constInitializers,
    seen,
  );
  if (typeof direct === "string") return [direct];
  if (isIdentifier(expression)) {
    const initializer = constInitializers.get(expression.text);
    if (initializer === undefined || seen.has(expression.text))
      return undefined;
    const nextSeen = new Set(seen);
    nextSeen.add(expression.text);
    return staticPathList(
      initializer,
      project,
      file,
      constInitializers,
      nextSeen,
    );
  }
  if (isArrayLiteralExpression(expression)) {
    const values = [];
    for (const element of expression.elements) {
      const nested = staticPathList(
        element,
        project,
        file,
        constInitializers,
        new Set(seen),
      );
      if (nested === undefined) return undefined;
      values.push(...nested);
    }
    return values;
  }
  const object = staticConfigObject(
    expression,
    project,
    file,
    constInitializers,
    seen,
  );
  if (object === undefined) return undefined;
  const values = [];
  for (const property of object.properties) {
    if (
      !isPropertyAssignment(property) ||
      isComputedPropertyName(property.name)
    ) {
      return undefined;
    }
    const nested = staticPathList(
      property.initializer,
      project,
      file,
      constInitializers,
      new Set(seen),
    );
    if (nested === undefined) return undefined;
    values.push(...nested);
  }
  return values;
}

async function pathsOverlapGallery(path, galleryRoot) {
  if (pathInside(path, galleryRoot) || pathInside(galleryRoot, path))
    return true;
  try {
    const [realTarget, realGallery] = await Promise.all([
      realpath(path),
      realpath(galleryRoot),
    ]);
    return (
      pathInside(realTarget, realGallery) || pathInside(realGallery, realTarget)
    );
  } catch {
    return false;
  }
}

function configIssue(violations, root, file, message) {
  violations.push(`${relative(root, file)}: Desktop Vite ${message}`);
}

async function inspectDesktopViteConfig(root, file, analysisResult) {
  const violations = [];
  const galleryRoot = join(root, "apps/ui-gallery");
  const workspaceRoot = dirname(file);
  const { facts, project, sourceFile } = analysisResult;
  const exports = sourceFile.statements.filter(isExportAssignment);
  if (exports.length !== 1) {
    configIssue(
      violations,
      root,
      file,
      "configuration must have exactly one static default export",
    );
    return violations;
  }
  const config = staticConfigObject(
    exports[0].expression,
    project,
    file,
    facts.constInitializers,
  );
  if (config === undefined) {
    configIssue(
      violations,
      root,
      file,
      "configuration must resolve to one static object",
    );
    return violations;
  }

  const rootProperty = staticObjectProperty(config, "root");
  if (rootProperty.hasSpread || rootProperty.count > 1) {
    configIssue(violations, root, file, "root must be unique and static");
    return violations;
  }
  const configuredRoot =
    rootProperty.count === 0
      ? undefined
      : evaluateStaticConfigPath(
          rootProperty.initializer,
          project,
          file,
          facts.constInitializers,
        );
  if (rootProperty.count === 1 && typeof configuredRoot !== "string") {
    configIssue(
      violations,
      root,
      file,
      "root path must be statically evaluable",
    );
    return violations;
  }
  const effectiveRoot =
    configuredRoot === undefined || configuredRoot.length === 0
      ? workspaceRoot
      : resolve(workspaceRoot, configuredRoot);
  if (await pathsOverlapGallery(effectiveRoot, galleryRoot)) {
    configIssue(
      violations,
      root,
      file,
      `root must not overlap UI Gallery: ${configuredRoot ?? "."}`,
    );
    return violations;
  }

  const checkProperty = async (
    object,
    name,
    base,
    { allowFalse = false, fallback } = {},
  ) => {
    const property = staticObjectProperty(object, name);
    if (property.hasSpread || property.count > 1) {
      configIssue(violations, root, file, `${name} must be unique and static`);
      return undefined;
    }
    let value =
      property.count === 0
        ? fallback
        : evaluateStaticConfigPath(
            property.initializer,
            project,
            file,
            facts.constInitializers,
          );
    if (allowFalse && value === false) return false;
    if (typeof value !== "string") {
      configIssue(
        violations,
        root,
        file,
        `${name} path must be statically evaluable`,
      );
      return undefined;
    }
    const target = isAbsolute(value) ? resolve(value) : resolve(base, value);
    if (await pathsOverlapGallery(target, galleryRoot)) {
      configIssue(
        violations,
        root,
        file,
        `${name} path must not overlap UI Gallery: ${value}`,
      );
    }
    return target;
  };

  await checkProperty(config, "publicDir", effectiveRoot, {
    allowFalse: true,
    fallback: "public",
  });
  await checkProperty(config, "envDir", effectiveRoot, { fallback: "." });
  await checkProperty(config, "cacheDir", effectiveRoot, {
    fallback: "node_modules/.vite",
  });

  const buildResult = nestedStaticConfigObject(
    config,
    "build",
    project,
    file,
    facts.constInitializers,
  );
  if (buildResult.invalid) {
    configIssue(violations, root, file, "build configuration must be static");
  } else {
    const build = buildResult.object;
    const outDir =
      build === undefined
        ? resolve(effectiveRoot, "dist")
        : await checkProperty(build, "outDir", effectiveRoot, {
            fallback: "dist",
          });
    if (build !== undefined && typeof outDir === "string") {
      await checkProperty(build, "assetsDir", outDir, { fallback: "assets" });
      const rollupResult = nestedStaticConfigObject(
        build,
        "rollupOptions",
        project,
        file,
        facts.constInitializers,
      );
      if (rollupResult.invalid) {
        configIssue(
          violations,
          root,
          file,
          "build.rollupOptions must be static",
        );
      } else if (rollupResult.object !== undefined) {
        const input = staticObjectProperty(rollupResult.object, "input");
        if (input.hasSpread || input.count > 1) {
          configIssue(
            violations,
            root,
            file,
            "build.rollupOptions.input must be unique and static",
          );
        } else if (input.count === 1) {
          const values = staticPathList(
            input.initializer,
            project,
            file,
            facts.constInitializers,
          );
          if (values === undefined) {
            configIssue(
              violations,
              root,
              file,
              "build.rollupOptions.input must be statically evaluable",
            );
          } else {
            for (const value of values) {
              const target = isAbsolute(value)
                ? resolve(value)
                : resolve(effectiveRoot, value);
              if (await pathsOverlapGallery(target, galleryRoot)) {
                configIssue(
                  violations,
                  root,
                  file,
                  `build.rollupOptions.input must not overlap UI Gallery: ${value}`,
                );
              }
            }
          }
        }
      }
    }
  }

  const resolveResult = nestedStaticConfigObject(
    config,
    "resolve",
    project,
    file,
    facts.constInitializers,
  );
  if (resolveResult.invalid) {
    configIssue(violations, root, file, "resolve configuration must be static");
  } else if (resolveResult.object !== undefined) {
    const alias = staticObjectProperty(resolveResult.object, "alias");
    if (alias.hasSpread || alias.count > 1) {
      configIssue(
        violations,
        root,
        file,
        "resolve.alias must be unique and static",
      );
    } else if (alias.count === 1) {
      const aliasObject = staticConfigObject(
        alias.initializer,
        project,
        file,
        facts.constInitializers,
      );
      const aliasArray = staticConfigArray(
        alias.initializer,
        facts.constInitializers,
      );
      const replacements = [];
      if (aliasObject !== undefined) {
        for (const property of aliasObject.properties) {
          if (!isPropertyAssignment(property)) {
            replacements.push(undefined);
            continue;
          }
          replacements.push(
            evaluateStaticConfigPath(
              property.initializer,
              project,
              file,
              facts.constInitializers,
            ),
          );
        }
      } else if (aliasArray !== undefined) {
        for (const element of aliasArray.elements) {
          const aliasEntry = staticConfigObject(
            element,
            project,
            file,
            facts.constInitializers,
          );
          const replacement =
            aliasEntry === undefined
              ? { count: 0 }
              : staticObjectProperty(aliasEntry, "replacement");
          replacements.push(
            replacement.count === 1 && !replacement.hasSpread
              ? evaluateStaticConfigPath(
                  replacement.initializer,
                  project,
                  file,
                  facts.constInitializers,
                )
              : undefined,
          );
        }
      } else {
        replacements.push(undefined);
      }
      for (const replacement of replacements) {
        if (typeof replacement !== "string") {
          configIssue(
            violations,
            root,
            file,
            "resolve.alias replacement must be statically evaluable",
          );
          continue;
        }
        const target = isAbsolute(replacement)
          ? resolve(replacement)
          : resolve(effectiveRoot, replacement);
        if (await pathsOverlapGallery(target, galleryRoot)) {
          configIssue(
            violations,
            root,
            file,
            `resolve.alias replacement must not overlap UI Gallery: ${replacement}`,
          );
        }
      }
    }
  }
  return violations;
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
  const analysisResult = analysis.file(file);
  const { facts, project } = analysisResult;
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
      specifier === "@artemis/ui/conformance" ||
      packageName === "@artemis/ui-gallery" ||
      (relativeTarget !== undefined &&
        pathInside(relativeTarget, galleryRoot)) ||
      aliasTargetsGallery ||
      resolvedIntoGallery === true
    ) {
      violations.push(
        `${relative(root, file)}: Desktop must not import test-only UI conformance or UI Gallery: ${specifier}`,
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
  if (relative(root, file) === "apps/desktop/vite.config.ts") {
    violations.push(
      ...(await inspectDesktopViteConfig(root, file, analysisResult)),
    );
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

const BUILDER_RESOURCE_FIELDS = [
  "files",
  "asarUnpack",
  "extraResources",
  "extraFiles",
];
const BUILDER_PLATFORM_LEVELS = ["mac", "mas", "masDev", "win", "linux"];
const FILE_SET_FIELDS = new Set(["filter", "from", "to"]);
const BUILDER_ARCHES = ["ia32", "x64", "armv7l", "arm64", "universal"];
const BUILDER_PLATFORMS = [
  { os: "mac", platform: "darwin" },
  { os: "win", platform: "win32" },
  { os: "linux", platform: "linux" },
];

function isOwnRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeBuilderResource(value, field, path, violations) {
  if (value === undefined || value === null) return [];
  const entries = Array.isArray(value) ? value : [value];
  const normalized = [];
  for (const [index, entry] of entries.entries()) {
    const entryPath = Array.isArray(value) ? `${path}[${index}]` : path;
    if (typeof entry === "string") {
      normalized.push({ path: entryPath, pattern: entry });
      continue;
    }
    if (field === "asarUnpack" || !isOwnRecord(entry)) {
      violations.push(
        `${entryPath}: Desktop builder ${field} entry must be a string${field === "asarUnpack" ? "" : " or FileSet"}`,
      );
      continue;
    }
    const unknownFields = Object.keys(entry).filter(
      (key) => !FILE_SET_FIELDS.has(key),
    );
    if (unknownFields.length > 0) {
      violations.push(
        `${entryPath}: Desktop builder FileSet has unknown fields: ${unknownFields.join(", ")}`,
      );
      continue;
    }
    if (entry.from !== undefined && typeof entry.from !== "string") {
      violations.push(`${entryPath}.from: expected a string`);
      continue;
    }
    if (entry.to !== undefined && typeof entry.to !== "string") {
      violations.push(`${entryPath}.to: expected a string`);
      continue;
    }
    const filters =
      entry.filter === undefined
        ? []
        : Array.isArray(entry.filter)
          ? entry.filter
          : [entry.filter];
    if (filters.some((filter) => typeof filter !== "string")) {
      violations.push(`${entryPath}.filter: expected a string or string array`);
      continue;
    }
    normalized.push({
      filters,
      from: entry.from ?? ".",
      path: entryPath,
    });
  }
  return normalized;
}

function builderMacroMetadata(rootManifest, desktop) {
  const config = desktop.build ?? {};
  const version = desktop.version ?? rootManifest.version;
  const buildNumber =
    config.buildNumber ||
    process.env.BUILD_NUMBER ||
    process.env.TRAVIS_BUILD_NUMBER ||
    process.env.APPVEYOR_BUILD_NUMBER ||
    process.env.CIRCLE_BUILD_NUM ||
    process.env.BUILD_BUILDNUMBER ||
    process.env.CI_PIPELINE_IID;
  const buildVersion =
    config.buildVersion ??
    `${version}${buildNumber === undefined || String(buildNumber).trim().length === 0 ? "" : `.${buildNumber}`}`;
  const productName = config.productName ?? desktop.productName ?? desktop.name;
  const prerelease = String(version).match(/-([0-9A-Za-z-]+)/u)?.[1];
  return {
    buildNumber: String(buildNumber),
    buildVersion: String(buildVersion),
    channel: prerelease ?? "latest",
    name: String(desktop.name),
    productName: sanitizeFileName(String(productName)),
    version: String(version),
  };
}

function builderContexts(levelPath) {
  const platformName = levelPath.split(".")[1];
  const platforms =
    platformName === "mac" ||
    platformName === "mas" ||
    platformName === "masDev"
      ? BUILDER_PLATFORMS.filter(({ os }) => os === "mac")
      : platformName === "win"
        ? BUILDER_PLATFORMS.filter(({ os }) => os === "win")
        : platformName === "linux"
          ? BUILDER_PLATFORMS.filter(({ os }) => os === "linux")
          : BUILDER_PLATFORMS;
  return platforms.flatMap((platform) =>
    BUILDER_ARCHES.map((arch) => ({ ...platform, arch })),
  );
}

function expandBuilderPattern(pattern, context, metadata) {
  let unsupported = false;
  const expanded = pattern.replace(
    /\$\{([_a-zA-Z./*+]+)\}/gu,
    (macro, name) => {
      const values = {
        arch: context.arch,
        os: context.os,
        platform: context.platform,
        productName: metadata.productName,
        ...metadata,
      };
      if (name in values) return values[name];
      unsupported = true;
      return macro;
    },
  );
  return unsupported || expanded.includes("${") ? undefined : expanded;
}

function normalizeBuilderPattern(pattern) {
  let normalized = pattern.replace(/\\/gu, "/");
  if (normalized.startsWith("./")) normalized = normalized.slice(2);
  return posix.normalize(normalized);
}

function minimatchHasMagic(pattern) {
  if (pattern.set.length > 1) return true;
  return pattern.set[0].some((part) => typeof part !== "string");
}

function parsedBuilderPatterns(patterns) {
  const effective =
    patterns.length === 0 ||
    patterns.every((pattern) => pattern.startsWith("!"))
      ? ["**/*", ...patterns]
      : patterns;
  const parsed = [];
  for (const pattern of effective) {
    const matcher = new Minimatch(pattern, { dot: true });
    parsed.push(matcher);
    if (!pattern.includes(".") && !minimatchHasMagic(matcher)) {
      parsed.push(new Minimatch(`${pattern}/**/*`, { dot: true }));
    }
  }
  return parsed;
}

function builderPatternsInclude(path, patterns, isDirectory = false) {
  let match = false;
  for (const pattern of patterns) {
    if (match !== pattern.negate) continue;
    match = pattern.match(path, isDirectory && !pattern.negate);
  }
  return match;
}

async function galleryEntries(root) {
  const galleryRoot = join(root, "apps/ui-gallery");
  const entries = [{ isDirectory: true, path: galleryRoot }];
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      entries.push({ isDirectory: entry.isDirectory(), path });
      if (entry.isDirectory()) await visit(path);
    }
  };
  await visit(galleryRoot);
  return entries;
}

async function builderPatternsTargetGallery(
  root,
  base,
  patterns,
  context,
  metadata,
) {
  const expanded = [];
  for (const pattern of patterns) {
    const value = expandBuilderPattern(pattern, context, metadata);
    if (value === undefined) return undefined;
    const normalized = normalizeBuilderPattern(value);
    expanded.push(normalized);
    if (!normalized.startsWith("!") && !builderPathHasMagic(normalized)) {
      const target = isAbsolute(normalized)
        ? resolve(normalized)
        : resolve(base, normalized);
      if (
        pathInside(target, join(root, "apps/ui-gallery")) ||
        (await realPathInside(target, join(root, "apps/ui-gallery")))
      ) {
        return true;
      }
    }
  }
  let parsed;
  try {
    parsed = parsedBuilderPatterns(expanded);
  } catch {
    return undefined;
  }
  for (const entry of await galleryEntries(root)) {
    if (entry.isDirectory) continue;
    const candidate = relative(base, entry.path).split(sep).join("/");
    if (builderPatternsInclude(candidate, parsed, entry.isDirectory))
      return true;
  }
  return false;
}

function builderPathHasMagic(path) {
  try {
    return minimatchHasMagic(new Minimatch(path, { dot: true }));
  } catch {
    return true;
  }
}

async function builderPathDetails(path, galleryRoot) {
  const lexicalInside = pathInside(path, galleryRoot);
  const lexicalAncestor = pathInside(galleryRoot, path);
  let realInside = false;
  let realAncestor = false;
  let canonicalChanged = false;
  try {
    const [realTarget, realGallery] = await Promise.all([
      realpath(path),
      realpath(galleryRoot),
    ]);
    canonicalChanged = resolve(realTarget) !== resolve(path);
    realInside = pathInside(realTarget, realGallery);
    realAncestor = pathInside(realGallery, realTarget);
  } catch {
    // Lexical checks still apply to paths not present at verification time.
  }
  return {
    canonicalChanged,
    lexicalAncestor,
    lexicalInside,
    realAncestor,
    realInside,
  };
}

function resolveBuilderPath(pattern, base, context, metadata) {
  const expanded = expandBuilderPattern(pattern, context, metadata);
  if (
    expanded === undefined ||
    expanded.startsWith("!") ||
    builderPathHasMagic(expanded)
  ) {
    return undefined;
  }
  return isAbsolute(expanded) ? resolve(expanded) : resolve(base, expanded);
}

async function builderResourceViolations(root, rootManifest, desktop) {
  const violations = [];
  const projectDir = join(root, "apps/desktop");
  const galleryRoot = join(root, "apps/ui-gallery");
  const metadata = builderMacroMetadata(rootManifest, desktop);
  const allContexts = builderContexts("build");
  const configuredAppDir = desktop.build?.directories?.app;
  if (
    configuredAppDir !== undefined &&
    configuredAppDir !== null &&
    typeof configuredAppDir !== "string"
  ) {
    violations.push(
      "apps/desktop/package.json: build.directories.app must be a string",
    );
  }
  const appDirs = new Map();
  const appDir =
    typeof configuredAppDir === "string"
      ? resolve(projectDir, configuredAppDir)
      : projectDir;
  const appDirDetails = await builderPathDetails(appDir, galleryRoot);
  if (
    appDirDetails.lexicalInside ||
    appDirDetails.lexicalAncestor ||
    appDirDetails.realInside ||
    appDirDetails.realAncestor
  ) {
    violations.push(
      "apps/desktop/package.json: build.directories.app must not overlap Gallery",
    );
  }
  for (const context of allContexts) {
    const key = `${context.os}:${context.arch}`;
    appDirs.set(key, appDir);
  }
  const levels = [
    ["build", desktop.build],
    ...BUILDER_PLATFORM_LEVELS.map((name) => [
      `build.${name}`,
      desktop.build?.[name],
    ]),
  ];
  const validLevels = new Map();
  for (const [levelPath, level] of levels) {
    if (level === undefined || level === null) continue;
    if (!isOwnRecord(level)) {
      violations.push(
        `apps/desktop/package.json: ${levelPath} must be an object`,
      );
      continue;
    }
    validLevels.set(levelPath, level);
  }
  const buildLevel = validLevels.get("build") ?? {};
  for (const platformName of BUILDER_PLATFORM_LEVELS) {
    const levelPath = `build.${platformName}`;
    const contexts = builderContexts(levelPath);
    const platformLevel = validLevels.get(levelPath);
    for (const field of BUILDER_RESOURCE_FIELDS) {
      const sources = [
        ["build", buildLevel[field]],
        ...(platformLevel === undefined
          ? []
          : [[levelPath, platformLevel[field]]]),
      ];
      const entries = sources.flatMap(([sourcePath, value]) =>
        normalizeBuilderResource(
          value,
          field,
          `apps/desktop/package.json: ${sourcePath}.${field}`,
          violations,
        ),
      );
      const fieldPath = `apps/desktop/package.json: build + ${levelPath}.${field}`;
      const patternEntries = entries.filter(
        (entry) => entry.pattern !== undefined,
      );
      const fileSetEntries = entries.filter(
        (entry) => entry.pattern === undefined,
      );
      for (const context of contexts) {
        const key = `${context.os}:${context.arch}`;
        const appDir = appDirs.get(key);
        if (appDir === undefined) continue;
        const base =
          field === "files" || field === "asarUnpack" ? appDir : projectDir;
        if (patternEntries.length > 0) {
          const targetsGallery = await builderPatternsTargetGallery(
            root,
            base,
            patternEntries.map(({ pattern }) => pattern),
            context,
            metadata,
          );
          if (targetsGallery === undefined) {
            violations.push(`${fieldPath}: unsupported file macro or glob`);
          } else if (targetsGallery) {
            violations.push(
              `${fieldPath}: Desktop builder ${field} patterns include Gallery`,
            );
          }
        }
        for (const entry of fileSetEntries) {
          const source = resolveBuilderPath(
            entry.from,
            base,
            context,
            metadata,
          );
          if (source === undefined) {
            violations.push(
              `${entry.path}.from: unsupported file macro, glob, or negation`,
            );
            continue;
          }
          const details = await builderPathDetails(source, galleryRoot);
          if (
            details.lexicalInside ||
            details.realInside ||
            (details.realAncestor && !details.lexicalAncestor)
          ) {
            violations.push(
              `${entry.path}.from: Desktop builder FileSet must not resolve inside or through Gallery: ${entry.from}`,
            );
            continue;
          }
          const targetsGallery = await builderPatternsTargetGallery(
            root,
            source,
            entry.filters,
            context,
            metadata,
          );
          if (targetsGallery === undefined) {
            violations.push(
              `${entry.path}.filter: unsupported file macro or glob`,
            );
          } else if (targetsGallery) {
            violations.push(
              `${entry.path}: Desktop builder FileSet filters include Gallery`,
            );
          }
        }
      }
    }
  }
  for (const [name, value] of [
    ["build.directories.output", desktop.build?.directories?.output],
    [
      "build.directories.buildResources",
      desktop.build?.directories?.buildResources,
    ],
  ]) {
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") {
      violations.push(`apps/desktop/package.json: ${name} must be a string`);
      continue;
    }
    for (const context of allContexts) {
      const target = resolveBuilderPath(value, projectDir, context, metadata);
      if (target === undefined) {
        violations.push(
          `apps/desktop/package.json: ${name} contains an unsupported file macro, glob, or negation`,
        );
      } else {
        const details = await builderPathDetails(target, galleryRoot);
        if (!details.lexicalInside && !details.realInside) continue;
        violations.push(
          `apps/desktop/package.json: ${name} must not reference Gallery: ${value}`,
        );
      }
    }
  }
  return violations;
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
  violations.push(
    ...(await builderResourceViolations(root, rootManifest, desktop)),
  );
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
