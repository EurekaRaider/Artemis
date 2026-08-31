import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

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
const galleryText = (
  await Promise.all(
    galleryFiles
      .filter((path) => [".css", ".html", ".js"].includes(extname(path)))
      .map((path) => readFile(path, "utf8")),
  )
).join("\n");
for (const marker of [
  "Artemis UI Gallery scaffold",
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
]) {
  if (desktopText.includes(forbidden)) {
    throw new Error(
      `Desktop renderer bundle contains Gallery marker: ${forbidden}`,
    );
  }
}

console.log(
  `UI Gallery verification passed (${galleryFiles.length} Gallery files; ${desktopFiles.length} Desktop renderer files isolated)`,
);
