import { cp, readFile, realpath, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Pi 0.99.1 ships an npm-shrinkwrap.json that npm 11 applies even over
// root overrides and lockfile resolutions. Keep the installed SDK dependency
// aligned with our audited lockfile using the pinned, integrity-checked copy.
export async function patchPiDependencies(root) {
  const modules = join(root, "node_modules");
  const source = join(modules, "brace-expansion");
  const pi = join(modules, "@earendil-works", "pi-coding-agent");
  const target = join(pi, "node_modules", "brace-expansion");
  const manifest = async (path) =>
    JSON.parse(await readFile(join(path, "package.json"), "utf8"));
  const [sdk, fixed, installed] = await Promise.all([
    manifest(pi),
    manifest(source),
    manifest(target),
  ]);
  if (
    sdk.version !== "0.99.1" ||
    fixed.version !== "5.0.12" ||
    fixed.name !== "brace-expansion" ||
    installed.name !== fixed.name ||
    !["5.0.9", "5.0.12"].includes(installed.version)
  ) {
    throw new Error(
      "Review the Pi shrinkwrap security patch for these dependency versions.",
    );
  }
  if (installed.version === fixed.version) return;
  // Refuse to replace a linked directory outside this installed Pi package.
  if (
    (await realpath(target)) !==
    join(await realpath(pi), "node_modules", "brace-expansion")
  ) {
    throw new Error("Refusing to patch a linked Pi dependency.");
  }
  await rm(target, { recursive: true });
  await cp(source, target, { recursive: true });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await patchPiDependencies(dirname(dirname(fileURLToPath(import.meta.url))));
  console.log("Pi shrinkwrap dependency verified: brace-expansion 5.0.12.");
}
