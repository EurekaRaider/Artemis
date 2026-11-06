import {
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
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
  isNoSubstitutionTemplateLiteral,
  isNonNullExpression,
  isObjectBindingPattern,
  isParenthesizedExpression,
  isPropertyAccessExpression,
  isSatisfiesExpression,
  isStringLiteral,
  isVariableDeclaration,
} from "typescript/unstable/ast";
import {
  NODE_GLOBAL_NAMES,
  DOM_GLOBAL_NAMES,
  FORBIDDEN_ARTEMIS_PACKAGES,
} from "./policy.mjs";

export function stringLiteralText(node) {
  return isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : undefined;
}

export function unwrapExpression(node) {
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

export function memberName(node) {
  if (isPropertyAccessExpression(node)) return node.name.text;
  if (
    isElementAccessExpression(node) &&
    node.argumentExpression !== undefined
  ) {
    return stringLiteralText(node.argumentExpression);
  }
  return undefined;
}

export function windowRoot(node) {
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

export function bindingPropertyName(element) {
  const property = element.propertyName ?? element.name;
  if (isComputedPropertyName(property)) {
    return stringLiteralText(unwrapExpression(property.expression));
  }
  return isIdentifier(property) ? property.text : stringLiteralText(property);
}

export function identifierCanReferenceGlobal(node) {
  const parent = node.parent;
  return (
    parent === undefined ||
    parent.name !== node ||
    parent.kind === SyntaxKind.ShorthandPropertyAssignment
  );
}

export function containsCssImportRule(source) {
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

export function createTypeScriptAnalysis(root, files) {
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

export function bareImportAllowed(specifier, allowed) {
  return allowed.some(
    (entry) => specifier === entry || specifier.startsWith(`${entry}/`),
  );
}

export function identifierIsLocal(project, file, identifier) {
  const symbol = project.checker.getSymbolAtLocation(identifier.node);
  return symbol?.declarations.some(
    (declaration) =>
      resolve(declaration.path).toLowerCase() === resolve(file).toLowerCase(),
  );
}

export function inspectSource(area, file, sourceRoot, source, analysisResult) {
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
