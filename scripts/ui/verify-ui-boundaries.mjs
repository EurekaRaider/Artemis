import { manifestViolations } from "./boundaries/packaging.mjs";
import {
  inspectDesktopGalleryImports,
  desktopGalleryImportViolations,
} from "./boundaries/gallery-imports.mjs";

import {
  htmlElements,
  scriptModuleReferences,
  htmlInlineResources,
  htmlResourceReferences,
  cssResourceReferences,
  referenceTargetsGallery,
  inspectDesktopResourceFile,
} from "./boundaries/resources.mjs";
import {
  collectTypeScriptReferences,
  createTypeScriptAnalysis,
  inspectSource,
} from "./boundaries/typescript-analysis.mjs";
import { filesBelow } from "./boundaries/files.mjs";
import { defaultRoot, SCRIPT_EXTENSIONS, AREAS } from "./boundaries/policy.mjs";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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

export { collectTypeScriptReferences } from "./boundaries/typescript-analysis.mjs";

export {
  htmlElements,
  scriptModuleReferences,
  htmlInlineResources,
  htmlResourceReferences,
  cssResourceReferences,
  referenceTargetsGallery,
} from "./boundaries/resources.mjs";

export { desktopGalleryImportViolations } from "./boundaries/gallery-imports.mjs";
