import { extractFile, listPackage } from "@electron/asar";
import { readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const forbiddenSourceSuffixes = [".map", ".ts", ".tsx", ".mts", ".cts"];
const bundledJavaScriptPattern =
  /^\/?dist-(?:electron|renderer)\/.*\.(?:cjs|js|mjs)$/iu;
const sourceMapReferencePattern = /sourceMappingURL\s*=/iu;

function normalizedPath(path) {
  return path.split(sep).join("/").replace(/^\/+/, "");
}

export function forbiddenPackagedSourcePaths(paths) {
  return paths
    .map(normalizedPath)
    .filter((path) => {
      const lowerPath = path.toLowerCase();
      return forbiddenSourceSuffixes.some((suffix) =>
        lowerPath.endsWith(suffix),
      );
    })
    .sort();
}

async function filesBelow(root) {
  const files = [];

  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }

    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else files.push(relative(root, path));
    }
  }

  await visit(root);
  return files;
}

function packagedResourcesPath(context) {
  if (context.electronPlatformName === "darwin") {
    return join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      "Contents",
      "Resources",
    );
  }
  return join(context.appOutDir, "resources");
}

export async function verifyPackagedSourcePrivacy(context) {
  const resourcesPath = packagedResourcesPath(context);
  const archivePath = join(resourcesPath, "app.asar");
  const archiveEntries = listPackage(archivePath);
  const filesystemEntries = await filesBelow(resourcesPath);
  const forbidden = [
    ...forbiddenPackagedSourcePaths(archiveEntries).map(
      (path) => `app.asar/${path}`,
    ),
    ...forbiddenPackagedSourcePaths(filesystemEntries),
  ];

  for (const entry of archiveEntries) {
    if (!bundledJavaScriptPattern.test(entry)) continue;
    const source = extractFile(archivePath, normalizedPath(entry)).toString(
      "utf8",
    );
    if (sourceMapReferencePattern.test(source)) {
      forbidden.push(`app.asar/${normalizedPath(entry)} (sourceMappingURL)`);
    }
  }

  if (forbidden.length > 0) {
    const sample = forbidden.slice(0, 20).map((path) => `- ${path}`);
    const remainder = forbidden.length - sample.length;
    throw new Error(
      [
        `Packaged source privacy check found ${forbidden.length} forbidden file(s) or reference(s):`,
        ...sample,
        ...(remainder > 0 ? [`- ...and ${remainder} more`] : []),
      ].join("\n"),
    );
  }

  console.log(
    `Verified packaged source privacy: ${archiveEntries.length} ASAR entries and ${filesystemEntries.length} external resource files.`,
  );
}
