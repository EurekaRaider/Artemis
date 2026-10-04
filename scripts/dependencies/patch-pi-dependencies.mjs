import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Pi >= 1.0.1 no longer publishes a shrinkwrap. Verify npm's resolution
// instead of rewriting installed packages after every install.
export async function patchPiDependencies(root) {
  const pi = join(root, "node_modules", "@earendil-works", "pi-coding-agent");
  const manifestPath = join(pi, "package.json");
  const sdk = JSON.parse(await readFile(manifestPath, "utf8"));
  const resolve = createRequire(manifestPath);
  const nested = join(pi, "node_modules", "brace-expansion", "package.json");
  const installed = JSON.parse(
    await readFile(nested, "utf8").catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return readFile(resolve.resolve("brace-expansion/package.json"), "utf8");
    }),
  );
  if (
    sdk.version !== "1.0.2" ||
    installed.name !== "brace-expansion" ||
    installed.version !== "5.0.12"
  ) {
    throw new Error(
      "Unexpected Pi dependency resolution; reinstall from the lockfile.",
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await patchPiDependencies(dirname(dirname(fileURLToPath(import.meta.url))));
  console.log(
    "Pi 1.0.2 dependency resolution verified: brace-expansion 5.0.12.",
  );
}
