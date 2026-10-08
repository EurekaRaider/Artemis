import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const output = "artifacts/computer-use/publish-pack.mjs";
await mkdir("artifacts/computer-use", { recursive: true });
await build({
  entryPoints: ["scripts/computer-use/publish-pack.ts"],
  outfile: output,
  platform: "node",
  format: "esm",
  bundle: true,
  packages: "external",
});
await import(pathToFileURL(process.cwd() + "/" + output));
