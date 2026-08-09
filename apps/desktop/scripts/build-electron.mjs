import { createRequire } from "node:module";
import { rm } from "node:fs/promises";
import { dirname } from "node:path";

import { build } from "esbuild";

import { ensureNodePtySpawnHelpersExecutable } from "./node-pty-permissions.mjs";

const require = createRequire(import.meta.url);
const packageBuild = process.env.ARTEMIS_PACKAGE_BUILD === "1";
const esmRequireBridge = {
  js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
};

if (process.platform === "darwin") {
  const nodePtyRoot = dirname(dirname(require.resolve("node-pty")));
  await ensureNodePtySpawnHelpersExecutable(nodePtyRoot);
}

await rm("dist-electron", { recursive: true, force: true });

const shared = {
  bundle: true,
  external: [
    "electron",
    "node-pty",
    "@modelcontextprotocol/sdk",
    "@modelcontextprotocol/sdk/*",
    "electron-updater",
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
