import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  NodeFlags,
  SyntaxKind,
  isArrayLiteralExpression,
  isCallExpression,
  isComputedPropertyName,
  isExportAssignment,
  isIdentifier,
  isImportDeclaration,
  isImportSpecifier,
  isMetaProperty,
  isObjectLiteralExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isShorthandPropertyAssignment,
  isSpreadAssignment,
  isVariableDeclaration,
} from "typescript/unstable/ast";
import { stringLiteralText, unwrapExpression } from "./typescript-analysis.mjs";
import { pathInside } from "./resources.mjs";

export function uniqueConstVariableDeclaration(project, file, identifier) {
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

export function importDeclarationFor(node) {
  let current = node;
  while (current !== undefined && !isImportDeclaration(current)) {
    current = current.parent;
  }
  return current;
}

export function identifierIsNamedImport(
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

export function importedCall(node, project, importedName, moduleName) {
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

export function identifierDeclares(project, file, identifier, declaration) {
  return (
    uniqueConstVariableDeclaration(project, file, identifier)?.id ===
    declaration.id
  );
}

export function isImportMetaResolveCall(node) {
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

export function isImportMetaDirname(node) {
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

export function evaluateStaticConfigPath(
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

export function staticConfigObject(
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

export function staticConfigArray(node, constInitializers, seen = new Set()) {
  const expression = unwrapExpression(node);
  if (isArrayLiteralExpression(expression)) return expression;
  if (!isIdentifier(expression)) return undefined;
  const initializer = constInitializers.get(expression.text);
  if (initializer === undefined || seen.has(expression.text)) return undefined;
  const nextSeen = new Set(seen);
  nextSeen.add(expression.text);
  return staticConfigArray(initializer, constInitializers, nextSeen);
}

export function staticObjectProperty(object, name) {
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

export function nestedStaticConfigObject(
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

export function staticPathList(
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

export async function pathsOverlapGallery(path, galleryRoot) {
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

export function configIssue(violations, root, file, message) {
  violations.push(`${relative(root, file)}: Desktop Vite ${message}`);
}

export async function inspectDesktopViteConfig(root, file, analysisResult) {
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
