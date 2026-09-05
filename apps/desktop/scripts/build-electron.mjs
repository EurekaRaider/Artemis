import { createRequire } from "node:module";
import { rm } from "node:fs/promises";
import { dirname } from "node:path";

import { build } from "esbuild";
import { packageGateway } from "../../../scripts/package-gateway.mjs";

import { ensureNodePtySpawnHelpersExecutable } from "./node-pty-permissions.mjs";

const require = createRequire(import.meta.url);
const packageBuild = process.env.ARTEMIS_PACKAGE_BUILD === "1";
const esmRequireBridge = {
  js: 'import { createRequire as artemisBundleCreateRequire } from "node:module"; const require = artemisBundleCreateRequire(import.meta.url);',
};

if (process.platform === "darwin") {
  const nodePtyRoot = dirname(dirname(require.resolve("node-pty")));
  await ensureNodePtySpawnHelpersExecutable(nodePtyRoot);
}

await rm("dist-electron", { recursive: true, force: true });
await packageGateway("dist-electron/artemis-gateway.tar.gz");

const shared = {
  bundle: true,
  external: [
    "electron",
    "node-pty",
    "@modelcontextprotocol/sdk",
    "@modelcontextprotocol/sdk/*",
    "electron-updater",
    // officeparser dynamically imports puppeteer only for optional PDF generation
    // (a code path Artemis never exercises). Keep it external so esbuild doesn't
    // try to bundle it and drag in its transitive typescript/cosmiconfig loaders.
    "puppeteer",
  ],
  logLevel: "info",
  minify: packageBuild,
  platform: "node",
  sourcemap: !packageBuild,
  target: "node24",
};

await Promise.all([
  build({
    ...shared,
    entryPoints: ["src/main/main.ts"],
    banner: esmRequireBridge,
    format: "esm",
    outfile: "dist-electron/main.js",
  }),
  build({
    ...shared,
    entryPoints: ["src/preload/preload.ts"],
    format: "cjs",
    outfile: "dist-electron/preload.cjs",
  }),
  build({
    ...shared,
    entryPoints: ["src/agent/agent-worker.ts"],
    banner: esmRequireBridge,
    external: [
      ...shared.external,
      "@earendil-works/pi-coding-agent",
      "@sinclair/typebox",
    ],
    format: "esm",
    outfile: "dist-electron/agent-worker.js",
  }),
  build({
    ...shared,
    entryPoints: ["src/extension/extension-worker.ts"],
    external: [
      ...shared.external,
      "@earendil-works/pi-coding-agent",
      "@sinclair/typebox",
    ],
    format: "esm",
    outfile: "dist-electron/extension-worker.js",
  }),
]);
