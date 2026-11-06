import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { isPropertyAccessExpression } from "typescript/unstable/ast";
import {
  TRUSTED_DESKTOP_COMPUTED_IMPORT,
  SCRIPT_EXTENSIONS,
  defaultRoot,
} from "./policy.mjs";
import {
  uniqueConstVariableDeclaration,
  importedCall,
  identifierDeclares,
  isImportMetaResolveCall,
  inspectDesktopViteConfig,
} from "./vite-configuration.mjs";
import {
  unwrapExpression,
  stringLiteralText,
  createTypeScriptAnalysis,
} from "./typescript-analysis.mjs";
import {
  pathsAliasTargetsGallery,
  pathInside,
  realPathInside,
  inspectDesktopResourceFile,
} from "./resources.mjs";
import { filesBelow } from "./files.mjs";

export function trustedDesktopComputedImport(
  root,
  file,
  facts,
  project,
  computedImport,
) {
  if (
    relative(root, file).split(sep).join("/") !==
      TRUSTED_DESKTOP_COMPUTED_IMPORT ||
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

export async function inspectDesktopGalleryImports(root, file, analysis) {
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
  if (
    relative(root, file).split(sep).join("/") === "apps/desktop/vite.config.ts"
  ) {
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
