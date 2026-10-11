import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const output = "artifacts/office/verify-macos-release.mjs";
await mkdir("artifacts/office", { recursive: true });
await build({
  entryPoints: ["scripts/office/verify-macos-release.ts"],
  outfile: output,
  platform: "node",
  format: "esm",
  bundle: true,
  packages: "external",
});
await import(pathToFileURL(process.cwd() + "/" + output));
